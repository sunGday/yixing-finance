"""t320u 总览 + 结算单。GroMore HTTP 全部走注入的 getter，CI 不打穿山甲。"""
import datetime as dt
import json
import os
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from fastapi.testclient import TestClient
from adapters.gromore import (
    DEFAULT_PAGE_LIMIT, GroMoreClient, GroMoreFetchError, GroMoreTimeout, iter_shards, map_network,
)
from adapters.pangle import PangleAdapter
import store as st
from main import create_app
from overview import card_ranges, load_cards, load_overview

FAKE = {"PANGLE_USER_ID": "u123456", "PANGLE_ROLE_ID": "r98765", "PANGLE_SECURE_KEY": "s3cr3t-FAKE-pangle-zz"}
# 2026-11-03 四网合计 13403.59 元 = 1340359 分（Allen 实测日）。
ROWS = [
    {"date": "2026-10-01", "network": 1, "revenue": "1.00"},
    {"date": "2026-10-31", "network": "1", "revenue": "2.00"},
    {"date": "2026-11-02", "network": 99, "revenue": "1.00"},
    {"date": "2026-11-03", "network": "1", "revenue": "8000.00", "api_revenue": "7900.00"},
    {"date": "2026-11-03", "network": 3, "revenue": "3400.59", "api_revenue": "3300.00"},
    {"date": "2026-11-03", "network": 7, "revenue": "2000.00", "api_revenue": "1900.00"},
    {"date": "2026-11-03", "network": 10, "revenue": "3.00", "api_revenue": "2.50"},
]


def _page(params):
    start, end = params["start_date"], params["end_date"]
    if (dt.date.fromisoformat(end) - dt.date.fromisoformat(start)).days > 29:
        raise AssertionError("shard longer than 30 days")
    chunk = [r for r in ROWS if start <= r["date"] <= end]
    off, lim = int(params["offset"]), int(params["limit"])
    return {"code": "100", "data": {"total": len(chunk), "report_list": chunk[off:off + lim]}}


class MapT(unittest.TestCase):
    def test_allen_codes_and_shards(self):
        self.assertEqual(map_network(1), ("pangle", None))
        self.assertEqual(map_network("3"), ("ylh", None))
        self.assertEqual(map_network(7), ("kuaishou", None))
        self.assertEqual(map_network("10"), ("gm_adx", None))
        ad, gap = map_network(9)  # 上传接口表里的「游可盈」，不是 gm_adx
        self.assertIsNone(ad)
        self.assertEqual(gap, "network_unmapped:9")
        self.assertEqual(map_network(99)[1], "network_unmapped:99")
        self.assertEqual(list(iter_shards("2026-10-01", "2026-10-31")),
                         [("2026-10-01", "2026-10-30"), ("2026-10-31", "2026-10-31")])

    def test_card_ranges_on_month_start(self):
        cards = {c["key"]: c for c in card_ranges(dt.date(2026, 11, 1))}
        self.assertEqual(cards["yesterday"]["from"], dt.date(2026, 10, 31))
        self.assertIsNone(cards["this_month"]["from"])
        self.assertEqual((cards["last_month"]["from"], cards["last_month"]["to"]),
                         (dt.date(2026, 10, 1), dt.date(2026, 10, 31)))
        last7 = cards["last7"]
        self.assertEqual((last7["to"] - last7["from"]).days, 6)


class OverviewT(unittest.TestCase):
    def setUp(self):
        self._env = dict(os.environ)
        for k in list(FAKE) + ["FIN_API_TOKEN", "FIN_REQUIRE_TOKEN", "FIN_REVENUE_MOCK", "FIN_CREDENTIALS_KEY"]:
            os.environ.pop(k, None)
        os.environ.update(FAKE)
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["FIN_SECRETS_DIR"] = os.path.join(self.tmp.name, "secrets")
        os.environ["FIN_DATA_DIR"] = os.path.join(self.tmp.name, "data")
        self.calls = []

        def getter(url, params):
            self.calls.append((url, dict(params)))
            self.assertTrue(url.endswith("/union_media/open/api/mediation/get_daily_income_report_data"))
            self.assertEqual(params["dimensions"], "date,network")
            self.assertEqual(params["metrics"], "revenue,api_revenue")
            signed = {k: v for k, v in params.items() if k != "sign"}
            self.assertEqual(params["sign"], PangleAdapter.sign(signed, FAKE["PANGLE_SECURE_KEY"]))
            self.assertNotIn(FAKE["PANGLE_SECURE_KEY"], url)
            self.assertNotIn(FAKE["PANGLE_SECURE_KEY"], json.dumps(params))
            return _page(params)

        self.client = GroMoreClient(env=os.environ, getter=getter, limit=2)
        self.store = st.SettlementStore(os.path.join(self.tmp.name, "data", "settlements.json"))
        self.c = TestClient(create_app(st.RechargeStore([]), st.CostStore(), st.SnapshotStore(),
                                       settlement_store=self.store, gromore_client=self.client,
                                       overview_today=lambda: dt.date(2026, 11, 4)))

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._env)
        self.tmp.cleanup()

    def _ov(self, **params):
        r = self.c.get("/api/v1/revenues/overview", params=params)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertNotIn(FAKE["PANGLE_SECURE_KEY"], r.text)
        return r.json()["data"]

    def test_nov3_network_aggregate(self):
        d = self._ov(**{"from": "2026-11-03", "to": "2026-11-03"})
        self.assertEqual(d["basis"], "auto")
        self.assertEqual(d["source"], "gromore_daily")
        self.assertEqual(d["total_fen"], 1340359)
        self.assertEqual(d["api_total_fen"], 1310250)
        self.assertTrue(d["verified"])
        self.assertEqual(d["gap_flags"], [])
        by = {n["ad_network"]: n for n in d["networks"]}
        self.assertEqual(list(by), ["pangle", "ylh", "kuaishou", "gm_adx"])
        self.assertEqual(by["pangle"]["amount_fen"], 800000)
        self.assertEqual(by["ylh"]["amount_fen"], 340059)
        self.assertEqual(by["kuaishou"]["amount_fen"], 200000)
        self.assertEqual(by["gm_adx"]["amount_fen"], 300)
        self.assertEqual(by["pangle"]["api_amount_fen"], 790000)
        self.assertEqual(by["gm_adx"]["api_amount_fen"], 250)
        self.assertTrue(all(n["basis"] == "estimate" and n["settlement_status"] == "estimated" for n in d["networks"]))
        self.assertTrue(all("app_id" not in n and "placement_id" not in n for n in d["networks"]))
        self.assertEqual(d["by_month"][0]["period"], "2026-11")
        self.assertGreaterEqual(len(self.calls), 2)  # 4 行、limit=2，会翻页
        today_only = self._ov(**{"from": "2026-11-04", "to": "2026-11-04"})
        self.assertIsNone(today_only["total_fen"])
        self.assertIn("today_excluded:2026-11-04", today_only["gap_flags"])
        self.assertFalse(any(p["start_date"] >= "2026-11-04" for _, p in self.calls))
        # 明细下钻仍是行级，且优量汇缺凭证标志还在（穿山甲凭证在本用例里是齐的）
        self.assertEqual(self.c.get("/api/v1/health").json()["data"]["version"], "0.6.0")
        # 明细仍是行级。穿山甲凭证在本用例里是齐的，所以 rt/income 要 mock，不能打真网。
        from unittest.mock import patch
        day = "2026-11-03"
        income = {"code": "100", "data": {day: [{
            "date": day, "revenue": "10.00", "show": 1, "click": 0, "app_id": 42, "ad_slot_id": 7}]}}

        def fake_income(url, params, headers, timeout):
            self.assertNotIn(FAKE["PANGLE_SECURE_KEY"], url)
            self.assertNotIn(FAKE["PANGLE_SECURE_KEY"], json.dumps(params))
            return income

        with patch("adapters.pangle.http_get", fake_income):
            detail = self.c.get("/api/v1/revenues", params={"date": day}).json()["data"]
        self.assertIn("credential_missing:ylh", detail["gap_flags"])
        self.assertNotIn("live_fetch_unverified:pangle", detail["gap_flags"])
        live = [i for i in detail["items"] if i.get("source") == "live"]
        self.assertEqual([(i["ad_network"], i["app_id"], i["placement_id"], i["amount_fen"]) for i in live],
                         [("pangle", "42", "7", 1000)])
        self.assertNotIn("networks", detail)

    def test_gromore_day_cache_and_secret(self):
        self._ov(**{"from": "2026-11-03", "to": "2026-11-03"})
        mid = len(self.calls)
        self.assertGreaterEqual(mid, 2)
        again = self._ov(**{"from": "2026-11-03", "to": "2026-11-03"})
        self.assertEqual(len(self.calls), mid)
        self.assertEqual(again["total_fen"], 1340359)
        blob = repr(self.client._days)
        self.assertNotIn(FAKE["PANGLE_SECURE_KEY"], blob)
        self.assertNotIn("sign", blob)
        self._ov(**{"from": "2026-11-01", "to": "2026-11-03"})
        self.assertGreater(len(self.calls), mid)
        after = len(self.calls)
        self.client.clear_cache()
        self._ov(**{"from": "2026-11-03", "to": "2026-11-03"})
        self.assertGreater(len(self.calls), after)

    def test_year_range_second_call_hits_cache(self):
        params = {"from": "2026-01-01", "to": "2026-11-03"}
        first = self._ov(**params)
        self.assertEqual(first["source"], "gromore_daily")
        self.assertEqual(first["total_fen"], 100 + 200 + 100 + 1340359)
        mid = len(self.calls)
        self.assertGreaterEqual(mid, 11)
        started = time.perf_counter()
        second = self._ov(**params)
        self.assertLess(time.perf_counter() - started, 1.0)
        self.assertEqual(len(self.calls), mid)
        self.assertEqual(second["total_fen"], first["total_fen"])
        day = self._ov(**{"from": "2026-11-03", "to": "2026-11-03"})
        self.assertEqual(day["total_fen"], 1340359)
        self.assertEqual(day["source"], "gromore_daily")
        self.assertTrue(day["verified"])
        self.assertEqual(len(self.calls), mid)
        with open(os.path.join(os.environ["FIN_DATA_DIR"], "gromore-daily.json"), encoding="utf-8") as fh:
            blob = fh.read()
        self.assertNotIn(FAKE["PANGLE_SECURE_KEY"], blob)
        self.assertIn(FAKE["PANGLE_USER_ID"], blob)
        self.assertNotIn("PANGLE_SECURE_KEY", blob)

    def test_gromore_error_is_not_cached(self):
        calls = {"n": 0}

        def boom(url, params):
            calls["n"] += 1
            raise GroMoreFetchError("http error")

        client = GroMoreClient(env=FAKE, getter=boom, cache_ttl=90)
        with self.assertRaises(GroMoreFetchError):
            client.fetch("2026-11-03", "2026-11-03")
        with self.assertRaises(GroMoreFetchError):
            client.fetch("2026-11-03", "2026-11-03")
        self.assertEqual(calls["n"], 2)

    def test_unknown_code_gap_not_fake_name(self):
        d = self._ov(**{"from": "2026-11-02", "to": "2026-11-03"})
        self.assertEqual(d["total_fen"], 1340359 + 100)
        self.assertIn("network_unmapped:99", d["gap_flags"])
        self.assertFalse(d["verified"])
        self.assertTrue(all(n["ad_network"] in ("pangle", "ylh", "kuaishou", "gm_adx") for n in d["networks"]))
        self.assertEqual(sum(n["amount_fen"] for n in d["networks"]), 1340359)
        self.assertNotEqual(d["total_fen"], 0)

    def test_auto_upgrades_full_month_only(self):
        bare = self._ov(**{"from": "2026-10-01", "to": "2026-10-31", "basis": "estimate"})
        self.assertEqual(bare["total_fen"], 300)
        self.assertIsNone(bare["api_total_fen"])
        body = {"period": "2026-10", "business_type": "sdk_ads", "amount_fen": 500000,
                "settlement_status": "settled", "signed_date": "2026-11-02", "evidence_ref": "bill-2026-10"}
        created = self.c.post("/api/v1/settlements", json=body)
        self.assertEqual(created.status_code, 200, created.text)
        self.assertNotIn("s3cr3t", created.text)
        sid = created.json()["data"]["settlement_id"]
        auto = self._ov(**{"from": "2026-10-01", "to": "2026-10-31"})
        self.assertEqual(auto["total_fen"], 500000)
        self.assertEqual(auto["source"], "settlement_manual")
        self.assertEqual(auto["networks"][0]["basis"], "settlement")
        self.assertEqual(auto["networks"][0]["settlement_status"], "settled")
        self.assertIsNone(auto["networks"][0]["ad_network"])
        self.assertEqual(auto["by_month"][0]["estimate_fen"], 300)
        self.assertEqual(auto["by_month"][0]["diff_fen"], 499700)
        self.assertIn("estimate_settlement_diff:2026-10", auto["gap_flags"])
        forced = self._ov(**{"from": "2026-10-01", "to": "2026-10-31", "basis": "estimate"})
        self.assertEqual(forced["total_fen"], 300)
        self.assertTrue(all(n["basis"] == "estimate" for n in forced["networks"]))
        mixed = self._ov(**{"from": "2026-10-01", "to": "2026-11-03"})
        self.assertEqual(mixed["source"], "mixed")
        self.assertEqual(mixed["total_fen"], 500000 + 100 + 1340359)
        self.assertEqual(sum(n["amount_fen"] for n in mixed["networks"]), 500000 + 1340359)
        self.assertIn("network_unmapped:99", mixed["gap_flags"])
        # 昨天不是整月：即使 11 月有单，auto 仍显示预估
        self.c.post("/api/v1/settlements", json={
            "period": "2026-11", "business_type": "sdk_ads", "amount_fen": 1,
            "settlement_status": "settled", "signed_date": "2026-11-04", "evidence_ref": "bill-nov"})
        day = self._ov(**{"from": "2026-11-03", "to": "2026-11-03"})
        self.assertEqual(day["total_fen"], 1340359)
        self.assertTrue(all(n["basis"] == "estimate" for n in day["networks"]))
        toggled = self._ov(**{"from": "2026-11-03", "to": "2026-11-03", "basis": "settlement"})
        self.assertEqual(toggled["total_fen"], 1)
        self.assertEqual(toggled["source"], "settlement_manual")
        missing = self._ov(**{"from": "2026-09-01", "to": "2026-09-30", "basis": "settlement"})
        self.assertIsNone(missing["total_fen"])
        self.assertNotEqual(missing["total_fen"], 0)
        self.assertEqual(missing["networks"], [])
        self.assertIn("settlement_missing:2026-09", missing["gap_flags"])
        self.assertIsNone(missing["by_month"][0]["amount_fen"])
        self.assertFalse(any(m["amount_fen"] == 0 for m in missing["by_month"]))
        # settled → paid
        paid = self.c.patch(f"/api/v1/settlements/{sid}", json={"settlement_status": "paid", "paid_date": "2026-11-04"})
        self.assertEqual(paid.json()["data"]["settlement_status"], "paid")
        self.assertEqual(self.c.patch(f"/api/v1/settlements/{sid}", json={"settlement_status": "settled"}).json()["code"], 40901)

    def test_cards_and_detail_flags(self):
        listed = self.c.get("/api/v1/revenues/overview/cards", params={"basis": "auto"})
        self.assertEqual(listed.status_code, 200, listed.text)
        d = listed.json()["data"]
        self.assertEqual(d["basis"], "auto")
        self.assertEqual(d["today"], "2026-11-04")
        cards = {c["key"]: c for c in d["cards"]}
        self.assertEqual(cards["yesterday"]["total_fen"], 1340359)
        self.assertEqual(cards["yesterday"]["from"], "2026-11-03")
        self.assertNotIn("network_unmapped:99", cards["yesterday"]["gap_flags"])
        self.assertEqual(cards["last7"]["from"], "2026-10-28")
        self.assertEqual(cards["last7"]["total_fen"], 200 + 100 + 1340359)
        self.assertIn("network_unmapped:99", cards["last7"]["gap_flags"])
        self.assertEqual(cards["this_month"]["total_fen"], 100 + 1340359)
        self.assertEqual(cards["last_month"]["total_fen"], 300)
        self.assertEqual(cards["last_month"]["basis"], "auto")
        self.assertTrue(cards["last_month"]["verified"])
        self.assertEqual(len(self.calls), 4)
        self.c.post("/api/v1/settlements", json={
            "period": "2026-10", "business_type": "ad_coop", "ad_network": "ks", "amount_fen": 888,
            "settlement_status": "paid", "signed_date": "2026-11-01", "paid_date": "2026-11-03",
            "evidence_ref": "coop-10"})
        again = {c["key"]: c for c in self.c.get("/api/v1/revenues/overview/cards").json()["data"]["cards"]}
        self.assertEqual(again["last_month"]["total_fen"], 888)
        self.assertEqual(again["last_month"]["networks"][0]["ad_network"], "kuaishou")
        self.assertEqual(again["last_month"]["networks"][0]["settlement_status"], "paid")
        self.assertEqual(again["yesterday"]["total_fen"], 1340359)

    def test_settlement_crud_import_and_auth(self):
        bad = self.c.post("/api/v1/settlements", json={
            "period": "2026-10", "business_type": "sdk_ads", "amount_fen": 1,
            "settlement_status": "estimated", "signed_date": "2026-11-01", "evidence_ref": "x"})
        self.assertEqual(bad.json()["code"], 40002)
        secret = FAKE["PANGLE_SECURE_KEY"]
        leaked = self.c.post("/api/v1/settlements", json={
            "period": "2026-10", "business_type": "sdk_ads", "amount_fen": 1,
            "settlement_status": "settled", "signed_date": "2026-11-01", "evidence_ref": f"ref-{secret}"})
        self.assertEqual(leaked.status_code, 400)
        self.assertNotIn(secret, leaked.text)
        path = self.store.resolve()
        if os.path.exists(path):
            self.assertNotIn(secret, open(path, encoding="utf-8").read())
        csv_body = (
            "settlement_id,period,business_type,ad_network,amount_fen,settlement_status,signed_date,paid_date,evidence_ref\n"
            "stl-aug,2026-08,ad_coop,,100,settled,2026-09-01,,coop-8\n"
        )
        imp = self.c.post("/api/v1/settlements/import", content=csv_body.encode(), headers={"Content-Type": "text/csv"})
        self.assertEqual(imp.json()["data"]["inserted"], 1, imp.text)
        again = self.c.post("/api/v1/settlements/import", content=csv_body.encode(), headers={"Content-Type": "text/csv"})
        self.assertEqual((again.json()["data"]["inserted"], again.json()["data"]["updated"]), (0, 1))
        listed = self.c.get("/api/v1/settlements", params={"period": "2026-08", "postable": "true"}).json()["data"]
        self.assertEqual(listed["total"], 1)
        self.assertIsNone(listed["items"][0]["ad_network"])
        self.assertEqual(listed["items"][0]["amount_fen"], 100)
        dup = self.c.post("/api/v1/settlements", json={
            "settlement_id": "stl-aug", "period": "2026-08", "business_type": "ad_coop", "amount_fen": 100,
            "settlement_status": "settled", "signed_date": "2026-09-01", "evidence_ref": "coop-8"})
        self.assertEqual(dup.json()["code"], 40901)
        self.assertEqual(self.c.get("/api/v1/revenues/overview", params={"from": "bad", "to": "2026-11-03"}).json()["code"], 40001)
        self.assertEqual(self.c.get("/api/v1/revenues/overview", params={"from": "2026-11-03", "to": "2026-11-03", "basis": "nope"}).json()["code"], 40002)
        os.environ["FIN_API_TOKEN"] = "t0k"
        self.assertEqual(self.c.post("/api/v1/settlements", json={"period": "2026-07"}).status_code, 401)
        os.environ["FIN_REQUIRE_TOKEN"] = "1"
        os.environ.pop("FIN_API_TOKEN")
        self.assertEqual(self.c.post("/api/v1/settlements", json={"period": "2026-07"}).status_code, 503)
        self.assertIn("settlements.json", path)
        self.assertNotIn("secrets", os.path.dirname(path))


class FallbackT(unittest.TestCase):
    def setUp(self):
        self._env = dict(os.environ)
        for k in list(FAKE) + ["FIN_API_TOKEN", "FIN_REVENUE_MOCK"]:
            os.environ.pop(k, None)
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["FIN_SECRETS_DIR"] = os.path.join(self.tmp.name, "secrets")
        os.environ["FIN_DATA_DIR"] = os.path.join(self.tmp.name, "data")

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._env)
        self.tmp.cleanup()

    def _client(self, gromore, live=None):
        store = st.SettlementStore(os.path.join(self.tmp.name, "settlements.json"))
        return TestClient(create_app(st.RechargeStore([]), st.CostStore(), st.SnapshotStore(),
                                     settlement_store=store, gromore_client=gromore,
                                     overview_today=dt.date(2026, 11, 4), pangle_live_items=live))

    def test_no_creds_does_not_call_http_or_invent_zero(self):
        called = {"n": 0}

        def getter(url, params):
            called["n"] += 1
            raise AssertionError("live http")

        c = self._client(GroMoreClient(env={}, getter=getter))
        with patch("httpx.Client", side_effect=AssertionError("live socket")):
            r = c.get("/api/v1/revenues/overview", params={"from": "2026-11-03", "to": "2026-11-03"})
        self.assertEqual(r.status_code, 200, r.text)
        d = r.json()["data"]
        self.assertEqual(called["n"], 0)
        self.assertIsNone(d["total_fen"])
        self.assertNotEqual(d["total_fen"], 0)
        self.assertIn("credential_missing:gromore", d["gap_flags"])
        self.assertIn("fallback_rt_income:pangle_only", d["gap_flags"])
        self.assertEqual(d["source"], "rt_income_fallback")
        self.assertEqual(d["networks"], [])
        detail = c.get("/api/v1/revenues").json()["data"]
        self.assertIn("credential_missing:ylh", detail["gap_flags"])
        self.assertIn("credential_missing:pangle", detail["gap_flags"])
        self.assertTrue(all(i.get("source") == "mock" for i in detail["items"]))

    def test_fetch_failure_sums_live_pangle_only(self):
        class Boom:
            def fetch(self, start, end):
                raise GroMoreFetchError("http 500")

        live = [
            {"source": "mock", "ad_network": "pangle", "stat_date": "2026-11-03", "amount_fen": 999999},
            {"source": "live", "ad_network": "ylh", "stat_date": "2026-11-03", "amount_fen": 111},
            {"source": "live", "ad_network": "pangle", "stat_date": "2026-11-02", "amount_fen": 20},
            {"source": "live", "ad_network": "pangle", "stat_date": "2026-11-03", "amount_fen": 50},
        ]
        c = self._client(Boom(), live)
        d = c.get("/api/v1/revenues/overview", params={"from": "2026-11-03", "to": "2026-11-03"}).json()["data"]
        self.assertEqual(d["total_fen"], 50)
        self.assertEqual(d["source"], "rt_income_fallback")
        self.assertEqual([n["ad_network"] for n in d["networks"]], ["pangle"])
        self.assertIn("gromore_fetch_failed", d["gap_flags"])
        self.assertIn("fallback_rt_income:pangle_only", d["gap_flags"])
        self.assertFalse(d["verified"])
        self.assertNotIn(FAKE["PANGLE_SECURE_KEY"], c.get("/api/v1/revenues/overview",
                                                          params={"from": "2026-11-03", "to": "2026-11-03"}).text)

    def test_fallback_sums_live_rt_income_for_the_range(self):
        """GroMore 失败时走 main 上的 rt/income 真拉（此处 mock），只加总请求区间的穿山甲行。"""
        from unittest.mock import patch
        os.environ.update(FAKE)

        class Boom:
            def fetch(self, start, end):
                raise GroMoreFetchError("http 500")

        seen = []

        def fake_income(url, params, headers, timeout):
            seen.append(params.get("date") or (params.get("start_date"), params.get("end_date")))
            self.assertNotIn(FAKE["PANGLE_SECURE_KEY"], json.dumps(params))
            self.assertNotIn(FAKE["PANGLE_SECURE_KEY"], url)
            return {"code": "100", "data": {
                "2026-11-02": [{"date": "2026-11-02", "revenue": "1.50", "app_id": 1, "ad_slot_id": 2}],
                "2026-11-03": [
                    {"date": "2026-11-03", "revenue": "4.00", "app_id": 1, "ad_slot_id": 2},
                    {"date": "2026-11-03", "revenue": "0.25", "app_id": 9, "ad_slot_id": 8},
                ],
            }}

        store = st.SettlementStore(os.path.join(self.tmp.name, "fallback-live.json"))
        c = TestClient(create_app(st.RechargeStore([]), st.CostStore(), st.SnapshotStore(),
                                  settlement_store=store, gromore_client=Boom(),
                                  overview_today=dt.date(2026, 11, 4)))
        with patch("adapters.pangle.http_get", fake_income):
            d = c.get("/api/v1/revenues/overview", params={"from": "2026-11-03", "to": "2026-11-03"}).json()["data"]
        self.assertEqual(d["total_fen"], 425)
        self.assertEqual(d["source"], "rt_income_fallback")
        self.assertEqual([(n["ad_network"], n["amount_fen"]) for n in d["networks"]], [("pangle", 425)])
        self.assertIn("gromore_fetch_failed", d["gap_flags"])
        self.assertIn("fallback_rt_income:pangle_only", d["gap_flags"])
        self.assertTrue(seen)
        self.assertNotIn(FAKE["PANGLE_SECURE_KEY"], json.dumps(d))

    def test_this_month_card_empty_on_first(self):
        def getter(url, params):
            raise AssertionError("live http")

        store = st.SettlementStore(os.path.join(self.tmp.name, "empty-month.json"))
        c = TestClient(create_app(st.RechargeStore([]), st.CostStore(), st.SnapshotStore(),
                                  settlement_store=store, gromore_client=GroMoreClient(env={}, getter=getter),
                                  overview_today=dt.date(2026, 11, 1)))
        cards = {x["key"]: x for x in c.get("/api/v1/revenues/overview/cards").json()["data"]["cards"]}
        self.assertIsNone(cards["this_month"]["total_fen"])
        self.assertIn("today_excluded:2026-11-01", cards["this_month"]["gap_flags"])
        self.assertEqual(cards["yesterday"]["from"], "2026-10-31")
        self.assertEqual((cards["last_month"]["from"], cards["last_month"]["to"]), ("2026-10-01", "2026-10-31"))


class CacheBoundT(unittest.TestCase):
    """本年区间：第二次命中日缓存；卡住的上游不能把请求或卡片挂住。"""

    def tearDown(self):
        os.environ.pop("FIN_DATA_DIR", None)

    def test_closed_days_outlive_the_90s_ttl(self):
        now = [1_700_000_000.0]
        calls = []

        def getter(url, params):
            calls.append((params["start_date"], params["end_date"]))
            return _page(params)

        client = GroMoreClient(env=FAKE, getter=getter, clock=lambda: now[0], today=lambda: dt.date(2026, 11, 4),
                               cache_ttl=90, closed_ttl=24 * 3600)
        client.fetch("2026-01-01", "2026-11-03")
        cut = len(calls)
        now[0] += 120
        client.fetch("2026-01-01", "2026-11-03")
        fresh = calls[cut:]
        self.assertTrue(fresh)
        self.assertTrue(all(start >= "2026-11-03" and end >= "2026-11-03" for start, end in fresh))
        self.assertLess(len(fresh), cut)

    def test_blocked_year_fetch_returns_before_the_upstream(self):
        release = threading.Event()
        started = threading.Event()

        def getter(url, params):
            started.set()
            if not release.wait(5):
                raise GroMoreFetchError("http error")
            return _page(params)

        client = GroMoreClient(env=FAKE, getter=getter, today=dt.date(2026, 11, 4))
        started_at = time.perf_counter()
        try:
            with self.assertRaises(GroMoreTimeout):
                client.fetch("2026-01-01", "2026-11-03", max_wait=0.3)
            self.assertLess(time.perf_counter() - started_at, 2.0)
            self.assertTrue(started.is_set())
        finally:
            release.set()

    def test_year_timeout_is_a_gap_not_a_pangle_rescan(self):
        release = threading.Event()

        def getter(url, params):
            if not release.wait(5):
                raise GroMoreFetchError("http error")
            return _page(params)

        client = GroMoreClient(env=FAKE, getter=getter, today=dt.date(2026, 11, 4))
        started_at = time.perf_counter()
        try:
            with patch("store.load_revenues", side_effect=AssertionError("pangle year")):
                body = load_overview(
                    "2026-01-01", "2026-11-03", "auto", today=dt.date(2026, 11, 4),
                    settlement_items=[], gromore=client, live_items=None, max_wait=0.3)
            self.assertLess(time.perf_counter() - started_at, 2.0)
        finally:
            release.set()
        self.assertIn("gromore_fetch_failed", body["gap_flags"])
        self.assertFalse(any(flag.startswith("fallback_rt_income") for flag in body["gap_flags"]))
        self.assertIsNone(body["total_fen"])
        self.assertNotEqual(body["total_fen"], 0)

    def test_timeout_sums_cached_days_instead_of_null(self):
        phase = {"block": False}
        release = threading.Event()

        def getter(url, params):
            if phase["block"] and not release.wait(5):
                raise GroMoreFetchError("http error")
            return _page(params)

        client = GroMoreClient(env=FAKE, getter=getter, today=dt.date(2026, 11, 4))
        warm = load_overview(
            "2026-11-03", "2026-11-03", "auto", today=dt.date(2026, 11, 4),
            settlement_items=[], gromore=client, live_items=None)
        self.assertEqual(warm["total_fen"], 1340359)
        self.assertTrue(warm["verified"])
        phase["block"] = True
        started = time.perf_counter()
        try:
            body = load_overview(
                "2026-01-01", "2026-11-03", "auto", today=dt.date(2026, 11, 4),
                settlement_items=[], gromore=client, live_items=None, max_wait=0.3)
            self.assertLess(time.perf_counter() - started, 2.0)
            self.assertEqual(body["total_fen"], 1340359)
            self.assertIsNotNone(body["total_fen"])
            self.assertIn("gromore_partial", body["gap_flags"])
            self.assertIn("gromore_fetch_failed", body["gap_flags"])
            self.assertFalse(any(flag.startswith("fallback_rt_income") for flag in body["gap_flags"]))
            self.assertFalse(body["verified"])
            again_at = time.perf_counter()
            again = load_overview(
                "2026-01-01", "2026-11-03", "auto", today=dt.date(2026, 11, 4),
                settlement_items=[], gromore=client, live_items=None, max_wait=0.3)
            self.assertLess(time.perf_counter() - again_at, 3.0)
            self.assertEqual(again["total_fen"], 1340359)
            day = load_overview(
                "2026-11-03", "2026-11-03", "auto", today=dt.date(2026, 11, 4),
                settlement_items=[], gromore=client, live_items=None, max_wait=0.3)
            self.assertEqual(day["total_fen"], 1340359)
            self.assertEqual(day["source"], "gromore_daily")
            self.assertTrue(day["verified"])
        finally:
            release.set()

    def test_failed_shard_keeps_rows_already_fetched(self):
        def getter(url, params):
            if params["start_date"] < "2026-10-28":
                raise GroMoreFetchError("http error")
            return _page(params)

        client = GroMoreClient(env=FAKE, getter=getter, today=dt.date(2026, 11, 4))
        body = load_overview(
            "2026-01-01", "2026-11-03", "auto", today=dt.date(2026, 11, 4),
            settlement_items=[], gromore=client, live_items=None, max_wait=2)
        self.assertIn("gromore_partial", body["gap_flags"])
        self.assertIn("gromore_fetch_failed", body["gap_flags"])
        self.assertFalse(any(flag.startswith("fallback_rt_income") for flag in body["gap_flags"]))
        self.assertEqual(body["total_fen"], 200 + 100 + 1340359)
        self.assertIsNotNone(body["total_fen"])
        self.assertFalse(body["verified"])
        day = load_overview(
            "2026-11-03", "2026-11-03", "auto", today=dt.date(2026, 11, 4),
            settlement_items=[], gromore=client, live_items=[])
        self.assertEqual(day["total_fen"], 1340359)
        self.assertTrue(day["verified"])

    def test_cards_do_not_wait_on_a_blocked_year_shard(self):
        release = threading.Event()
        blocked = threading.Event()

        def getter(url, params):
            if params["start_date"] == "2026-01-01":
                blocked.set()
                if not release.wait(8):
                    raise GroMoreFetchError("http error")
            return _page(params)

        client = GroMoreClient(env=FAKE, getter=getter, today=dt.date(2026, 11, 4))
        box = {}

        def year():
            try:
                client.fetch("2026-01-01", "2026-11-03", max_wait=6)
            except GroMoreFetchError as exc:
                box["err"] = exc

        thread = threading.Thread(target=year)
        thread.start()
        try:
            self.assertTrue(blocked.wait(2))
            started_at = time.perf_counter()
            body = load_cards(dt.date(2026, 11, 4), "auto", settlement_items=[], gromore=client, live_items=[])
            self.assertLess(time.perf_counter() - started_at, 2.0)
            self.assertTrue(thread.is_alive())
        finally:
            release.set()
            thread.join(3)
        self.assertFalse(thread.is_alive())
        cards = {c["key"]: c for c in body["cards"]}
        self.assertEqual(cards["yesterday"]["total_fen"], 1340359)
        self.assertEqual(cards["yesterday"]["from"], "2026-11-03")

    def test_stale_cards_return_without_waiting_for_refresh(self):
        now = [1_700_000_000.0]
        release = threading.Event()

        def getter(url, params):
            if now[0] > 1_700_000_000.0:
                if not release.wait(2):
                    raise GroMoreFetchError("http error")
            return _page(params)

        client = GroMoreClient(env=FAKE, getter=getter, clock=lambda: now[0], today=lambda: dt.date(2026, 11, 4),
                               cache_ttl=90, closed_ttl=24 * 3600)
        warm = load_cards(dt.date(2026, 11, 4), "auto", settlement_items=[], gromore=client, live_items=[])
        self.assertEqual({c["key"]: c["total_fen"] for c in warm["cards"]}["yesterday"], 1340359)
        now[0] += 24 * 3600 + 5
        started_at = time.perf_counter()
        try:
            body = load_cards(dt.date(2026, 11, 4), "auto", settlement_items=[], gromore=client, live_items=[])
            self.assertLess(time.perf_counter() - started_at, 0.6)
        finally:
            release.set()
        cards = {c["key"]: c for c in body["cards"]}
        self.assertEqual(cards["yesterday"]["total_fen"], 1340359)
        self.assertEqual(cards["last_month"]["total_fen"], 300)

    def test_new_client_reads_disk_cache(self):
        calls = []

        def getter(url, params):
            calls.append(params["start_date"])
            return _page(params)

        tmp = tempfile.TemporaryDirectory()
        os.environ["FIN_DATA_DIR"] = tmp.name
        try:
            first = GroMoreClient(env=FAKE, getter=getter, today=dt.date(2026, 11, 4))
            rows, _gaps = first.fetch("2026-01-01", "2026-11-03")
            self.assertEqual(sum(r["amount_fen"] for r in rows if r["stat_date"] == "2026-11-03"), 1340359)
            cut = len(calls)
            self.assertGreater(cut, 0)
            with open(os.path.join(tmp.name, "gromore-daily.json"), encoding="utf-8") as fh:
                blob = fh.read()
            self.assertNotIn(FAKE["PANGLE_SECURE_KEY"], blob)
            second = GroMoreClient(env=FAKE, getter=getter, today=dt.date(2026, 11, 4))
            again, _gaps = second.fetch("2026-01-01", "2026-11-03")
            self.assertEqual(len(calls), cut)
            self.assertEqual(sum(r["amount_fen"] for r in again if r["stat_date"] == "2026-11-03"), 1340359)
            second.clear_cache()
            self.assertFalse(os.path.exists(os.path.join(tmp.name, "gromore-daily.json")))
            GroMoreClient(env=FAKE, getter=getter, today=dt.date(2026, 11, 4)).fetch("2026-11-03", "2026-11-03")
            self.assertGreater(len(calls), cut)
        finally:
            tmp.cleanup()


def _network_rows(start: str, end: str) -> list[dict]:
    """每天四网一行。30 天分片 = 120 行，limit=100 时必须翻页。"""
    rows = []
    day = dt.date.fromisoformat(start)
    last = dt.date.fromisoformat(end)
    while day <= last:
        iso = day.isoformat()
        for code, rev in ((1, "1.00"), (3, "2.00"), (7, "3.00"), (10, "4.00")):
            rows.append({"date": iso, "network": code, "revenue": rev})
        day += dt.timedelta(days=1)
    return rows


def _ignore_offset(rows):
    """上游不看 offset，每次都返回该区间的第一页。"""
    calls = []

    def getter(url, params):
        calls.append((params["offset"], params["limit"], params["start_date"], params["end_date"]))
        start, end = params["start_date"], params["end_date"]
        chunk = [r for r in rows if start <= r["date"] <= end]
        return {"code": "100", "data": {"total": len(chunk), "report_list": chunk[:int(params["limit"])]}}

    return getter, calls


class PageLimitT(unittest.TestCase):
    def test_default_limit_fits_a_30_day_shard_when_offset_is_ignored(self):
        rows = _network_rows("2026-09-01", "2026-09-30")
        self.assertEqual(len(rows), 120)
        getter, calls = _ignore_offset(rows)
        client = GroMoreClient(env=FAKE, getter=getter, cache_ttl=0)
        self.assertEqual(client.limit, DEFAULT_PAGE_LIMIT)
        self.assertEqual(client.limit, 500)
        got, _gaps = client.fetch("2026-09-01", "2026-09-30")
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0], "0")
        self.assertEqual(calls[0][1], "500")
        self.assertEqual(len(got), 120)
        self.assertEqual({r["stat_date"] for r in got}, {r["date"] for r in rows})
        self.assertEqual(sum(r["amount_fen"] for r in got), 30 * 1000)

    def test_year_of_shards_completes_in_one_page_each(self):
        rows = _network_rows("2026-01-01", "2026-11-03")
        self.assertEqual(len(rows), 1228)
        getter, calls = _ignore_offset(rows)
        client = GroMoreClient(env=FAKE, getter=getter, cache_ttl=0)
        got, _gaps = client.fetch("2026-01-01", "2026-11-03")
        shards = list(iter_shards("2026-01-01", "2026-11-03"))
        self.assertEqual(len(calls), len(shards))
        self.assertTrue(all(limit == "500" and offset == "0" for offset, limit, _s, _e in calls))
        self.assertEqual(len(got), 1228)
        self.assertEqual(len({r["stat_date"] for r in got}), 307)

    def test_ignored_offset_stops_instead_of_raising(self):
        rows = _network_rows("2026-09-01", "2026-09-30")
        getter, calls = _ignore_offset(rows)
        client = GroMoreClient(env=FAKE, getter=getter, limit=100, cache_ttl=0)
        got, _gaps = client.fetch("2026-09-01", "2026-09-30")
        self.assertEqual(len(calls), 2)
        self.assertEqual([c[0] for c in calls], ["0", "100"])
        self.assertEqual(len(got), 100)
        self.assertEqual(len({(r["stat_date"], r["code"]) for r in got}), 100)

    def test_honored_offset_still_returns_the_full_shard(self):
        rows = _network_rows("2026-09-01", "2026-09-30")
        calls = []

        def getter(url, params):
            calls.append(params["offset"])
            off, lim = int(params["offset"]), int(params["limit"])
            start, end = params["start_date"], params["end_date"]
            chunk = [r for r in rows if start <= r["date"] <= end]
            return {"code": "100", "data": {"total": len(chunk), "report_list": chunk[off:off + lim]}}

        client = GroMoreClient(env=FAKE, getter=getter, limit=100, cache_ttl=0)
        got, _gaps = client.fetch("2026-09-01", "2026-09-30")
        self.assertEqual(calls, ["0", "100"])
        self.assertEqual(len(got), 120)
        self.assertEqual(sum(r["amount_fen"] for r in got), 30 * 1000)


if __name__ == "__main__":
    unittest.main()
