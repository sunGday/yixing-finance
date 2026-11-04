import json, os, stat, sys, tempfile, unittest
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from fastapi.testclient import TestClient
import store as st
from main import create_app

ROWS = [
    {"txn_id": "P1", "txn_time": "2026-11-03 10:00:00", "amount_fen": 2000000, "direction": "credit", "bill_sub": 300, "to_owner_id": 1000015399, "channel": "omni_transfer"},
    {"txn_id": "D1", "txn_time": "2026-11-03 11:00:00", "amount_fen": 500, "direction": "credit", "bill_sub": 100, "to_owner_id": 1, "channel": "omni_recharge"},
    {"txn_id": "T1", "txn_time": "2026-11-03 12:00:00", "amount_fen": 300, "direction": "debit", "bill_sub": 300, "to_owner_id": 2, "channel": "omni_transfer"},
    {"txn_id": "R1", "txn_time": "2026-11-02 12:00:00", "amount_fen": 70, "direction": "credit", "bill_sub": 300, "to_owner_id": 2, "channel": "omni_transfer"},
]
CRED_KEYS = ("PANGLE_USER_ID", "PANGLE_ROLE_ID", "PANGLE_SECURE_KEY", "YLH_MEMBER_ID", "YLH_SECRET", "GDT_MEMBER_ID", "GDT_SECRET")


class _EnvBase(unittest.TestCase):
    """清 env + tmp FIN_SECRETS_DIR（绝不读写真实 secrets 目录）。"""
    def setUp(self):
        self._env = dict(os.environ)
        for k in CRED_KEYS + ("FIN_API_TOKEN", "FIN_REVENUE_MOCK", "FIN_REQUIRE_TOKEN", "FIN_CREDENTIALS_KEY"): os.environ.pop(k, None)
        self._tmp = tempfile.TemporaryDirectory(); os.environ["FIN_SECRETS_DIR"] = os.path.join(self._tmp.name, "secrets")
        self.c = TestClient(create_app(st.RechargeStore(ROWS), st.CostStore(), st.SnapshotStore()))

    def tearDown(self):
        os.environ.clear(); os.environ.update(self._env); self._tmp.cleanup()


class ApiT(_EnvBase):

    def test_health_open_dev(self):
        r = self.c.get("/api/v1/health")
        self.assertEqual(r.status_code, 200); self.assertEqual(r.headers["X-Auth-Mode"], "open-dev")
        j = r.json(); self.assertEqual(j["code"], 0); self.assertTrue(j["data"]["ok"]); self.assertTrue(j["request_id"].startswith("fin-"))

    def test_auth(self):
        os.environ["FIN_API_TOKEN"] = "t0k"
        r = self.c.get("/api/v1/recharges"); self.assertEqual((r.status_code, r.json()["code"]), (401, 40101))
        r = self.c.get("/api/v1/recharges", headers={"Authorization": "Bearer bad"}); self.assertEqual(r.json()["code"], 40101)
        r = self.c.get("/api/v1/recharges", headers={"Authorization": "Bearer t0k"}); self.assertEqual(r.status_code, 200)

    def test_recharges_list(self):
        j = self.c.get("/api/v1/recharges", params={"start_date": "2026-11-03", "end_date": "2026-11-03", "page_size": 2}).json()
        d = j["data"]; self.assertEqual((d["total"], len(d["items"]), d["basis"]), (3, 2, "omni_parent_in"))
        self.assertIsInstance(d["items"][0]["amount_fen"], int)
        self.assertEqual(self.c.get("/api/v1/recharges", params={"start_date": "bad"}).json()["code"], 40001)

    def test_summary_basis(self):
        d = self.c.get("/api/v1/recharges/summary", params={"start_date": "2026-11-01", "end_date": "2026-11-03"}).json()["data"]
        self.assertEqual((d["basis"], d["basis_alias"], d["basis_status"]), ("omni_parent_in", "gen1_transfer_in", "user_locked"))
        self.assertEqual(d["total_amount_fen"], 2000000)  # platform direct / transfer / reclaim excluded
        self.assertEqual({s["side"] for s in d["side_items"]}, {"platform_direct", "transfer_out", "reclaim_in"})
        h = self.c.get("/api/v1/recharges/summary", params={"granularity": "hour"}).json()["data"]
        self.assertEqual(h["items"][0]["hour"], 10)

    def test_revenues_mock_and_credential_missing(self):
        d = self.c.get("/api/v1/revenues").json()["data"]
        self.assertTrue(all(i["source"] == "mock" for i in d["items"])); self.assertFalse(d["verified"])
        self.assertIn("credential_missing:pangle", d["gap_flags"]); self.assertIn("CredentialMissing", d["auth_note"]["ylh"])
        self.assertEqual(self.c.get("/api/v1/revenues", params={"ad_network": "gdt"}).json()["data"]["items"][0]["ad_network"], "ylh")
        r = self.c.get("/api/v1/revenues", params={"strict": "true"}); self.assertEqual((r.status_code, r.json()["code"]), (503, 50301))
        self.assertEqual(self.c.get("/api/v1/revenues", params={"ad_network": "admob"}).json()["code"], 40002)

    def test_reconcile(self):
        d = self.c.get("/api/v1/reconcile/summaries", params={"start_date": "2026-11-03", "end_date": "2026-11-03", "page_size": 500}).json()["data"]
        tabs = {r["tab"] for r in d["items"]}; self.assertEqual(tabs, {"fund_equation", "agency_daily", "revenue_dedup", "cross_source"})
        fe = [r for r in d["items"] if r["tab"] == "fund_equation"][0]
        self.assertIsNone(fe["left_fen"]); self.assertIsNone(fe["delta_fen"]); self.assertTrue(fe["components"])
        self.assertEqual(fe["components"][0]["amount_fen"], 2000000); self.assertIn("cost_missing", fe["gap_flags"]); self.assertIn("agency_balance_unavailable", fe["gap_flags"])
        x = self.c.get("/api/v1/reconcile/summaries", params={"tab": "cross_source"}).json()["data"]["items"]
        self.assertTrue(x and all(r["tab"] == "cross_source" and r["gross_profit_draft_fen"] is None for r in x))
        self.assertEqual(self.c.get("/api/v1/reconcile/summaries", params={"tab": "kind"}).json()["code"], 40002)

    def test_stubs_and_cors(self):
        self.assertEqual(self.c.get("/api/v1/costs").json()["data"]["items"], [])
        self.assertIn("balance_snapshot_empty", self.c.get("/api/v1/snapshots").json()["data"]["gap_flags"])
        r = self.c.options("/api/v1/health", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"})
        self.assertEqual(r.status_code, 200); self.assertIn("access-control-allow-origin", r.headers)

    def test_cache_store(self):
        s = st.RechargeStore.from_cache()
        self.assertIn(s.source, ("omni_billhis_cache", "empty"))

    def test_require_token_blocks_open_dev(self):
        os.environ["FIN_REQUIRE_TOKEN"] = "1"
        self.assertEqual(self.c.get("/api/v1/health").status_code, 503)
        os.environ.pop("FIN_REQUIRE_TOKEN")
        self.assertEqual(self.c.get("/api/v1/health", headers={"X-Forwarded-For": "1.2.3.4"}).status_code, 503)
        os.environ["FIN_API_TOKEN"] = "t"
        self.assertEqual(self.c.get("/api/v1/health", headers={"X-Forwarded-For": "1.2.3.4", "Authorization": "Bearer t"}).status_code, 200)

    def test_cors_post(self):
        r = self.c.options("/api/v1/admin/reload", headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST"})
        self.assertEqual(r.status_code, 200)

    def test_refresh_bad_kind(self):
        self.assertEqual(self.c.post("/api/v1/admin/refresh/nope").json()["code"], 40001)


COST = {"2026-11-03": {"biz_date": "2026-11-03", "complete": True, "cost_fen": 1000, "per_owner_fen": {"2": 1000}, "failed_owners": {}},
        "2026-11-02": {"biz_date": "2026-11-02", "complete": False, "cost_fen": None, "per_owner_fen": {}, "failed_owners": {"2": "X"}}}
SNAP = {"2026-11-02": {"snapshot_date": "2026-11-02", "sub_sum_fen": 10000}, "2026-11-03": {"snapshot_date": "2026-11-03", "sub_sum_fen": 9000}}


FAKE_PANGLE = {"PANGLE_USER_ID": "u123456", "PANGLE_ROLE_ID": "r98765", "PANGLE_SECURE_KEY": "s3cr3t-FAKE-pangle-zz"}
FAKE_YLH = {"GDT_MEMBER_ID": "m555777", "YLH_SECRET": "ylh-FAKE-secret-qq"}


class CredT(_EnvBase):
    """收入渠道凭证 API；FIN_SECRETS_DIR = tmp。"""

    def _put(self, ch, f, m="put"): return getattr(self.c, m)(f"/api/v1/credentials/{ch}", json={"fields": f})

    def test_cred_schema(self):
        ch = {c["id"]: c for c in self.c.get("/api/v1/credentials/schema").json()["data"]["channels"]}
        self.assertEqual([f["key"] for f in ch["pangle"]["fields"]], ["PANGLE_USER_ID", "PANGLE_ROLE_ID", "PANGLE_SECURE_KEY"])
        self.assertEqual([f["key"] for f in ch["ylh"]["fields"]], ["YLH_MEMBER_ID", "YLH_SECRET"])
        self.assertIn("csj", ch["pangle"]["aliases"]); self.assertIn("gdt", ch["ylh"]["aliases"])
        sec = {f["key"]: f["secret"] for c in ch.values() for f in c["fields"]}
        self.assertTrue(sec["PANGLE_SECURE_KEY"] and sec["YLH_SECRET"]); self.assertFalse(sec["PANGLE_USER_ID"])
        self.assertEqual(ch["ylh"]["fields"][1]["aliases"], ["GDT_SECRET"])
        d = self.c.get("/api/v1/credentials").json()["data"]
        self.assertEqual({c["status"] for c in d["channels"]}, {"missing"}); self.assertFalse(d["storage"]["exists"])

    def test_cred_put_get_masked_and_file(self):
        r = self._put("pangle", FAKE_PANGLE); self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["data"]["status"], "configured"); self.assertNotIn("s3cr3t", r.text)
        g = self.c.get("/api/v1/credentials/csj"); self.assertNotIn("s3cr3t", g.text); self.assertNotIn("u123456", g.text)
        f = {x["key"]: x for x in g.json()["data"]["fields"]}
        self.assertEqual(f["PANGLE_SECURE_KEY"]["hint"], "••••"); self.assertEqual(f["PANGLE_USER_ID"]["hint"], "u***56")
        self.assertEqual(f["PANGLE_USER_ID"]["source"], "file"); self.assertTrue(g.json()["data"]["updated_at"].endswith("+08:00"))
        self.assertNotIn("s3cr3t", self.c.get("/api/v1/credentials").text); self.assertNotIn("s3cr3t", self.c.get("/api/v1/health").text)
        p = os.path.join(os.environ["FIN_SECRETS_DIR"], "revenue-credentials.json")
        self.assertEqual(stat.S_IMODE(os.stat(p).st_mode), 0o600); self.assertEqual(stat.S_IMODE(os.stat(os.path.dirname(p)).st_mode), 0o700)
        self.assertEqual(json.load(open(p))["channels"]["pangle"]["fields"]["PANGLE_ROLE_ID"], "r98765")
        self.assertEqual(self.c.get("/api/v1/health").json()["data"]["credentials"], {"pangle": "configured", "ylh": "missing"})
        # alias field GDT_MEMBER_ID → YLH_MEMBER_ID
        self.assertEqual(self._put("gdt", FAKE_YLH).json()["data"]["status"], "configured")
        self.assertIn("YLH_MEMBER_ID", json.load(open(p))["channels"]["ylh"]["fields"])

    def test_cred_patch_clear_and_delete(self):
        self._put("pangle", FAKE_PANGLE)
        d = self._put("pangle", {"PANGLE_SECURE_KEY": ""}, "patch").json()["data"]
        self.assertEqual(d["status"], "partial"); self.assertNotIn("PANGLE_SECURE_KEY", os.environ)
        self.assertEqual(os.environ["PANGLE_USER_ID"], "u123456")
        d = self._put("pangle", {"PANGLE_ROLE_ID": "r1"}, "patch").json()["data"]  # 未给的键保留
        self.assertEqual({f["key"]: f["set"] for f in d["fields"]}, {"PANGLE_USER_ID": True, "PANGLE_ROLE_ID": True, "PANGLE_SECURE_KEY": False})
        self.assertEqual(self._put("pangle", {"PANGLE_USER_ID": "", "PANGLE_ROLE_ID": ""}, "patch").json()["data"]["status"], "missing")
        self._put("pangle", FAKE_PANGLE)
        d = self.c.delete("/api/v1/credentials/pangle").json()["data"]
        self.assertEqual((d["status"], d["deleted"]), ("missing", True)); self.assertNotIn("PANGLE_USER_ID", os.environ)
        self.assertIn("credential_missing:pangle", self.c.get("/api/v1/revenues").json()["data"]["gap_flags"])

    def test_cred_put_replaces_channel(self):
        self._put("pangle", FAKE_PANGLE)
        self.assertEqual(self._put("pangle", {"PANGLE_USER_ID": "u2"}).json()["data"]["status"], "partial")

    def test_cred_errors(self):
        self.assertEqual(self._put("admob", {"X": "1"}).json()["code"], 40002)
        self.assertEqual(self.c.get("/api/v1/credentials/admob").json()["code"], 40002)
        self.assertEqual(self.c.delete("/api/v1/credentials/admob").json()["code"], 40002)
        r = self._put("pangle", {"PANGLE_FOO": "1"}); self.assertEqual((r.status_code, r.json()["code"]), (400, 40002))
        self.assertEqual(self._put("pangle", {"YLH_SECRET": "x"}).json()["code"], 40002)  # 跨渠道字段
        self.assertEqual(self.c.put("/api/v1/credentials/pangle", json={"PANGLE_USER_ID": "x"}).json()["code"], 40001)
        self.assertEqual(self._put("pangle", {"PANGLE_USER_ID": "a\nb"}).json()["code"], 40001)
        self.assertFalse(os.path.exists(os.path.join(os.environ["FIN_SECRETS_DIR"], "revenue-credentials.json")))

    def test_cred_clears_revenue_gap(self):
        self._put("pangle", FAKE_PANGLE)
        d = self.c.get("/api/v1/revenues").json()["data"]
        self.assertNotIn("credential_missing:pangle", d["gap_flags"]); self.assertIn("live_fetch_unverified:pangle", d["gap_flags"])
        self.assertIn("credential_missing:ylh", d["gap_flags"]); self.assertFalse(d["verified"])
        self.assertNotIn("s3cr3t", json.dumps(d))

    def test_cred_reload_and_env_wins(self):
        self._put("pangle", FAKE_PANGLE)
        for k in FAKE_PANGLE: os.environ.pop(k, None)
        os.environ["PANGLE_USER_ID"] = "envuser"  # 运维紧急覆盖
        c2 = TestClient(create_app(st.RechargeStore(ROWS), st.CostStore(), st.SnapshotStore()))
        self.assertEqual(os.environ["PANGLE_USER_ID"], "envuser"); self.assertEqual(os.environ["PANGLE_ROLE_ID"], "r98765")
        f = {x["key"]: x for x in c2.get("/api/v1/credentials/pangle").json()["data"]["fields"]}
        self.assertEqual((f["PANGLE_USER_ID"]["source"], f["PANGLE_USER_ID"]["overridden_by_env"]), ("env", True))
        c2.delete("/api/v1/credentials/pangle")
        self.assertEqual(os.environ.get("PANGLE_USER_ID"), "envuser"); self.assertNotIn("PANGLE_ROLE_ID", os.environ)

    def test_cred_fernet(self):
        from cryptography.fernet import Fernet
        os.environ["FIN_CREDENTIALS_KEY"] = Fernet.generate_key().decode()
        self._put("pangle", FAKE_PANGLE)
        raw = open(os.path.join(os.environ["FIN_SECRETS_DIR"], "revenue-credentials.json")).read()
        self.assertNotIn("u123456", raw); self.assertIn("fernet", raw)
        for k in FAKE_PANGLE: os.environ.pop(k, None)
        c2 = TestClient(create_app(st.RechargeStore(ROWS), st.CostStore(), st.SnapshotStore()))
        self.assertEqual(c2.get("/api/v1/credentials/pangle").json()["data"]["status"], "configured")

    def test_cors_put_patch_delete(self):
        for m in ("PUT", "PATCH", "DELETE"):
            r = self.c.options("/api/v1/credentials/pangle", headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": m})
            self.assertEqual(r.status_code, 200, m)

    def test_cred_requires_token(self):
        os.environ["FIN_API_TOKEN"] = "t0k"
        self.assertEqual(self._put("pangle", FAKE_PANGLE).status_code, 401)
        self.assertEqual(self.c.get("/api/v1/credentials").status_code, 401)
        r = self.c.put("/api/v1/credentials/pangle", json={"fields": FAKE_PANGLE}, headers={"Authorization": "Bearer t0k"})
        self.assertEqual(r.status_code, 200)


class LiveInjectT(unittest.TestCase):
    def setUp(self):
        self.c = TestClient(create_app(st.RechargeStore(ROWS), st.CostStore(COST), st.SnapshotStore(SNAP)))

    def test_costs_snapshots(self):
        d = self.c.get("/api/v1/costs").json()["data"]
        self.assertEqual(d["total"], 2); self.assertIn("cost_missing:2026-11-02", d["gap_flags"])
        self.assertEqual(self.c.get("/api/v1/snapshots").json()["data"]["total"], 2)

    def test_reconcile_with_live(self):
        it = self.c.get("/api/v1/reconcile/summaries", params={"start_date": "2026-11-03", "end_date": "2026-11-03"}).json()["data"]["items"]
        subs = [r for r in it if r["scope"].startswith("subs:")][0]
        # Δ=9000-10000=-1000 ; right = (300-0) - 1000 + 500 = -200 → delta -800, explicit unmatched, no fake match
        self.assertEqual(subs["left_fen"], -1000); self.assertEqual(subs["right_fen"], -200); self.assertEqual(subs["status"], "unmatched")
        x = [r for r in it if r["tab"] == "cross_source"][0]; self.assertEqual(x["cost_fen"], 1000)
        it2 = self.c.get("/api/v1/reconcile/summaries", params={"start_date": "2026-11-02", "end_date": "2026-11-02"}).json()["data"]["items"]
        s2 = [r for r in it2 if r["scope"].startswith("subs:")][0]
        self.assertIn("cost_missing", s2["gap_flags"]); self.assertIn("open_balance_missing", s2["gap_flags"])


class RefreshMapT(unittest.TestCase):
    def test_to_txn_and_classify(self):
        from sources import refresh  # noqa: import must not need network/secrets
        from oppo_omni import finance as F
        t = F.to_txn({"billTime": "2026-11-03 10:00:00", "billMoney": 123, "billType": 0, "billSub": 300, "relateOwnerId": 1000015399}, "r")
        r = st._norm(t); self.assertEqual(r["side"], "omni_parent_in"); self.assertEqual(r["amount_fen"], 123); self.assertEqual(r["hour"], 10)

    def test_cost_store_never_zero_fill(self):
        self.assertIsNone(st.CostStore(COST).cost_fen("2026-11-02")); self.assertIsNone(st.CostStore().cost_fen("2026-11-03"))


if __name__ == "__main__":
    unittest.main()
