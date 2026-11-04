from __future__ import annotations
import datetime as dt, os, uuid
from collections import defaultdict
from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse
from adapters import CredentialMissingError
from adapters.base import normalize_network, SETTLEMENT_STATUS
from reconcile import RECON_TABS, agency_daily, revenue_dedup, gross_profit_draft, daily_fund_equation
import store as st

VERSION = "0.3.0"
router = APIRouter(prefix="/api/v1")


class ApiError(Exception):
    def __init__(self, code: int, http: int, msg: str, data=None):
        self.code, self.http, self.msg, self.data = code, http, msg, data


def rid(): return "fin-" + uuid.uuid4().hex[:12]
def ok(data): return {"code": 0, "msg": "ok", "request_id": rid(), "data": data}


def _date(v, name):
    if v is None: return None
    try: dt.date.fromisoformat(v); return v
    except ValueError: raise ApiError(40001, 400, f"{name} must be YYYY-MM-DD")


def _dates(s, e):
    s, e = _date(s, "start_date"), _date(e, "end_date")
    if s and e and s > e: raise ApiError(40001, 400, "start_date > end_date")
    return s, e


def _page(items, page, page_size):
    if page < 1 or not (1 <= page_size <= 500): raise ApiError(40001, 400, "page>=1, 1<=page_size<=500")
    return {"page": page, "page_size": page_size, "total": len(items), "items": items[(page-1)*page_size: page*page_size]}


def _enum(v, allowed, name, code=40002):
    if v is not None and v not in allowed: raise ApiError(code, 400, f"{name} must be one of {list(allowed)}")


def rstore(req: Request) -> st.RechargeStore: return req.app.state.recharges


@router.get("/health")
def health(req: Request):
    s = rstore(req)
    return ok({"ok": True, "version": VERSION, "recharge_source": s.source, "recharge_rows": len(s.rows),
               "auth_mode": "token" if os.environ.get("FIN_API_TOKEN") else "open-dev"})


@router.get("/recharges")
def recharges(req: Request, start_date: str | None = None, end_date: str | None = None, to_owner_id: str | None = None,
              channel: str | None = None, direction: str | None = None, side: str | None = None,
              page: int = 1, page_size: int = 50):
    s, e = _dates(start_date, end_date)
    _enum(direction, ("credit", "debit"), "direction", 40001)
    _enum(side, ("omni_parent_in", "platform_direct", "transfer_out", "reclaim_in"), "side")
    items = rstore(req).query(s, e, to_owner_id, channel, direction, side)
    d = _page(items, page, page_size); d.update(source=rstore(req).source, **st.BASIS)
    return ok(d)


@router.get("/recharges/summary")
def recharge_summary(req: Request, start_date: str | None = None, end_date: str | None = None,
                     granularity: str = "day", group_by: str | None = None, channel: str | None = None,
                     to_owner_id: str | None = None):
    s, e = _dates(start_date, end_date)
    _enum(granularity, ("day", "hour"), "granularity", 40001)
    _enum(group_by, ("to_owner_id",), "group_by", 40001)
    rows = rstore(req).query(s, e, to_owner_id, channel)
    main, side = defaultdict(lambda: [0, 0]), defaultdict(lambda: [0, 0])
    for r in rows:
        k = (r["biz_date"], r["hour"] if granularity == "hour" else None,
             r["to_owner_id"] if group_by else None, r["channel"])
        b = main[k] if r["side"] == "omni_parent_in" else side[k + (r["side"],)]
        b[0] += r["amount_fen"]; b[1] += 1
    items = [{"biz_date": k[0], "hour": k[1], "to_owner_id": k[2], "channel": k[3], "amount_fen": v[0], "count": v[1]}
             for k, v in sorted(main.items(), key=lambda x: (x[0][0], x[0][1] or -1))]
    side_items = [{"biz_date": k[0], "hour": k[1], "to_owner_id": k[2], "channel": k[3], "side": k[4],
                   "amount_fen": v[0], "count": v[1]} for k, v in sorted(side.items(), key=lambda x: (x[0][0], x[0][1] or -1, x[0][4]))]
    gaps = [] if rstore(req).rows else ["recharge_source_empty"]
    return ok({"granularity": granularity, **st.BASIS, "total_amount_fen": sum(i["amount_fen"] for i in items),
               "items": items, "side_items": side_items, "side_note": "旁报不并入主合计", "gap_flags": gaps,
               "source": rstore(req).source})


def _revenues(ad_network, settlement_status, s, e, strict=False):
    nets = ("pangle", "ylh")
    if ad_network:
        try: nets = (normalize_network(ad_network),)
        except ValueError as x: raise ApiError(40002, 400, str(x))
    _enum(settlement_status, SETTLEMENT_STATUS, "settlement_status")
    allow_mock = os.environ.get("FIN_REVENUE_MOCK", "1") != "0" and not strict
    items, gaps, notes = st.load_revenues(nets, allow_mock=allow_mock)
    if not allow_mock and any(g.startswith("credential_missing") for g in gaps):
        raise ApiError(50301, 503, "CredentialMissingError", {"gap_flags": gaps, "auth_note": notes})
    items = [i for i in items if (not s or i["stat_date"] >= s) and (not e or i["stat_date"] <= e)
             and (not settlement_status or i["settlement_status"] == settlement_status)]
    return items, gaps, notes


@router.get("/revenues")
def revenues(start_date: str | None = None, end_date: str | None = None, ad_network: str | None = None,
             settlement_status: str | None = None, strict: bool = False, page: int = 1, page_size: int = 50):
    s, e = _dates(start_date, end_date)
    items, gaps, notes = _revenues(ad_network, settlement_status, s, e, strict)
    d = _page(items, page, page_size)
    d.update(source="mock" if any(i.get("source") == "mock" for i in items) else "live", verified=False,
             gap_flags=gaps, auth_note=notes)
    return ok(d)


@router.get("/reconcile/summaries")
def reconcile(req: Request, start_date: str | None = None, end_date: str | None = None, status: str | None = None,
              tab: str | None = None, to_owner_id: str | None = None, granularity: str = "day",
              page: int = 1, page_size: int = 50):
    s, e = _dates(start_date, end_date)
    _enum(tab, RECON_TABS, "tab"); _enum(status, ("matched", "partial", "unmatched"), "status")
    _enum(granularity, ("day",), "granularity", 40001)
    recs = rstore(req).query(s, e)
    dates = sorted({r["biz_date"] for r in recs}, reverse=True)
    rev_items, rev_gaps, _ = _revenues(None, None, s, e)
    live_rev = [i for i in rev_items if i.get("source") != "mock"]  # mock 不进对账
    rows = []
    for d in dates:
        day = [r for r in recs if r["biz_date"] == d]
        pin = [r for r in day if r["side"] == "omni_parent_in"]
        pin_fen = sum(r["amount_fen"] for r in pin) if pin else None
        out = [r for r in day if r["side"] == "transfer_out"]
        rin = [r for r in day if r["side"] == "reclaim_in"]
        comps = [{"label": "一代→二代入账(充值)", "ref": f"omni_parent_in:{len(pin)}", "amount_fen": pin_fen},
                 {"label": "二代→子户划拨", "ref": f"transfer_out:{len(out)}", "amount_fen": -sum(r['amount_fen'] for r in out)},
                 {"label": "子户划回回收", "ref": f"reclaim_in:{len(rin)}", "amount_fen": sum(r['amount_fen'] for r in rin)}]
        fe = daily_fund_equation(d, st.AGENCY_OWNER_ID, None, None, pin_fen, None, components=comps)
        fe["note"] = "期初/期末余额与消耗未接入"; rows.append(fe)
        sub_sum = None  # 子户层未接入
        ag = agency_daily(d, st.AGENCY_OWNER_ID, sub_sum, sum(r["amount_fen"] for r in out) or None, components=comps[1:2])
        ag["note"] = "子户层数据未接入"; rows.append(ag)
        for n in ("pangle", "ylh"):
            nr = [i for i in live_rev if i["ad_network"] == n and i["stat_date"] == d]
            est = sum(i["amount_fen"] for i in nr if i["settlement_status"] == "estimated") if nr else None
            stl = sum(i["amount_fen"] for i in nr if i["settlement_status"] != "estimated") or None if nr else None
            rd = revenue_dedup(d, n, est, stl); rd["gap_flags"] += [g for g in rev_gaps if g.endswith(":" + n)]; rows.append(rd)
        rev_by = {n: (sum(i["amount_fen"] for i in live_rev if i["ad_network"] == n and i["stat_date"] == d) or None) for n in ("pangle", "ylh")}
        x = gross_profit_draft(d, rev_by, None, components=[{"label": "Omni 消耗", "ref": "cost", "amount_fen": None}])
        rows.append(x)
    rows = [r for r in rows if (not tab or r["tab"] == tab) and (not status or r["status"] == status)]
    data = _page(rows, page, page_size); data.update(gap_flags=sorted(set(rev_gaps)), revenue_mock_excluded=True)
    return ok(data)


@router.get("/costs")
def costs(start_date: str | None = None, end_date: str | None = None, page: int = 1, page_size: int = 50):
    _dates(start_date, end_date)
    d = _page([], page, page_size); d.update(gap_flags=["cost_source_not_wired"], note="Omni 消耗未接入（stub）"); return ok(d)


@router.get("/snapshots")
def snapshots(start_date: str | None = None, end_date: str | None = None, page: int = 1, page_size: int = 50):
    _dates(start_date, end_date)
    d = _page([], page, page_size); d.update(gap_flags=["balance_snapshot_not_wired"], note="余额快照未接入（stub）"); return ok(d)
