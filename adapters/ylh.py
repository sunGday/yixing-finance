"""优量汇 YLH（腾讯广告联盟，v0.1 称 gdt）收入适配器骨架。⚠ endpoint/鉴权「待复核」，不发真实 HTTP。
凭证 env：YLH_MEMBER_ID, YLH_SECRET（兼容别名 GDT_MEMBER_ID, GDT_SECRET）。注册名 ylh，别名 gdt。"""
from __future__ import annotations
import hashlib, time
from .base import RevenueAdapter, RevenueRow, register, yuan_to_fen

ENDPOINT = "待复核:https://api.adnet.qq.com/open/v1.1/report/get"  # 待复核


@register("ylh", "gdt")
class YlhAdapter(RevenueAdapter):
    ad_network = "ylh"
    env_keys = ("YLH_MEMBER_ID", "YLH_SECRET")
    env_alias_prefixes = ("GDT_",)

    @staticmethod
    def token(member_id: str, secret: str, ts: int) -> str:
        """待复核：假设 sha1(member_id + secret + ts)。"""
        return hashlib.sha1(f"{member_id}{secret}{ts}".encode()).hexdigest()

    def build_request(self, stat_date: str, ts: int | None = None) -> dict:
        c = self.credentials(); ts = ts or int(time.time())
        return {"method": "POST", "url": ENDPOINT, "dry_run": True, "verified": False,
                "headers": {"token": self.token(c["YLH_MEMBER_ID"], c["YLH_SECRET"], ts)},
                "json": {"member_id": c["YLH_MEMBER_ID"], "start_date": stat_date, "end_date": stat_date,
                         "group_by": ["date", "app_id", "placement_id"]}}  # 参数名待复核

    def map_row(self, raw: dict, stat_date: str, evidence_ref=None) -> RevenueRow:
        """映射（上游名待复核）：revenue(元)→amount_fen；pv→impressions；click→clicks；ecpm→ecpm_fen。"""
        return RevenueRow(
            ad_network="ylh", stat_date=raw.get("date") or stat_date, amount_fen=yuan_to_fen(raw.get("revenue")),
            app_id=str(raw.get("app_id") or "") or None, placement_id=str(raw.get("placement_id") or "") or None,
            impressions=int(raw.get("pv") or 0), clicks=int(raw.get("click") or 0),
            ecpm_fen=yuan_to_fen(raw["ecpm"]) if raw.get("ecpm") not in (None, "") else None,
            settlement_status="estimated", evidence_ref=evidence_ref)
