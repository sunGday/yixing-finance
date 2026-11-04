import os, sys, unittest
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from adapters import get_adapter, list_adapters, RevenueRow, CredentialMissingError, yuan_to_fen  # noqa
from adapters.base import AdapterNotFoundError
from sources.omni_billhis import to_recharge_dto
from reconcile import daily_fund_equation, gross_profit_draft


class T(unittest.TestCase):
    def test_registry(self):
        self.assertTrue({"pangle", "ylh", "gdt"} <= set(list_adapters()))
        self.assertEqual(get_adapter("gdt", env={}).ad_network, "ylh")
        with self.assertRaises(AdapterNotFoundError):
            get_adapter("admob")

    def test_fen(self):
        self.assertEqual(yuan_to_fen("12.345"), 1235)
        self.assertEqual(yuan_to_fen(0.1), 10)
        with self.assertRaises(ValueError):
            yuan_to_fen(None)
        with self.assertRaises(TypeError):
            RevenueRow(ad_network="pangle", stat_date="2026-11-03", amount_fen=1.5)

    def test_row_alias_and_fee(self):
        r = RevenueRow(ad_network="gdt", stat_date="2026-11-03", amount_fen=800, gross_amount_fen=1000)
        self.assertEqual((r.ad_network, r.fee_fen), ("ylh", 200)); self.assertTrue(r.revenue_id.startswith("ylh-"))
        with self.assertRaises(ValueError):
            RevenueRow(ad_network="pangle", stat_date="d", amount_fen=1, settlement_status="final")

    def test_missing_creds(self):
        for n in ("pangle", "ylh"):
            with self.assertRaises(CredentialMissingError):
                get_adapter(n, env={}).build_request("2026-11-03")

    def test_dry_run_build(self):
        req = get_adapter("pangle", env={"PANGLE_USER_ID": "u", "PANGLE_ROLE_ID": "r", "PANGLE_SECURE_KEY": "k"}).build_request("2026-11-03")
        self.assertTrue(req["dry_run"]); self.assertFalse(req["verified"]); self.assertEqual(len(req["params"]["sign"]), 32)
        req = get_adapter("ylh", env={"GDT_MEMBER_ID": "m", "GDT_SECRET": "s"}).build_request("2026-11-03", ts=1)
        self.assertTrue(req["dry_run"])
        with self.assertRaises(NotImplementedError):
            get_adapter("pangle", env={}).fetch("2026-11-01", "2026-11-03")

    def test_mapping(self):
        r = get_adapter("pangle", env={}).map_row({"revenue": "123.45", "show": "1000", "click": 7, "ecpm": "1.2", "app_id": 5, "ad_slot_id": 9}, "2026-11-03")
        self.assertEqual((r.amount_fen, r.impressions, r.ecpm_fen, r.placement_id), (12345, 1000, 120, "9"))
        r = get_adapter("ylh", env={}).map_row({"revenue": 2, "pv": 3}, "2026-11-03")
        self.assertEqual((r.ad_network, r.amount_fen), ("ylh", 200))

    def test_billhis(self):
        d = to_recharge_dto({"seqNo": "S1", "billTime": "2026-11-03 14:05:00", "billMoney": 2000000, "billType": 0,
                             "billSub": 300, "relateOwnerId": 123}, "rid-1")
        self.assertEqual((d["biz_date"], d["hour"], d["amount_fen"], d["direction"], d["to_owner_id"], d["request_id"]),
                         ("2026-11-03", 14, 2000000, "credit", "123", "rid-1"))
        with self.assertRaises(ValueError):
            to_recharge_dto({"billTime": "2026-11-03 00:00:00"})

    def test_recon(self):
        self.assertEqual(daily_fund_equation("d", 1, 100, 150, 100, 50)["status"], "matched")
        r = daily_fund_equation("d", 1, None, 150, 100, 50)
        self.assertEqual((r["status"], r["delta_fen"]), ("partial", None))
        g = gross_profit_draft("d", {"pangle": 500}, 300)
        self.assertIsNone(g["gross_profit_draft_fen"]); self.assertIn("revenue_missing:ylh", g["gap_flags"]); self.assertEqual(g["label"], "非关账")


if __name__ == "__main__":
    unittest.main()
