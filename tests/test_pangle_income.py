"""穿山甲 rt/income：签名、别名、mocked HTTP。不访问 open-api，不写密钥。"""
import datetime as dt
import hashlib
import os
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from adapters.pangle import ENDPOINT, IncomeFetchError, SH, sign
from adapters import get_adapter

ENV = {"PANGLE_USER_ID": "u100001", "PANGLE_ROLE_ID": "r100001", "PANGLE_SECURE_KEY": "unit-test-secure-key"}
NOW = dt.datetime(2026, 11, 4, 15, 0, tzinfo=SH)


def _body(day, revenue="12.34"):
    return {"code": "100", "message": "", "data": {day: [{
        "date": day, "revenue": revenue, "show": "10", "click": 2, "ecpm": "1.20",
        "app_id": 9, "ad_slot_id": 8, "region": "cn", "package_name": "com.example.app"}]}}


class SignT(unittest.TestCase):
    def test_md5_sorted_then_key(self):
        got = sign({"b": "2", "a": "1", "sign": "nope", "empty": ""}, "KEY")
        self.assertEqual(got, hashlib.md5(b"a=1&b=2KEY").hexdigest())

    def test_csj_env_alias_and_request_has_no_secret(self):
        ad = get_adapter("pangle", env={
            "CSJ_MEDIA_ID": "u100001", "CSJ_ROLE_ID": "r100001", "CSJ_SECURITY_KEY": "unit-test-secure-key"}, dry_run=False)
        req = ad.build_request("2026-11-03", now=NOW)
        p = req["params"]
        self.assertFalse(req["dry_run"]); self.assertTrue(req["verified"])
        self.assertEqual(req["url"], ENDPOINT)
        self.assertEqual(p["user_id"], "u100001")
        self.assertEqual(p["role_id"], "r100001")
        self.assertEqual((p["region"], p["currency"], p["time_zone"], p["version"], p["sign_type"]),
                         ("cn", "cny", "8", "2.0", "MD5"))
        self.assertEqual(p["current_time"], "2026-11-04 15:00:00")
        self.assertEqual(p["timestamp"], str(int(NOW.timestamp())))
        self.assertEqual(p["sign"], sign({k: v for k, v in p.items() if k != "sign"}, ENV["PANGLE_SECURE_KEY"]))
        self.assertNotIn("unit-test-secure-key", str(p))
        self.assertEqual(req["headers"]["Role-Id"], "r100001")


class FetchT(unittest.TestCase):
    def test_fetch_maps_fen_and_skips_blank_revenue(self):
        seen = {}

        def fake(url, params, headers, timeout):
            seen["url"] = url
            seen["params"] = dict(params)
            seen["headers"] = dict(headers)
            data = _body("2026-11-03")
            data["data"]["2026-11-03"].append({"date": "2026-11-03", "revenue": "", "app_id": 1})
            return data

        ad = get_adapter("pangle", env=ENV, dry_run=False)
        with patch("adapters.pangle.http_get", fake):
            rows = ad.fetch("2026-11-03", "2026-11-03", now=NOW)
        self.assertEqual(seen["url"], ENDPOINT)
        self.assertNotIn("unit-test-secure-key", str(seen))
        self.assertEqual(len(rows), 1)
        r = rows[0]
        self.assertEqual((r.amount_fen, r.impressions, r.clicks, r.ecpm_fen, r.placement_id, r.country, r.bundle_id),
                         (1234, 10, 2, 120, "8", "CN", "com.example.app"))
        self.assertEqual(r.settlement_status, "estimated")
        self.assertTrue(r.revenue_id.startswith("pangle-"))

    def test_range_chunks_at_31_days(self):
        calls = []

        def fake(url, params, headers, timeout):
            calls.append(params.get("date") or (params.get("start_date"), params.get("end_date")))
            return {"code": "100", "data": {}}

        ad = get_adapter("pangle", env=ENV, dry_run=False)
        with patch("adapters.pangle.http_get", fake):
            self.assertEqual(ad.fetch("2026-10-01", "2026-11-03", now=NOW), [])
        self.assertEqual(calls, [("2026-10-01", "2026-10-31"), ("2026-11-01", "2026-11-03")])

    def test_today_only_returns_empty_without_http(self):
        def fake(*a, **k):
            raise AssertionError("should not call HTTP for today-only")

        ad = get_adapter("pangle", env=ENV, dry_run=False)
        with patch("adapters.pangle.http_get", fake):
            self.assertEqual(ad.fetch("2026-11-04", "2026-11-04", now=NOW), [])

    def test_upstream_code_and_transport_hide_secret(self):
        ad = get_adapter("pangle", env=ENV, dry_run=False)
        with patch("adapters.pangle.http_get", lambda *a, **k: {"code": "115", "message": "bad sign unit-test-secure-key"}):
            with self.assertRaises(IncomeFetchError) as cm:
                ad.fetch("2026-11-03", "2026-11-03", now=NOW)
        self.assertNotIn("unit-test-secure-key", str(cm.exception))
        self.assertIn("115", str(cm.exception))
        self.assertIn("***", str(cm.exception))

    def test_default_day_is_shanghai_yesterday(self):
        calls = []

        def fake(url, params, headers, timeout):
            calls.append(params["date"])
            return _body(params["date"], "0")

        ad = get_adapter("pangle", env=ENV, dry_run=False)
        with patch("adapters.pangle.http_get", fake):
            rows = ad.fetch(None, None, now=NOW)
        self.assertEqual(calls, ["2026-11-03"])
        self.assertEqual(rows[0].amount_fen, 0)
