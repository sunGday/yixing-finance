from __future__ import annotations
import csv, datetime as dt, io, json, os, re, uuid
from collections import defaultdict
from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse
from adapters import CredentialMissingError
from adapters.base import normalize_network, SETTLEMENT_STATUS
from reconcile import RECON_TABS, agency_daily, revenue_dedup, gross_profit_draft, daily_fund_equation
import store as st

VERSION = "0.6.0"
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
    from sources.refresh import read_meta
    return ok({"ok": True, "version": VERSION, "recharge_source": s.source, "recharge_rows": len(s.rows),
               "recharge_files": getattr(s, "files", []), "cost_days": len(req.app.state.costs.days),
               "snapshot_days": len(req.app.state.snapshots.days), "last_refresh": read_meta(),
               "auth_mode": "token" if os.environ.get("FIN_API_TOKEN") else "open-dev",
               "credentials": req.app.state.credentials.statuses()})


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
    items, gaps, notes = st.load_revenues(nets, allow_mock=allow_mock, start=s, end=e)
    # 503 仅当所请求的每一个网络都缺凭证。穿山甲有数、优量汇缺失 → 200 + gap，不整页失败。
    if not allow_mock:
        missing = {g.split(":", 1)[1] for g in gaps if g.startswith("credential_missing:")}
        if missing and set(nets) <= missing:
            raise ApiError(50301, 503, "CredentialMissingError", {"gap_flags": gaps, "auth_note": notes})
    items = [i for i in items if (not s or i["stat_date"] >= s) and (not e or i["stat_date"] <= e)
             and (not settlement_status or i["settlement_status"] == settlement_status)]
    return items, gaps, notes


def _revenue_source(items):
    kinds = {i.get("source") for i in items}
    if not items:
        return "empty"
    if "live" in kinds and "mock" in kinds:
        return "mixed"
    if "live" in kinds:
        return "live"
    return "mock"


@router.get("/revenues")
def revenues(start_date: str | None = None, end_date: str | None = None, date: str | None = None,
             ad_network: str | None = None, settlement_status: str | None = None, strict: bool = False,
             page: int = 1, page_size: int = 50):
    if date:
        date = _date(date, "date")
        if start_date is None and end_date is None:
            start_date = end_date = date
        elif (start_date and start_date != date) or (end_date and end_date != date):
            raise ApiError(40001, 400, "date conflicts with start_date/end_date")
        else:
            start_date = start_date or date
            end_date = end_date or date
    s, e = _dates(start_date, end_date)
    items, gaps, notes = _revenues(ad_network, settlement_status, s, e, strict)
    bad = ("credential_missing:", "live_fetch_unverified:", "live_fetch_error:")
    verified = bool(items) and all(i.get("verified") for i in items) and not any(g.startswith(bad) for g in gaps)
    d = _page(items, page, page_size)
    d.update(source=_revenue_source(items), verified=verified, gap_flags=gaps, auth_note=notes)
    return ok(d)


def _today(req: Request) -> dt.date:
    today = getattr(req.app.state, "overview_today", None)
    if callable(today):
        today = today()
    if isinstance(today, str):
        today = dt.date.fromisoformat(today)
    return today or st.sh_today()


def _gromore(req: Request):
    client = getattr(req.app.state, "gromore_client", None)
    if client is not None:
        return client
    from adapters.gromore import GroMoreClient
    client = GroMoreClient()
    req.app.state.gromore_client = client
    return client


def _invalidate_gromore(req: Request) -> None:
    client = getattr(req.app.state, "gromore_client", None)
    clear = getattr(client, "clear_cache", None)
    if callable(clear):
        clear()


def _settle_items(req: Request):
    try:
        return req.app.state.settlements.load()
    except st.SettlementError as e:
        raise ApiError(e.code, e.http, e.msg)


def _basis(basis: str) -> str:
    _enum(basis, ("auto", "estimate", "settlement"), "basis")
    return basis


@router.get("/revenues/overview")
def revenues_overview(req: Request, date_from: str | None = Query(None, alias="from"),
                      date_to: str | None = Query(None, alias="to"), basis: str = "auto"):
    """总览：分广告网络汇总。默认不是 /revenues 的产品/代码位日明细。"""
    _basis(basis)
    if not date_from or not date_to:
        raise ApiError(40001, 400, "from and to are required (YYYY-MM-DD)")
    s, e = _dates(date_from, date_to)
    if (dt.date.fromisoformat(e) - dt.date.fromisoformat(s)).days > 399:
        raise ApiError(40001, 400, "range must be <= 400 days")
    from overview import load_overview
    return ok(load_overview(s, e, basis, today=_today(req), settlement_items=_settle_items(req),
                            gromore=_gromore(req), live_items=getattr(req.app.state, "pangle_live_items", None)))


@router.get("/revenues/overview/cards")
def revenues_cards(req: Request, basis: str = "auto"):
    """昨日 / 近7日 / 本月 / 上月（上海日历，预估不含今天）。"""
    _basis(basis)
    from overview import load_cards
    return ok(load_cards(_today(req), basis, settlement_items=_settle_items(req), gromore=_gromore(req),
                         live_items=getattr(req.app.state, "pangle_live_items", None)))


@router.get("/reconcile/summaries")
def reconcile(req: Request, start_date: str | None = None, end_date: str | None = None, status: str | None = None,
              tab: str | None = None, to_owner_id: str | None = None, granularity: str = "day",
              page: int = 1, page_size: int = 50):
    s, e = _dates(start_date, end_date)
    _enum(tab, RECON_TABS, "tab"); _enum(status, ("matched", "partial", "unmatched"), "status")
    _enum(granularity, ("day",), "granularity", 40001)
    recs = rstore(req).query(s, e); cs, ss = req.app.state.costs, req.app.state.snapshots
    dates = sorted({r["biz_date"] for r in recs} | {d for d in list(cs.days) + list(ss.days)
                   if (not s or d >= s) and (not e or d <= e)}, reverse=True)
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
        cost_fen = cs.cost_fen(d); plat = [r for r in day if r["side"] == "platform_direct"]
        out_fen, rin_fen = sum(r["amount_fen"] for r in out), sum(r["amount_fen"] for r in rin)
        cost_c = {"label": "Omni 消耗(子户 queryAdData)", "ref": "cost", "amount_fen": -cost_fen if cost_fen is not None else None}
        # (1) 代理商树口径：Δ(代理商+子户余额) = 一代入账 - 消耗。代理商自身余额无读接口 → close/open 缺口
        fe = daily_fund_equation(d, st.AGENCY_OWNER_ID, None, None, pin_fen, cost_fen, components=comps[:1] + [cost_c])
        fe["gap_flags"] += ["agency_balance_unavailable"]; fe["note"] = "代理商自身余额无 Omni 读接口；见子户口径行"
        rows.append(fe)
        # (2) 子户口径：Δ子户余额合计 = 划拨入 - 划回 - 消耗 (+平台直充旁报作调整)
        close_s, open_s = ss.sub_sum(d), ss.prior(d)
        adj = sum(r["amount_fen"] for r in plat)
        fs = daily_fund_equation(d, "subs-of-" + st.AGENCY_OWNER_ID, open_s, close_s, (out_fen - rin_fen) if day else None,
                                 cost_fen, adjust_fen=adj,
                                 components=[{"label": "二代→子户划拨-划回", "ref": f"transfer_out:{len(out)}/reclaim_in:{len(rin)}", "amount_fen": out_fen - rin_fen},
                                             cost_c, {"label": "平台直充(旁报,调整项)", "ref": f"platform_direct:{len(plat)}", "amount_fen": adj},
                                             {"label": "子户余额期初(前日快照)", "ref": "snapshot", "amount_fen": open_s},
                                             {"label": "子户余额期末(当日快照)", "ref": "snapshot", "amount_fen": close_s}])
        fs["scope"] = f"subs:{st.AGENCY_OWNER_ID}"; fs["recon_id"] = fs["recon_id"].replace("FE-subs-of-", "FE-SUBS-")
        fs["note"] = "快照为取数时刻非日终；首个快照前无历史余额" if (close_s is None or open_s is None) else "快照为取数时刻，非日终"
        rows.append(fs)
        ag = agency_daily(d, st.AGENCY_OWNER_ID, None, out_fen or None, components=comps[1:2])
        ag["gap_flags"] += ["sub_inflow_ledger_unavailable"]; ag["note"] = "子户侧入账流水无读接口（仅余额快照）"; rows.append(ag)
        for n in ("pangle", "ylh"):
            nr = [i for i in live_rev if i["ad_network"] == n and i["stat_date"] == d]
            est = sum(i["amount_fen"] for i in nr if i["settlement_status"] == "estimated") if nr else None
            stl = sum(i["amount_fen"] for i in nr if i["settlement_status"] != "estimated") or None if nr else None
            rd = revenue_dedup(d, n, est, stl); rd["gap_flags"] += [g for g in rev_gaps if g.endswith(":" + n)]; rows.append(rd)
        rev_by = {n: (sum(i["amount_fen"] for i in live_rev if i["ad_network"] == n and i["stat_date"] == d) or None) for n in ("pangle", "ylh")}
        x = gross_profit_draft(d, rev_by, cost_fen, components=[{"label": "Omni 消耗", "ref": "cost", "amount_fen": cost_fen}])
        rows.append(x)
    rows = [r for r in rows if (not tab or r["tab"] == tab) and (not status or r["status"] == status)]
    data = _page(rows, page, page_size); data.update(gap_flags=sorted(set(rev_gaps)), revenue_mock_excluded=True)
    return ok(data)


@router.get("/costs")
def costs(req: Request, start_date: str | None = None, end_date: str | None = None, page: int = 1, page_size: int = 50):
    s, e = _dates(start_date, end_date); items = req.app.state.costs.items(s, e)
    gaps = ["cost_source_empty"] if not items else []
    gaps += [f"cost_missing:{i['biz_date']}" for i in items if not i.get("complete")]
    gaps += [f"cost_intraday:{i['biz_date']}" for i in items if i.get("intraday")]
    d = _page(items, page, page_size); d.update(source="omni_queryAdData_owner", unit="fen", gap_flags=gaps); return ok(d)


@router.get("/snapshots")
def snapshots(req: Request, start_date: str | None = None, end_date: str | None = None, page: int = 1, page_size: int = 50):
    s, e = _dates(start_date, end_date); items = req.app.state.snapshots.items(s, e)
    gaps = (["balance_snapshot_empty"] if not items else []) + ["agency_balance_unavailable", "historical_balance_before_first_snapshot"]
    d = _page(items, page, page_size); d.update(source="omni_customer_list", unit="fen", gap_flags=gaps,
                                               note="子户 totalBalance 取数时刻快照；代理商自身余额无读接口"); return ok(d)


def reload_state(app):
    app.state.recharges = st.RechargeStore.from_cache(); app.state.costs = st.CostStore.from_disk()
    app.state.snapshots = st.SnapshotStore.from_disk()


@router.post("/admin/reload")
def admin_reload(req: Request):
    reload_state(req.app); return health(req)


@router.post("/admin/refresh/{kind}")
def admin_refresh(req: Request, kind: str, start_date: str | None = None, end_date: str | None = None):
    """Live READ-ONLY Omni pull. kind=recharges|snapshot|costs. Auth: Bearer FIN_API_TOKEN (open-dev if unset)."""
    from sources import refresh as R
    _enum(kind, ("recharges", "snapshot", "costs"), "kind", 40001)
    s, e = _dates(start_date, end_date); e = e or R.today(); s = s or e
    if kind == "costs" and (__import__("datetime").date.fromisoformat(e) - __import__("datetime").date.fromisoformat(s)).days > 6:
        raise ApiError(40001, 400, "costs refresh max 7 days per call (rate limit); use CLI for backfill")
    try:
        r = R.refresh_recharges(s, e) if kind == "recharges" else R.refresh_snapshot() if kind == "snapshot" else R.refresh_costs(s, e)
    except RuntimeError as x:
        raise ApiError(50301, 503, f"omni credentials unavailable: {str(x)[:120]}")
    reload_state(req.app); return ok({"kind": kind, "result": r})


# ---- 收入渠道凭证（t294u）：脱敏读、写入 FIN_SECRETS_DIR、热加载进 os.environ ----
from credentials_store import CredentialInputError, schema as cred_schema  # noqa: E402


def _cred(fn, *a):
    try: return fn(*a)
    except CredentialInputError as e: raise ApiError(e.code, 400, str(e))


async def _cred_body(req: Request):
    try: b = await req.json()
    except Exception: raise ApiError(40001, 400, "body must be JSON {\"fields\": {...}}")
    if not isinstance(b, dict) or "fields" not in b: raise ApiError(40001, 400, "body must be {\"fields\": {KEY: value}}")
    return b["fields"]


@router.get("/credentials/schema")
def credentials_schema():
    return ok({"channels": cred_schema()})


@router.get("/credentials")
def credentials_list(req: Request):
    return ok(req.app.state.credentials.list())


@router.get("/credentials/{channel}")
def credentials_get(req: Request, channel: str):
    return ok(_cred(req.app.state.credentials.describe, channel))


@router.put("/credentials/{channel}")
async def credentials_put(req: Request, channel: str):
    """整渠道替换：body 中的键即该渠道全部文件凭证（未给的键从文件移除）。"""
    fields = await _cred_body(req)
    data = _cred(req.app.state.credentials.upsert, channel, fields, True)
    _invalidate_gromore(req)
    return ok(data)


@router.patch("/credentials/{channel}")
async def credentials_patch(req: Request, channel: str):
    """部分更新：未出现的键保留，空串清除该键。"""
    fields = await _cred_body(req)
    data = _cred(req.app.state.credentials.upsert, channel, fields, False)
    _invalidate_gromore(req)
    return ok(data)


@router.delete("/credentials/{channel}")
def credentials_delete(req: Request, channel: str):
    data = _cred(req.app.state.credentials.delete, channel)
    _invalidate_gromore(req)
    return ok(data)


# ---- 结算单（v0.6 · 手工，DATA_DIR/settlements.json，鉴权与其它写接口相同）----
def _settle_call(fn, *a):
    try:
        return fn(*a)
    except st.SettlementError as e:
        raise ApiError(e.code, e.http, e.msg)


def _settle_view(items, period, status, ad_network, postable):
    if period is not None and not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", period):
        raise ApiError(40001, 400, "period must be YYYY-MM")
    _enum(status, ("settled", "paid"), "settlement_status")
    net = st._network_field(ad_network) if ad_network else None
    out = []
    for i in items:
        if period and i.get("period") != period:
            continue
        if status and i.get("settlement_status") != status:
            continue
        if ad_network and i.get("ad_network") != net:
            continue
        if postable and (i.get("settlement_status") not in ("settled", "paid") or not i.get("evidence_ref")
                         or not isinstance(i.get("amount_fen"), int) or isinstance(i.get("amount_fen"), bool)):
            continue
        out.append(st.public_settlement(i))
    return out


@router.get("/settlements")
def settlements_list(req: Request, period: str | None = None, settlement_status: str | None = None,
                     ad_network: str | None = None, postable: bool = False, page: int = 1, page_size: int = 50):
    """postable=true：已签订/已支付且有证据，供 holiday 入账拉取。estimated 不会出现。"""
    try:
        items = _settle_view(_settle_items(req), period, settlement_status, ad_network, postable)
    except st.SettlementError as e:
        raise ApiError(e.code, e.http, e.msg)
    return ok(_page(items, page, page_size))


@router.post("/settlements")
async def settlements_create(req: Request):
    try:
        body = await req.json()
    except Exception:
        raise ApiError(40001, 400, "body must be JSON")
    return ok(_settle_call(req.app.state.settlements.create, body))


def _csv_items(text: str) -> list[dict]:
    rows = []
    for row in csv.DictReader(io.StringIO(text)):
        item = {}
        for k, v in row.items():
            if not k:
                continue
            key = k.strip().lower()
            val = (v or "").strip()
            if key == "amount_fen":
                if not re.fullmatch(r"\d+", val or ""):
                    raise ApiError(40001, 400, "amount_fen must be int fen")
                item[key] = int(val)
            elif key in ("paid_date", "settlement_id", "ad_network") and val == "":
                item[key] = None
            elif val != "":
                item[key] = val
        if item:
            rows.append(item)
    return rows


@router.post("/settlements/import")
async def settlements_import(req: Request):
    raw = await req.body()
    if len(raw) > 1_000_000:
        raise ApiError(40001, 400, "body too large")
    ctype = req.headers.get("content-type", "")
    if "json" in ctype or (raw[:1] in (b"{", b"[")):
        try:
            obj = json.loads(raw.decode("utf-8"))
        except Exception:
            raise ApiError(40001, 400, "body must be JSON or CSV")
        rows = obj.get("items") if isinstance(obj, dict) else obj
        if not isinstance(rows, list):
            raise ApiError(40001, 400, "body must be {\"items\":[]} or a CSV")
    else:
        try:
            rows = _csv_items(raw.decode("utf-8-sig"))
        except UnicodeDecodeError:
            raise ApiError(40001, 400, "CSV must be utf-8")
    return ok(_settle_call(req.app.state.settlements.import_rows, rows))


@router.patch("/settlements/{settlement_id}")
async def settlements_patch(req: Request, settlement_id: str):
    """settled → paid（收款核销）。不能从 paid 退回 settled，也不能写成 estimated。"""
    try:
        body = await req.json()
    except Exception:
        raise ApiError(40001, 400, "body must be JSON")
    return ok(_settle_call(req.app.state.settlements.patch, settlement_id, body))
