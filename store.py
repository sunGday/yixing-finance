"""In-memory + file-backed stores. Recharges: JSONL cache of Omni billHis (read-only); live Omni optional.
Revenues: adapters need PANGLE_*/YLH_* env; without creds → explicit mock fixtures + CredentialMissing gap."""
from __future__ import annotations
import glob, json, os
from adapters import get_adapter, CredentialMissingError
from adapters.base import RevenueRow
from dataclasses import asdict

HERE = os.path.dirname(os.path.abspath(__file__))
AGENCY_OWNER_ID = "1001108443"
GEN1_PARENT_OWNER_ID = "1000015399"  # 一代户（omni_parent_in 对端）
BASIS = {"basis": "omni_parent_in", "basis_alias": "gen1_transfer_in", "basis_status": "user_locked",
         "settlement_basis": "user_locked"}


def classify(r: dict) -> str:
    """main=omni_parent_in（一代→二代入账）；其余旁报。billSub=100 平台直充仅旁报；二代→子户=划拨非充值。"""
    if r.get("bill_sub") == 100:
        return "platform_direct"
    if r["direction"] == "debit":
        return "transfer_out"
    if r.get("bill_sub") == 300 and str(r.get("to_owner_id")) == GEN1_PARENT_OWNER_ID:
        return "omni_parent_in"
    return "reclaim_in"


def _norm(d: dict) -> dict:
    if d.get("amount_fen") in (None, ""):
        raise ValueError("amount_fen missing (no silent 0)")
    h = d.get("hour") if d.get("hour") is not None else (d.get("txn_time") or "")[11:13]
    r = {"txn_id": str(d["txn_id"]), "txn_time": d["txn_time"], "biz_date": d.get("biz_date") or d["txn_time"][:10],
         "hour": int(h) if str(h if h is not None else "").isdigit() else None,
         "amount_fen": int(d["amount_fen"]), "direction": d["direction"], "from_party": d.get("from_party"),
         "to_owner_id": str(d["to_owner_id"]) if d.get("to_owner_id") is not None else None,
         "agency_owner_id": str(d.get("agency_owner_id") or AGENCY_OWNER_ID), "channel": d.get("channel"),
         "balance_after_fen": d.get("balance_after_fen"), "request_id": d.get("request_id"),
         "evidence_path": d.get("evidence_path"), "posted_ledger_id": d.get("posted_ledger_id"),
         "status": d.get("status") or "raw", "bill_sub": d.get("bill_sub"), "bill_desc": d.get("bill_desc"),
         "to_owner_name": d.get("to_owner_name")}
    r["side"] = classify(r)
    return r


def find_cache_files() -> list[str]:
    env = os.environ.get("FIN_RECHARGE_JSONL")
    if env:
        return [p for p in env.split(os.pathsep) if os.path.exists(p)]
    root = os.path.abspath(os.path.join(HERE, ".."))
    fs = set(glob.glob(os.path.join(root, "**", f"billHis-{AGENCY_OWNER_ID}-*.jsonl"), recursive=True))
    dd = os.environ.get("FIN_DATA_DIR")
    if dd: fs |= set(glob.glob(os.path.join(dd, f"billHis-{AGENCY_OWNER_ID}-*.jsonl")))
    return sorted(fs, key=os.path.getmtime, reverse=True)  # newest first → newest wins on txn_id dedupe


class RechargeStore:
    def __init__(self, rows: list[dict] | None = None, source: str = "memory"):
        self.rows, self.source = [], source
        if rows:
            self.add(rows)

    def add(self, rows):
        seen = {r["txn_id"] for r in self.rows}
        for d in rows:
            r = _norm(d)
            if r["txn_id"] not in seen:
                seen.add(r["txn_id"]); self.rows.append(r)
        self.rows.sort(key=lambda r: r["txn_time"], reverse=True)

    @classmethod
    def from_cache(cls):
        files = find_cache_files(); rows = []
        for f in files:
            with open(f, encoding="utf-8") as fh:
                rows += [json.loads(l) for l in fh if l.strip()]
        s = cls(rows, source="omni_billhis_cache" if files else "empty")
        s.files = [os.path.relpath(f, os.path.join(HERE, "..")) for f in files]
        return s

    def query(self, start=None, end=None, to_owner_id=None, channel=None, direction=None, side=None):
        out = []
        for r in self.rows:
            if start and r["biz_date"] < start: continue
            if end and r["biz_date"] > end: continue
            if to_owner_id and r["to_owner_id"] != str(to_owner_id): continue
            if channel and r["channel"] != channel: continue
            if direction and r["direction"] != direction: continue
            if side and r["side"] != side: continue
            out.append(r)
        return out


# ---- revenues ----
MOCK_REVENUE_RAW = {
    "pangle": [{"date": "2026-11-03", "revenue": "1234.56", "show": 100000, "click": 820, "ecpm": "12.35", "app_id": "mock-app", "ad_slot_id": "mock-slot"}],
    "ylh": [{"date": "2026-11-03", "revenue": "876.50", "pv": 70000, "click": 540, "ecpm": "12.52", "app_id": "mock-app", "placement_id": "mock-pos"}],
}


def _append_mock(items, ad, network):
    for raw in MOCK_REVENUE_RAW[network]:
        d = asdict(ad.map_row(raw, raw["date"], evidence_ref="mock-fixture"))
        d.update(source="mock", verified=False)
        items.append(d)


def load_revenues(networks=("pangle", "ylh"), env=None, allow_mock=True, start=None, end=None):
    """returns (items, gap_flags, auth_notes).

    无凭证且 allow_mock：source=mock，并记 credential_missing。
    有凭证且适配器 live_supported：真拉。失败只记 live_fetch_error，不把 mock 当成 live。
    有凭证但适配器仍是骨架（优量汇）：live_fetch_unverified，allow_mock 时仍给 mock。
    某一网缺失不代表其它网不能返回。
    """
    env = os.environ if env is None else env
    items, gaps, notes = [], [], {}
    for n in networks:
        ad = get_adapter(n, env=env, dry_run=False)
        try:
            ad.credentials()
        except CredentialMissingError as e:
            gaps.append(f"credential_missing:{n}")
            notes[n] = f"CredentialMissing(50301): {e}"
            if allow_mock:
                _append_mock(items, ad, n)
            continue
        if not getattr(ad, "live_supported", False):
            gaps.append(f"live_fetch_unverified:{n}")
            notes[n] = "creds present; live fetch disabled (endpoint/sign 待复核)"
            if allow_mock:
                _append_mock(items, ad, n)
            continue
        try:
            rows = ad.fetch(start, end)
        except Exception as e:
            gaps.append(f"live_fetch_error:{n}")
            notes[n] = f"live fetch failed: {type(e).__name__}: {str(e).replace(chr(10), ' ')[:180]}"
            continue
        for r in rows:
            d = r.to_dict()
            d.update(source="live", verified=True)
            items.append(d)
        note = getattr(ad, "fetch_note", None)
        notes[n] = note or "live csj rt/income"
    return items, gaps, notes


# ---- costs / balance snapshots (file-backed, written by sources/refresh.py; never 0-filled) ----
class CostStore:
    def __init__(self, days: dict | None = None):
        self.days = days or {}

    @classmethod
    def from_disk(cls):
        from sources.refresh import load_dir
        return cls(load_dir("costs", "cost"))

    def cost_fen(self, d):
        r = self.days.get(d); return r.get("cost_fen") if r and r.get("complete") else None

    def items(self, s=None, e=None):
        return [{k: v for k, v in r.items() if k != "request_ids"} for d, r in sorted(self.days.items(), reverse=True)
                if (not s or d >= s) and (not e or d <= e)]


class SnapshotStore:
    def __init__(self, days: dict | None = None):
        self.days = days or {}

    @classmethod
    def from_disk(cls):
        from sources.refresh import load_dir
        return cls(load_dir("snapshots", "snapshot"))

    def sub_sum(self, d):
        r = self.days.get(d); return r.get("sub_sum_fen") if r else None

    def prior(self, d):
        prev = (__import__("datetime").date.fromisoformat(d) - __import__("datetime").timedelta(days=1)).isoformat()
        return self.sub_sum(prev)

    def items(self, s=None, e=None):
        return [r for d, r in sorted(self.days.items(), reverse=True) if (not s or d >= s) and (not e or d <= e)]
