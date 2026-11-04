"""Live Omni refresh (READ ONLY). recharges=billHis, snapshots=agency customer list totalBalance (sub-accounts),
costs=queryAdData owner-level per sub per day. Secrets only from env file (OPPO_OMNI_ENV); never logged/persisted.
Data dir: FIN_DATA_DIR (default ../oppo-phase1/data/finance, outside git)."""
from __future__ import annotations
import datetime as dt, glob, json, os, sys, time
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Asia/Shanghai")
HERE = os.path.dirname(os.path.abspath(__file__))
P1 = os.path.abspath(os.path.join(HERE, "..", "..", "oppo-phase1"))
if P1 not in sys.path:
    sys.path.append(P1)
AGENCY = "1001108443"


def data_dir() -> str:
    d = os.environ.get("FIN_DATA_DIR") or os.path.join(P1, "data", "finance")
    os.makedirs(d, exist_ok=True); return d


def now(): return dt.datetime.now(TZ)
def today(): return now().date().isoformat()


def client():
    from oppo_omni.config import Settings
    from oppo_omni.client import OmniClient
    return OmniClient(Settings.from_env(os.environ.get("OPPO_OMNI_ENV", "/home/box/.secrets/oppo-omniapi.env")))


def _ymd(s): return s.replace("-", "")


def _ts(s, end=False):
    d = dt.datetime.strptime(_ymd(s), "%Y%m%d").replace(tzinfo=TZ)
    return int(d.timestamp()) + (86399 if end else 0)


def _write_jsonl(path, rows):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.writelines(json.dumps(r, ensure_ascii=False) + "\n" for r in rows)
    os.replace(tmp, path)


def _meta_path(): return os.path.join(data_dir(), "refresh-meta.json")


def read_meta() -> dict:
    try: return json.load(open(_meta_path(), encoding="utf-8"))
    except Exception: return {}


def _save_meta(kind, info):
    m = read_meta(); m[kind] = info
    json.dump(m, open(_meta_path(), "w", encoding="utf-8"), ensure_ascii=False, indent=1)


# ---------- recharges ----------
def refresh_recharges(start: str, end: str, c=None) -> dict:
    """Pull billHis [start,end] → billHis-{agency}-{start}-{end}.jsonl (+meta). Dedupe vs other caches is done by RechargeStore."""
    from oppo_omni import finance as F
    c = c or client(); txns, pages = [], []
    for items, m in F.fetch_bill_his(c, _ts(start), _ts(end, True)):
        pages.append(m); txns += [F.to_txn(i, m["request_id"]) for i in items]
    tag = f"{AGENCY}-{_ymd(start)}-{_ymd(end)}"
    path = os.path.join(data_dir(), f"billHis-{tag}.jsonl"); _write_jsonl(path, txns)
    sm = F.recharge_summary(txns)
    json.dump({"path": F.BILL_HIS, "loginType": 1, "range": [_ymd(start), _ymd(end)], "pages": pages, "n": len(txns),
               "fetched_at": now().isoformat(timespec="seconds"), "summary": {"recharge": sm}},
              open(path[:-6] + ".meta.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    info = {"at": now().isoformat(timespec="seconds"), "range": [start, end], "rows": len(txns), "pages": len(pages),
            "file": os.path.basename(path), "omni_parent_in_fen": sm["recharge_total_fen"], "omni_parent_in_count": sm["recharge_count"]}
    _save_meta("recharges", info); return info


# ---------- balance snapshots ----------
def snap_path(d): return os.path.join(data_dir(), "snapshots", f"snapshot-{d}.json")


def refresh_snapshot(c=None) -> dict:
    """Live customer list → per-sub totalBalance (fen) dated today (Asia/Shanghai). Agency own balance: no read path
    found (owner/balance needs sub ownerId; unifiedInfo has no balance) → agency_balance_fen=None + gap."""
    from oppo_omni.agency import fetch_customers
    c = c or client(); raw, rids = fetch_customers(c)
    subs, missing = {}, []
    for x in raw:
        oid = str(x.get("ownerId")); b = x.get("totalBalance")
        if b in (None, ""): missing.append(oid); continue
        subs[oid] = int(b)
    d, t = today(), now().isoformat(timespec="seconds")
    snap = {"snapshot_date": d, "taken_at": t, "agency_owner_id": AGENCY, "unit": "fen", "source": "omni_customer_list",
            "request_ids": rids, "sub_balances_fen": subs, "sub_count": len(subs), "sub_balance_missing": missing,
            "sub_sum_fen": sum(subs.values()) if not missing else None, "agency_balance_fen": None,
            "gap_flags": ["agency_balance_unavailable"] + (["sub_balance_missing"] if missing else []),
            "note": "日内快照（取数时刻），非日终；首个快照之前无历史余额"}
    os.makedirs(os.path.dirname(snap_path(d)), exist_ok=True)
    json.dump(snap, open(snap_path(d), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    info = {"at": t, "date": d, "subs": len(subs), "sub_sum_fen": snap["sub_sum_fen"]}
    _save_meta("snapshots", info); return info


# ---------- costs ----------
def cost_path(d): return os.path.join(data_dir(), "costs", f"cost-{d}.json")


def sub_owner_ids() -> list[str]:
    p = os.path.join(P1, "data", "customers", "customers-latest.json")
    return [str(x["ownerId"]) for x in json.load(open(p, encoding="utf-8"))["customers"]]


def refresh_costs(start: str, end: str, owners=None, c=None, sleep=0.0) -> dict:
    """queryAdData owner-level DAY per sub owner (fen). A day is complete only if every owner call succeeded."""
    from oppo_omni.reports import fetch_day
    c = c or client(); owners = owners or sub_owner_ids(); out = {}
    d0, d1 = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    while d0 <= d1:
        ds = d0.isoformat(); per, failed, rids = {}, {}, []
        for o in owners:
            try:
                rows, r = fetch_day(c, int(o), d0, "owner"); rids += r
                per[o] = sum(int(float(x.get("cost") or 0)) for x in rows)
            except Exception as e:  # never 0-fill a failure
                failed[o] = type(e).__name__ + ":" + str(getattr(e, "code", ""))[:20]
            if sleep: time.sleep(sleep)
        rec = {"biz_date": ds, "agency_owner_id": AGENCY, "unit": "fen", "source": "omni_queryAdData_owner",
               "fetched_at": now().isoformat(timespec="seconds"), "owners_total": len(owners), "per_owner_fen": per,
               "failed_owners": failed, "complete": not failed, "cost_fen": sum(per.values()) if not failed else None,
               "partial_cost_fen": sum(per.values()), "intraday": ds == today(), "request_ids": rids[:5]}
        os.makedirs(os.path.dirname(cost_path(ds)), exist_ok=True)
        json.dump(rec, open(cost_path(ds), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        out[ds] = {"complete": rec["complete"], "cost_fen": rec["cost_fen"], "failed": len(failed)}
        d0 += dt.timedelta(days=1)
    info = {"at": now().isoformat(timespec="seconds"), "range": [start, end], "owners": len(owners), "days": out}
    _save_meta("costs", info); return info


def load_dir(sub, prefix):
    out = {}
    for f in sorted(glob.glob(os.path.join(data_dir(), sub, prefix + "-*.json"))):
        try:
            r = json.load(open(f, encoding="utf-8")); out[r.get("biz_date") or r.get("snapshot_date")] = r
        except Exception:
            pass
    return out
