"""穿山甲 Pangle 收入适配器骨架。⚠ endpoint / 参数名 / 签名算法 均「待复核」（未经官方文档核实），
仅为结构占位。不发真实 HTTP。凭证 env：PANGLE_USER_ID, PANGLE_ROLE_ID, PANGLE_SECURE_KEY。"""
from __future__ import annotations
import hashlib
from .base import RevenueAdapter, RevenueRow, register, yuan_to_fen

ENDPOINT = "待复核:https://www.csjplatform.com/union_media/open/api/report/..."  # 待复核


@register("pangle", "csj")
class PangleAdapter(RevenueAdapter):
    ad_network = "pangle"
    env_keys = ("PANGLE_USER_ID", "PANGLE_ROLE_ID", "PANGLE_SECURE_KEY")

    @staticmethod
    def sign(params: dict, secure_key: str) -> str:
        """待复核：假设 md5(按 key 排序 k=v& 拼接 + secure_key)。"""
        s = "&".join(f"{k}={params[k]}" for k in sorted(params) if k != "sign")
        return hashlib.md5((s + secure_key).encode()).hexdigest()

    def build_request(self, stat_date: str) -> dict:
        c = self.credentials()
        params = {"user_id": c["PANGLE_USER_ID"], "role_id": c["PANGLE_ROLE_ID"], "date": stat_date,
                  "currency": "cny", "time_zone": 8, "version": "2.0", "sign_type": "MD5"}  # 参数名待复核
        params["sign"] = self.sign(params, c["PANGLE_SECURE_KEY"])
        return {"method": "GET", "url": ENDPOINT, "params": params, "dry_run": True, "verified": False}

    def map_row(self, raw: dict, stat_date: str, evidence_ref=None) -> RevenueRow:
        """字段映射（上游名待复核）：revenue(元,净)→amount_fen；show→impressions；click→clicks；
        ecpm(元)→ecpm_fen；app_id/ad_slot_id→app_id/placement_id；region→country。"""
        return RevenueRow(
            ad_network="pangle", stat_date=raw.get("date") or stat_date,
            amount_fen=yuan_to_fen(raw.get("revenue")),
            gross_amount_fen=yuan_to_fen(raw["gross_revenue"]) if raw.get("gross_revenue") not in (None, "") else None,
            app_id=str(raw.get("app_id") or "") or None, placement_id=str(raw.get("ad_slot_id") or "") or None,
            country=raw.get("region") or "CN", impressions=int(raw.get("show") or 0), clicks=int(raw.get("click") or 0),
            ecpm_fen=yuan_to_fen(raw["ecpm"]) if raw.get("ecpm") not in (None, "") else None,
            settlement_status="estimated", evidence_ref=evidence_ref)
