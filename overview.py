"""收入总览：GroMore 分网络预估，有结算单的完整月份升级为结算额。

holiday 锁定：settlement_status = estimated | settled | paid。
- estimated 只展示，不入账（结算单里不存这个态）。
- 完成签订 → settled，金额=结算单总额；待收票仍是 settled。
- 已支付 → paid，只是收款，不再记一笔收入。

basis=auto：查询区间盖住整个自然月且该月有结算单 → 用结算额；否则用预估。
basis=estimate / settlement 强制切换。settlement 缺单打 settlement_missing:YYYY-MM，金额 null，不填 0。
今天（上海）不进预估。
"""
from __future__ import annotations
import datetime as dt
import inspect
from decimal import Decimal, ROUND_HALF_UP

from adapters.base import CredentialMissingError
from adapters.gromore import DEFAULT_MAX_WAIT, GroMoreFetchError, GroMoreTimeout, OVERVIEW_NETWORKS

# 本年大约 11 个 30 日分片。limit=500 后冷启动大约 5 秒，落在这个等待里。
# 到点或分片失败时，若已有日缓存，总览用已缓存日合计，并打 gromore_partial，不把全年打成 null。
OVERVIEW_FETCH_WAIT = DEFAULT_MAX_WAIT
# 卡片只盖昨日到上月，不能被未缓存的本年请求拖住。有日缓存（含过期）则马上返回。
CARDS_FETCH_WAIT = 8.0

ORDER = {n: i for i, n in enumerate(OVERVIEW_NETWORKS)}
_HARD = ("credential_missing", "gromore_fetch_failed", "gromore_partial", "network_unmapped", "settlement_missing",
         "fallback_rt_income", "today_excluded")


def card_ranges(today: dt.date) -> list[dict]:
    """昨日 / 近7日 / 本月 / 上月。近7日与本月都截止到昨天（不含今天）。"""
    yest = today - dt.timedelta(days=1)
    month_start = today.replace(day=1)
    prev_end = month_start - dt.timedelta(days=1)
    prev_start = prev_end.replace(day=1)
    this = (month_start, yest) if yest >= month_start else None
    return [
        {"key": "yesterday", "label": "昨日", "from": yest, "to": yest},
        {"key": "last7", "label": "近7日", "from": today - dt.timedelta(days=7), "to": yest},
        {"key": "this_month", "label": "本月", "from": this[0] if this else None, "to": this[1] if this else None},
        {"key": "last_month", "label": "上月", "from": prev_start, "to": prev_end},
    ]


def months_between(start: str, end: str) -> list[str]:
    d = dt.date.fromisoformat(start).replace(day=1)
    last = dt.date.fromisoformat(end).replace(day=1)
    out = []
    while d <= last:
        out.append(f"{d.year:04d}-{d.month:02d}")
        if d.month == 12:
            d = dt.date(d.year + 1, 1, 1)
        else:
            d = dt.date(d.year, d.month + 1, 1)
    return out


def month_bounds(period: str) -> tuple[str, str]:
    y, m = (int(x) for x in period.split("-"))
    start = dt.date(y, m, 1)
    nxt = dt.date(y + 1, 1, 1) if m == 12 else dt.date(y, m + 1, 1)
    return start.isoformat(), (nxt - dt.timedelta(days=1)).isoformat()


def _material(diff: int, base: int) -> bool:
    ratio = int((Decimal(abs(base)) * Decimal("0.01")).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return abs(diff) > max(100, ratio)


def _net(ad_network, amount, api, basis, status) -> dict:
    return {"ad_network": ad_network, "amount_fen": amount, "api_amount_fen": api,
            "basis": basis, "settlement_status": status}


def _rollup_bills(bills: list[dict]) -> dict | None:
    """空 ad_network = 该月总额，优先于按网络拆分，避免加两次。"""
    if not bills:
        return None
    totals = [b for b in bills if not b.get("ad_network")]
    chosen = totals if totals else list(bills)
    amount = sum(int(b["amount_fen"]) for b in chosen)
    statuses = {b.get("settlement_status") for b in chosen}
    status = "paid" if statuses == {"paid"} else "settled"
    if totals:
        parts = [_net(None, amount, None, "settlement", status)]
    else:
        bucket: dict[str, dict] = {}
        for b in chosen:
            slot = bucket.setdefault(b["ad_network"], {"amount": 0, "st": set(), "api": None})
            slot["amount"] += int(b["amount_fen"])
            slot["st"].add(b.get("settlement_status"))
        parts = []
        for net, info in bucket.items():
            st = "paid" if info["st"] == {"paid"} else "settled"
            parts.append(_net(net, info["amount"], None, "settlement", st))
    return {"amount_fen": amount, "settlement_status": status, "parts": parts}


def _fallback_rows(live_items, start: str, end: str) -> tuple[list[dict], list[str]]:
    gaps: list[str] = []
    if live_items is None:
        import store as st
        items, lgaps, _notes = st.load_revenues(("pangle",), allow_mock=False, start=start, end=end)
        gaps.extend(g for g in lgaps if g.startswith(("credential_missing:", "live_fetch_unverified:", "live_fetch_error:")))
    else:
        items = live_items
    rows = []
    for i in items:
        if i.get("source") != "live" or i.get("ad_network") != "pangle":
            continue
        sd = i.get("stat_date") or ""
        if not (start <= sd <= end):
            continue
        rows.append({"stat_date": sd, "ad_network": "pangle", "code": "1",
                     "amount_fen": int(i["amount_fen"]), "api_amount_fen": None, "gap": None})
    return rows, gaps


def _span_days(start: str, end: str) -> int:
    return (dt.date.fromisoformat(end) - dt.date.fromisoformat(start)).days


def _fetch_gromore(gromore, start: str, end: str, *, max_wait: float | None, stale_ok: bool):
    kwargs = {}
    try:
        params = inspect.signature(gromore.fetch).parameters
    except (TypeError, ValueError):
        params = None
    if params is None or "max_wait" in params:
        if max_wait is not None:
            kwargs["max_wait"] = max_wait
    if (params is None or "stale_ok" in params) and stale_ok:
        kwargs["stale_ok"] = True
    return gromore.fetch(start, end, **kwargs)


def fetch_estimate(gromore, start: str, end: str, live_items, *, max_wait: float | None = None,
                   stale_ok: bool = False) -> tuple[list[dict], str | None, list[str]]:
    """拉预估。失败或无凭证时改加总已有 live rt/income 穿山甲行（不含 mock）。

    等待超时，或区间长于 70 天的上游失败，不再补拉穿山甲：那一次补拉本身就会把本年请求挂住。
    客户端若带回已缓存日（gromore_partial），用这些行做合计，不改成 null。
    """
    if start > end:
        return [], None, []
    try:
        rows, gaps = _fetch_gromore(gromore, start, end, max_wait=max_wait, stale_ok=stale_ok)
        kept = [g for g in gaps if g.startswith("gromore_")]
        if kept:
            return rows, "gromore_daily", sorted(set(kept))
        return rows, "gromore_daily", []
    except GroMoreTimeout:
        return [], None, ["gromore_fetch_failed"]
    except CredentialMissingError:
        rows, extra = _fallback_rows(live_items, start, end)
        return rows, "rt_income_fallback", ["credential_missing:gromore", "fallback_rt_income:pangle_only", *extra]
    except GroMoreFetchError:
        if _span_days(start, end) > 70:
            return [], None, ["gromore_fetch_failed"]
        rows, extra = _fallback_rows(live_items, start, end)
        return rows, "rt_income_fallback", ["gromore_fetch_failed", "fallback_rt_income:pangle_only", *extra]


def _accumulate(acc: dict, part: dict):
    key = (part["ad_network"], part["basis"], part["settlement_status"])
    slot = acc.get(key)
    if slot is None:
        acc[key] = dict(part)
        return
    slot["amount_fen"] += part["amount_fen"]
    if part["api_amount_fen"] is None:
        return
    if slot["api_amount_fen"] is None:
        slot["api_amount_fen"] = part["api_amount_fen"]
    else:
        slot["api_amount_fen"] += part["api_amount_fen"]


def _sort_nets(rows: list[dict]) -> list[dict]:
    def key(p):
        return (p["ad_network"] is None, ORDER.get(p["ad_network"], 9), p["ad_network"] or "",
                p["basis"], p["settlement_status"] or "")
    return sorted(rows, key=key)


def build_overview(date_from: str, date_to: str, basis: str, today: dt.date, settlement_items: list[dict],
                   estimate_rows: list[dict], estimate_source: str | None, fetch_gaps: list[str]) -> dict:
    yest = (today - dt.timedelta(days=1)).isoformat()
    gaps = list(fetch_gaps)
    if date_to >= today.isoformat():
        gaps.append(f"today_excluded:{today.isoformat()}")
    est_end = yest if date_to > yest else date_to
    window = [r for r in estimate_rows if date_from <= r["stat_date"] <= est_end] if date_from <= est_end else []
    apis = [r["api_amount_fen"] for r in window if r.get("api_amount_fen") is not None]
    api_total = sum(apis) if apis else None

    bills_by: dict[str, list] = {}
    for s in settlement_items:
        if s.get("settlement_status") in ("settled", "paid") and s.get("period"):
            bills_by.setdefault(s["period"], []).append(s)

    by_month = []
    acc: dict = {}
    used_estimate = False
    used_settlement = False
    used_rows: list[dict] = []

    for period in months_between(date_from, date_to):
        ms, me = month_bounds(period)
        full = date_from <= ms and date_to >= me
        month_closed = me <= yest
        rolled = _rollup_bills(bills_by.get(period, []))
        rows = [r for r in window if r["stat_date"][:7] == period]
        if estimate_source == "gromore_daily":
            estimate_fen = sum(r["amount_fen"] for r in rows)
        elif rows:
            estimate_fen = sum(r["amount_fen"] for r in rows)
        else:
            estimate_fen = None

        if basis == "settlement":
            mode = "settlement" if rolled else "missing"
        elif basis == "estimate":
            mode = "estimate"
        else:
            mode = "settlement" if (full and rolled) else "estimate"

        diff = None
        if rolled and full and month_closed and estimate_source == "gromore_daily" and estimate_fen is not None:
            diff = rolled["amount_fen"] - estimate_fen
            if _material(diff, rolled["amount_fen"]):
                gaps.append(f"estimate_settlement_diff:{period}")

        if mode == "settlement":
            used_settlement = True
            amount, status = rolled["amount_fen"], rolled["settlement_status"]
            for part in rolled["parts"]:
                _accumulate(acc, part)
        elif mode == "missing":
            gaps.append(f"settlement_missing:{period}")
            amount, status = None, None
        else:
            if estimate_fen is None:
                amount, status = None, "estimated"
            else:
                used_estimate = True
                amount, status = estimate_fen, "estimated"
                used_rows.extend(rows)
                by_net: dict = {}
                for r in rows:
                    if not r.get("ad_network"):
                        continue
                    slot = by_net.setdefault(r["ad_network"], {"amount": 0, "api": None})
                    slot["amount"] += r["amount_fen"]
                    if r.get("api_amount_fen") is not None:
                        slot["api"] = (slot["api"] or 0) + r["api_amount_fen"]
                for net, info in by_net.items():
                    _accumulate(acc, _net(net, info["amount"], info["api"], "estimate", "estimated"))
        by_month.append({"period": period, "basis": "settlement" if mode in ("settlement", "missing") else "estimate",
                         "settlement_status": status, "amount_fen": amount, "estimate_fen": estimate_fen, "diff_fen": diff})

    for r in used_rows:
        if not r.get("ad_network"):
            gaps.append(f"network_unmapped:{r.get('code') or 'missing'}")

    amounts = [m["amount_fen"] for m in by_month if m["amount_fen"] is not None]
    total = sum(amounts) if amounts else None
    if used_settlement and used_estimate:
        source = "mixed"
    elif used_settlement:
        source = "settlement_manual"
    elif used_estimate or basis != "settlement":
        source = estimate_source
    else:
        source = None
    gap_flags = sorted(set(gaps))
    verified = source in ("gromore_daily", "settlement_manual", "mixed") and not any(
        g.startswith(_HARD) for g in gap_flags)
    return {
        "from": date_from, "to": date_to, "basis": basis, "source": source,
        "total_fen": total, "api_total_fen": api_total, "networks": _sort_nets(list(acc.values())),
        "by_month": by_month, "gap_flags": gap_flags, "verified": verified,
    }


def load_overview(date_from: str, date_to: str, basis: str, *, today: dt.date, settlement_items, gromore, live_items,
                  max_wait: float = OVERVIEW_FETCH_WAIT):
    yest = (today - dt.timedelta(days=1)).isoformat()
    fetch_to = min(date_to, yest)
    if date_from <= fetch_to:
        rows, source, gaps = fetch_estimate(gromore, date_from, fetch_to, live_items, max_wait=max_wait)
    else:
        rows, source, gaps = [], None, []
    return build_overview(date_from, date_to, basis, today, settlement_items, rows, source, gaps)


def _empty_card(spec, basis, today: dt.date) -> dict:
    return {"key": spec["key"], "label": spec["label"], "from": None, "to": None, "basis": basis, "source": None,
            "total_fen": None, "api_total_fen": None, "networks": [], "by_month": [],
            "gap_flags": [f"today_excluded:{today.isoformat()}"], "verified": False}


def load_cards(today: dt.date, basis: str, *, settlement_items, gromore, live_items,
               max_wait: float = CARDS_FETCH_WAIT) -> dict:
    specs = card_ranges(today)
    yest = (today - dt.timedelta(days=1)).isoformat()
    spans = [(s["from"].isoformat(), s["to"].isoformat()) for s in specs if s["from"] is not None]
    rows, source, gaps = [], None, []
    if spans:
        union_from = min(a for a, _ in spans)
        union_to = min(yest, max(b for _, b in spans))
        if union_from <= union_to:
            # stale_ok：已有日缓存就先返回，不等一次未命中的长拉取。缺日时最多等 max_wait。
            rows, source, gaps = fetch_estimate(
                gromore, union_from, union_to, live_items, max_wait=max_wait, stale_ok=True)
    cards = []
    for spec in specs:
        if spec["from"] is None:
            cards.append(_empty_card(spec, basis, today))
            continue
        body = build_overview(spec["from"].isoformat(), spec["to"].isoformat(), basis, today,
                              settlement_items, rows, source, gaps)
        cards.append({"key": spec["key"], "label": spec["label"], **body})
    return {"timezone": "Asia/Shanghai", "today": today.isoformat(), "basis": basis, "cards": cards}
