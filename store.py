"""In-memory + file-backed stores. Recharges: JSONL cache of Omni billHis (read-only); live Omni optional.
Revenues: adapters need PANGLE_*/YLH_* env; without creds → explicit mock fixtures + CredentialMissing gap."""
from __future__ import annotations
import datetime as _dt
import glob, json, os, re, threading, uuid
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


# ---- settlements（手工结算单，DATA_DIR，非 secrets）----
# holiday：完成签订 = settled（正式入账金额）；待收票仍 settled；已支付 = paid（收款，不二次入收入）。
# estimated 只存在于预估展示，不写入本文件。
SETTLEMENTS_FILE = "settlements.json"
BUSINESS_TYPES = ("sdk_ads", "ad_coop")
_SH = _dt.timezone(_dt.timedelta(hours=8))
_NET_ALIAS = {"pangle": "pangle", "csj": "pangle", "ylh": "ylh", "gdt": "ylh",
              "kuaishou": "kuaishou", "ks": "kuaishou", "gm_adx": "gm_adx"}
_SID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}")
_PERIOD = re.compile(r"\d{4}-(0[1-9]|1[0-2])$")
_SECRET_MARK = ("SECRET", "SECURE_KEY", "TOKEN", "PASSWORD", "CREDENTIALS_KEY")


class SettlementError(Exception):
    def __init__(self, code: int, http: int, msg: str):
        super().__init__(msg)
        self.code, self.http, self.msg = code, http, msg


def sh_today() -> _dt.date:
    return _dt.datetime.now(_SH).date()


def sh_iso() -> str:
    return _dt.datetime.now(_SH).isoformat(timespec="seconds")


def _no_secret(value: str, field: str):
    if not value:
        return
    for k, v in os.environ.items():
        if not v or len(v) < 6:
            continue
        ku = k.upper()
        if any(mark in ku for mark in _SECRET_MARK) and v in value:
            raise SettlementError(40001, 400, f"{field} must not contain secrets")


def mask_text(value: str | None) -> str | None:
    if not value:
        return value
    out = value
    for k, v in os.environ.items():
        if not v or len(v) < 6:
            continue
        if any(mark in k.upper() for mark in _SECRET_MARK) and v in out:
            out = out.replace(v, "••••")
    return out


def _date_field(v, name, required: bool):
    if v in (None, ""):
        if required:
            raise SettlementError(40001, 400, f"{name} required (YYYY-MM-DD)")
        return None
    if not isinstance(v, str):
        raise SettlementError(40001, 400, f"{name} must be YYYY-MM-DD")
    try:
        _dt.date.fromisoformat(v)
    except ValueError:
        raise SettlementError(40001, 400, f"{name} must be YYYY-MM-DD")
    return v


def _network_field(v):
    if v in (None, ""):
        return None
    if not isinstance(v, str):
        raise SettlementError(40002, 400, "ad_network must be pangle|ylh|kuaishou|gm_adx or empty")
    n = _NET_ALIAS.get(v.strip().lower())
    if not n:
        raise SettlementError(40002, 400, "ad_network must be pangle|ylh|kuaishou|gm_adx or empty")
    return n


def _amount_field(v):
    if isinstance(v, bool) or not isinstance(v, int):
        raise SettlementError(40001, 400, "amount_fen must be int fen")
    if v < 0:
        raise SettlementError(40001, 400, "amount_fen must be >= 0")
    return v


def _evidence_field(v):
    if v is None:
        raise SettlementError(40001, 400, "evidence_ref required")
    if not isinstance(v, str):
        raise SettlementError(40001, 400, "evidence_ref must be string")
    v = v.strip()
    if not v:
        raise SettlementError(40001, 400, "evidence_ref required")
    if len(v) > 500 or any(c in v for c in "\r\n\x00"):
        raise SettlementError(40001, 400, "evidence_ref invalid")
    _no_secret(v, "evidence_ref")
    return v


def normalize_settlement(raw: dict, *, created_at: str | None = None, settlement_id: str | None = None) -> dict:
    if not isinstance(raw, dict):
        raise SettlementError(40001, 400, "settlement must be an object")
    period = raw.get("period")
    if not isinstance(period, str) or not _PERIOD.match(period):
        raise SettlementError(40001, 400, "period must be YYYY-MM")
    bt = raw.get("business_type")
    if bt not in BUSINESS_TYPES:
        raise SettlementError(40002, 400, f"business_type must be one of {list(BUSINESS_TYPES)}")
    status = raw.get("settlement_status")
    if status == "estimated":
        raise SettlementError(40002, 400, "settlement_status estimated is display-only and cannot be stored")
    if status not in ("settled", "paid"):
        raise SettlementError(40002, 400, "settlement_status must be settled|paid")
    paid = _date_field(raw.get("paid_date"), "paid_date", status == "paid")
    if status == "settled" and paid:
        raise SettlementError(40001, 400, "paid_date only when settlement_status=paid")
    sid = settlement_id or raw.get("settlement_id") or ("stl-" + uuid.uuid4().hex[:12])
    if not isinstance(sid, str) or not _SID.match(sid):
        raise SettlementError(40001, 400, "settlement_id invalid")
    now = sh_iso()
    return {
        "settlement_id": sid,
        "period": period,
        "business_type": bt,
        "ad_network": _network_field(raw.get("ad_network")),
        "amount_fen": _amount_field(raw.get("amount_fen")),
        "settlement_status": status,
        "signed_date": _date_field(raw.get("signed_date"), "signed_date", True),
        "paid_date": paid,
        "evidence_ref": _evidence_field(raw.get("evidence_ref")),
        "created_at": created_at or now,
        "updated_at": now,
    }


def public_settlement(rec: dict) -> dict:
    out = dict(rec)
    out["evidence_ref"] = mask_text(rec.get("evidence_ref"))
    return out


class SettlementStore:
    def __init__(self, path: str | None = None):
        self._path = path
        self._lock = threading.Lock()

    def resolve(self, mkdir: bool = False) -> str:
        if self._path:
            if mkdir:
                os.makedirs(os.path.dirname(os.path.abspath(self._path)) or ".", exist_ok=True)
            return self._path
        from sources.refresh import data_dir
        return os.path.join(data_dir(), SETTLEMENTS_FILE)

    def load(self) -> list[dict]:
        p = self.resolve(False)
        if not os.path.exists(p):
            return []
        try:
            with open(p, encoding="utf-8") as fh:
                obj = json.load(fh)
        except Exception:
            raise SettlementError(50301, 503, "settlements file unreadable")
        items = obj.get("items") if isinstance(obj, dict) else obj
        if not isinstance(items, list):
            raise SettlementError(50301, 503, "settlements file unreadable")
        return items

    def _save(self, items: list[dict]):
        p = self.resolve(True)
        items = sorted(items, key=lambda r: (r.get("period") or "", r.get("settlement_id") or ""))
        body = json.dumps({"version": 1, "items": items}, ensure_ascii=False, indent=1)
        tmp = p + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write(body)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, p)

    def create(self, raw: dict) -> dict:
        rec = normalize_settlement(raw)
        with self._lock:
            items = self.load()
            if any(i.get("settlement_id") == rec["settlement_id"] for i in items):
                raise SettlementError(40901, 409, "settlement_id exists")
            items.append(rec)
            self._save(items)
        return public_settlement(rec)

    def patch(self, sid: str, raw: dict) -> dict:
        if not isinstance(raw, dict) or not raw:
            raise SettlementError(40001, 400, "patch body required")
        allowed = {"period", "business_type", "ad_network", "amount_fen", "settlement_status",
                   "signed_date", "paid_date", "evidence_ref"}
        unknown = set(raw) - allowed
        if unknown:
            raise SettlementError(40002, 400, f"unknown field {sorted(unknown)[0]}")
        with self._lock:
            items = self.load()
            cur = next((i for i in items if i.get("settlement_id") == sid), None)
            if cur is None:
                raise SettlementError(40401, 404, "settlement not found")
            merged = dict(cur)
            merged.update(raw)
            if cur.get("settlement_status") == "paid" and merged.get("settlement_status") == "settled":
                raise SettlementError(40901, 409, "paid cannot revert to settled")
            if merged.get("settlement_status") == "paid" and not merged.get("paid_date"):
                merged["paid_date"] = sh_today().isoformat()
            rec = normalize_settlement(merged, created_at=cur.get("created_at"), settlement_id=sid)
            items = [rec if i.get("settlement_id") == sid else i for i in items]
            self._save(items)
        return public_settlement(rec)

    def import_rows(self, raws: list) -> dict:
        if not isinstance(raws, list) or not raws:
            raise SettlementError(40001, 400, "items required")
        if len(raws) > 500:
            raise SettlementError(40001, 400, "too many items")
        with self._lock:
            items = self.load()
            by = {i["settlement_id"]: i for i in items}
            staged: dict[str, dict] = dict(by)
            out = []
            for raw in raws:
                prev = staged.get(raw.get("settlement_id")) if isinstance(raw, dict) else None
                rec = normalize_settlement(
                    raw, created_at=(prev or {}).get("created_at"),
                    settlement_id=(prev or {}).get("settlement_id") if prev else None)
                staged[rec["settlement_id"]] = rec
                out.append(public_settlement(rec))
            inserted = sum(1 for sid in staged if sid not in by)
            updated = sum(1 for sid in by if staged.get(sid) is not by[sid])
            self._save(list(staged.values()))
        return {"inserted": inserted, "updated": updated, "items": out}
