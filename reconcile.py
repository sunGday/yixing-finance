"""§6 对账草稿（纯函数）。缺数→gap_flags，绝不静默填 0。毛利为「非关账」口径。"""
from __future__ import annotations


def daily_fund_equation(biz_date, owner_id, open_fen, close_fen, recharge_fen, cost_fen, adjust_fen=0):
    gaps = [n for n, v in (("open_balance_missing", open_fen), ("close_balance_missing", close_fen),
                           ("recharge_missing", recharge_fen), ("cost_missing", cost_fen)) if v is None]
    row = {"recon_id": f"fund-{biz_date}-{owner_id}", "biz_date": biz_date, "scope": f"owner:{owner_id}",
           "left_fen": None, "right_fen": None, "delta_fen": None, "gap_flags": gaps, "note": "", "evidence_paths": []}
    if gaps:
        row["status"] = "partial" if len(gaps) < 4 else "unmatched"
        return row
    row["left_fen"] = close_fen - open_fen
    row["right_fen"] = recharge_fen - cost_fen + (adjust_fen or 0)
    row["delta_fen"] = row["left_fen"] - row["right_fen"]
    row["status"] = "matched" if row["delta_fen"] == 0 else "unmatched"
    return row


def gross_profit_draft(biz_date, revenue_by_network: dict, cost_fen, expected=("pangle", "ylh")):
    gaps = [f"revenue_missing:{n}" for n in expected if revenue_by_network.get(n) is None]
    if cost_fen is None:
        gaps.append("cost_missing")
    rev = None if any(g.startswith("revenue_missing") for g in gaps) else sum(revenue_by_network[n] for n in expected)
    gp = None if (rev is None or cost_fen is None) else rev - cost_fen
    return {"biz_date": biz_date, "revenue_net_fen": rev, "cost_fen": cost_fen, "gross_profit_draft_fen": gp,
            "label": "非关账", "gap_flags": gaps}
