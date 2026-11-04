import os, sys, unittest
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


class ApiT(unittest.TestCase):
    def setUp(self):
        self._env = dict(os.environ)
        for k in CRED_KEYS + ("FIN_API_TOKEN", "FIN_REVENUE_MOCK"): os.environ.pop(k, None)
        self.c = TestClient(create_app(st.RechargeStore(ROWS)))

    def tearDown(self):
        os.environ.clear(); os.environ.update(self._env)

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
        self.assertEqual(fe["components"][0]["amount_fen"], 2000000); self.assertLess(fe["components"][1]["amount_fen"], 0)
        x = self.c.get("/api/v1/reconcile/summaries", params={"tab": "cross_source"}).json()["data"]["items"]
        self.assertTrue(x and all(r["tab"] == "cross_source" and r["gross_profit_draft_fen"] is None for r in x))
        self.assertEqual(self.c.get("/api/v1/reconcile/summaries", params={"tab": "kind"}).json()["code"], 40002)

    def test_stubs_and_cors(self):
        self.assertEqual(self.c.get("/api/v1/costs").json()["data"]["items"], [])
        self.assertIn("balance_snapshot_not_wired", self.c.get("/api/v1/snapshots").json()["data"]["gap_flags"])
        r = self.c.options("/api/v1/health", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"})
        self.assertEqual(r.status_code, 200); self.assertIn("access-control-allow-origin", r.headers)

    def test_cache_store(self):
        s = st.RechargeStore.from_cache()
        self.assertIn(s.source, ("jsonl_cache", "empty"))


if __name__ == "__main__":
    unittest.main()
