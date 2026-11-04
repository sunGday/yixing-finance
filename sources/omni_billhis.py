"""Omni billHis → §3 recharge DTO（只读）。复用 ../oppo-phase1/oppo_omni.finance（若可导入）；
不可导入或无凭证时，仍可用纯函数 to_recharge_dto 做映射测试。不写 Omni。"""
from __future__ import annotations
import hashlib, os, sys

_P = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "oppo-phase1"))
if _P not in sys.path:
    sys.path.append(_P)
try:
    from oppo_omni import finance as _omni_finance  # type: ignore
except Exception:  # pragma: no cover
    _omni_finance = None

AGENCY_OWNER_ID = "1001108443"
CHANNEL = {100: "omni_recharge", 300: "omni_transfer"}


def to_recharge_dto(item: dict, request_id: str | None = None) -> dict:
    """billHis item → §3。billType 0=credit。amount_fen 取 billMoney（上游已为分）。"""
    if _omni_finance is not None:
        t = _omni_finance.to_txn(item, request_id)
    else:
        bt = item.get("billTime") or ""
        seq = item.get("seqNo") or "OMNI-H-" + hashlib.sha1(
            f"{bt}|{item.get('billMoney')}|{item.get('relateAccId')}|{item.get('billSub')}|{item.get('billType')}".encode()).hexdigest()[:16]
        t = {"txn_id": str(seq), "txn_time": bt, "biz_date": bt[:10], "hour": bt[11:13],
             "amount_fen": int(item.get("billMoney") or 0),
             "direction": "credit" if item.get("billType") == 0 else "debit", "bill_sub": item.get("billSub"),
             "bill_desc": item.get("billDesc"), "to_owner_id": item.get("relateOwnerId"),
             "channel": CHANNEL.get(item.get("billSub"), "omni_other"), "request_id": request_id, "status": "raw"}
    if item.get("billMoney") in (None, ""):
        raise ValueError("billMoney missing (no silent 0)")
    return {"txn_id": t["txn_id"], "txn_time": t["txn_time"], "biz_date": t["biz_date"],
            "hour": int(t["hour"]) if str(t.get("hour") or "").isdigit() else None,
            "amount_fen": int(t["amount_fen"]), "direction": t["direction"], "from_party": None,
            "to_owner_id": str(t["to_owner_id"]) if t.get("to_owner_id") is not None else None,
            "agency_owner_id": AGENCY_OWNER_ID, "channel": t["channel"], "balance_after_fen": None,
            "request_id": t.get("request_id"), "evidence_path": None, "posted_ledger_id": None, "status": "raw",
            "bill_sub": t.get("bill_sub"), "bill_desc": t.get("bill_desc")}


def fetch_recharges(client, start_ts: int, end_ts: int):
    """只读拉取（需调用方提供已鉴权 client；本模块不读密钥）。"""
    if _omni_finance is None:
        raise RuntimeError("oppo_omni.finance not importable; use to_recharge_dto for pure mapping")
    for items, meta in _omni_finance.fetch_bill_his(client, start_ts, end_ts):
        for it in items:
            yield to_recharge_dto(it, meta.get("request_id"))
