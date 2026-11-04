"""§6 对账草稿（纯函数）。缺数→gap_flags，绝不静默填 0。毛利为「非关账」口径。
行契约对齐 jack ReconRow：tab + components[]。
"""
from __future__ import annotations

RECON_TABS = ("fund_equation", "agency_daily", "revenue_dedup", "cross_source")


def daily_fund_equation(biz_date, owner_id, open_fen, close_fen, recharge_fen, cost_fen, adjust_fen=0,
                         components=None):
    gaps = [n for n, v in (("open_balance_missing", open_fen), ("close_balance_missing", close_fen),
                           ("recharge_missing", recharge_fen), ("cost_missing", cost_fen)) if v is None]
    row = {
        "recon_id": f"RC-{biz_date.replace('-', '')}-FE-{owner_id}",
        "biz_date": biz_date,
        "scope": f"owner:{owner_id}",
        "tab": "fund_equation",
        "left_fen": None,
        "right_fen": None,
        "delta_fen": None,
        "gap_flags": gaps,
        "note": "",
        "evidence_paths": [],
        "components": list(components or []),
        "status": "matched",
    }
    if gaps:
        row["status"] = "partial" if len(gaps) < 4 else "unmatched"
        return row
    row["left_fen"] = close_fen - open_fen
    row["right_fen"] = recharge_fen - cost_fen + (adjust_fen or 0)
    row["delta_fen"] = row["left_fen"] - row["right_fen"]
    row["status"] = "matched" if row["delta_fen"] == 0 else "unmatched"
    return row


def agency_daily(biz_date, agency_owner_id, left_fen, right_fen, components=None):
    """子户加总 vs 代理商层。"""
    gaps = []
    if left_fen is None:
        gaps.append("sub_sum_missing")
    if right_fen is None:
        gaps.append("agency_sum_missing")
    delta = None if (left_fen is None or right_fen is None) else left_fen - right_fen
    if gaps:
        status = "partial" if len(gaps) < 2 else "unmatched"
    else:
        status = "matched" if delta == 0 else "unmatched"
    return {
        "recon_id": f"RC-{biz_date.replace('-', '')}-AG",
        "biz_date": biz_date,
        "scope": f"agency:{agency_owner_id}",
        "tab": "agency_daily",
        "left_fen": left_fen,
        "right_fen": right_fen,
        "delta_fen": delta,
        "status": status,
        "note": "子户加总 = 代理商层" if status == "matched" else "",
        "evidence_paths": [],
        "gap_flags": gaps,
        "components": list(components or []),
    }


def revenue_dedup(biz_date, ad_network, estimated_fen, settled_fen, components=None):
    gaps = []
    if estimated_fen is None:
        gaps.append("estimated_missing")
    if settled_fen is None:
        gaps.append("settled_missing")
    delta = None if (estimated_fen is None or settled_fen is None) else estimated_fen - settled_fen
    if gaps:
        status = "partial"
        note = "仅预估，结算未出" if settled_fen is None and estimated_fen is not None else ""
    else:
        status = "matched" if delta == 0 else "unmatched"
        note = ""
    return {
        "recon_id": f"RC-{biz_date.replace('-', '')}-RV-{ad_network}",
        "biz_date": biz_date,
        "scope": f"network:{ad_network}",
        "tab": "revenue_dedup",
        "left_fen": estimated_fen,
        "right_fen": settled_fen,
        "delta_fen": delta,
        "status": status,
        "note": note,
        "evidence_paths": [],
        "gap_flags": gaps,
        "components": list(components or []),
    }


def gross_profit_draft(biz_date, revenue_by_network: dict, cost_fen, expected=("pangle", "ylh"),
                       agency_owner_id="1001108443", components=None):
    gaps = [f"revenue_missing:{n}" for n in expected if revenue_by_network.get(n) is None]
    if cost_fen is None:
        gaps.append("cost_missing")
    rev = None if any(g.startswith("revenue_missing") for g in gaps) else sum(revenue_by_network[n] for n in expected)
    gp = None if (rev is None or cost_fen is None) else rev - cost_fen
    return {
        "recon_id": f"RC-{biz_date.replace('-', '')}-X",
        "biz_date": biz_date,
        "scope": f"agency:{agency_owner_id}",
        "tab": "cross_source",
        "left_fen": rev,  # 净收入
        "right_fen": cost_fen,  # Omni 消耗
        "delta_fen": gp,  # 毛利草稿
        "status": "partial" if gaps else ("matched" if gp is not None else "unmatched"),
        "note": "毛利草稿（非关账）",
        "label": "非关账",
        "revenue_net_fen": rev,
        "cost_fen": cost_fen,
        "gross_profit_draft_fen": gp,
        "evidence_paths": [],
        "gap_flags": gaps,
        "components": list(components or []),
    }
