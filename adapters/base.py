"""Revenue adapter base (REQ-10C v0.2). Fields aligned to holiday §5. Amounts int fen; Asia/Shanghai.
Secrets from env only; never committed. No real HTTP in this skeleton."""
from __future__ import annotations
import hashlib, os
from dataclasses import dataclass, field, asdict
from decimal import Decimal, ROUND_HALF_UP

AD_NETWORKS = ("pangle", "ylh")
NETWORK_ALIASES = {"gdt": "ylh", "csj": "pangle"}  # v0.1 用过 gdt；真源优先 ylh
SETTLEMENT_STATUS = ("estimated", "settled", "paid")


class CredentialMissingError(RuntimeError):
    pass


class AdapterNotFoundError(KeyError):
    pass


def yuan_to_fen(v) -> int:
    """元(str/float/Decimal) → 分 int, 四舍五入 half-up；None 抛错（禁止静默 0）。"""
    if v is None or v == "":
        raise ValueError("amount missing (no silent 0)")
    return int((Decimal(str(v)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def normalize_network(n: str) -> str:
    n = (n or "").strip().lower()
    n = NETWORK_ALIASES.get(n, n)
    if n not in AD_NETWORKS:
        raise ValueError(f"ad_network must be one of {AD_NETWORKS} (alias gdt→ylh), got {n!r}")
    return n


def make_revenue_id(ad_network, stat_date, app_id=None, placement_id=None, country=None, stat_hour=None) -> str:
    raw = "|".join(str(x or "") for x in (ad_network, stat_date, stat_hour, app_id, placement_id, country))
    return f"{ad_network}-" + hashlib.sha1(raw.encode()).hexdigest()[:16]


@dataclass
class RevenueRow:
    """holiday §5. amount_fen = 净收入（主金额）。v0.1 `revenue_fen`→`amount_fen`, `biz_date`→`stat_date`,
    `status(estimated|final)`→`settlement_status(estimated|settled|paid)`。"""
    ad_network: str
    stat_date: str               # YYYY-MM-DD 上海
    amount_fen: int              # 必填，净收入
    revenue_id: str = ""         # 空则按键哈希生成
    stat_hour: int | None = None
    gross_amount_fen: int | None = None
    fee_fen: int | None = None
    app_id: str | None = None
    placement_id: str | None = None
    ad_unit_id: str | None = None
    site_id: str | None = None
    bundle_id: str | None = None
    country: str | None = "CN"
    settlement_status: str | None = "estimated"
    paid_date: str | None = None
    evidence_ref: str | None = None   # 平台批次号 / request_id
    # 报表附加（非 §5 必需）
    impressions: int | None = None
    clicks: int | None = None
    ecpm_fen: int | None = None
    currency: str = "CNY"
    extra: dict = field(default_factory=dict)

    def __post_init__(self):
        self.ad_network = normalize_network(self.ad_network)
        if not isinstance(self.amount_fen, int) or isinstance(self.amount_fen, bool):
            raise TypeError("amount_fen must be int fen")
        if self.settlement_status is not None and self.settlement_status not in SETTLEMENT_STATUS:
            raise ValueError(f"settlement_status must be {SETTLEMENT_STATUS}")
        if self.fee_fen is None and self.gross_amount_fen is not None:
            self.fee_fen = self.gross_amount_fen - self.amount_fen
        if not self.revenue_id:
            self.revenue_id = make_revenue_id(self.ad_network, self.stat_date, self.app_id,
                                              self.placement_id, self.country, self.stat_hour)

    def to_dict(self):
        return asdict(self)


class RevenueAdapter:
    ad_network = "base"
    env_keys: tuple[str, ...] = ()
    env_alias_prefixes: tuple[str, ...] = ()  # e.g. GDT_ for ylh

    def __init__(self, env: dict | None = None, dry_run: bool = True):
        self.env = dict(os.environ if env is None else env)
        self.dry_run = dry_run  # 骨架期强制 True：只拼请求不发 HTTP

    def _get(self, key: str):
        v = self.env.get(key)
        if not v:
            for pre in self.env_alias_prefixes:
                v = self.env.get(pre + key.split("_", 1)[1])
                if v:
                    break
        return v

    def credentials(self) -> dict:
        missing = [k for k in self.env_keys if not self._get(k)]
        if missing:
            raise CredentialMissingError(
                f"[{self.ad_network}] missing env: {', '.join(missing)} (set in env/.secrets, never commit)")
        return {k: self._get(k) for k in self.env_keys}

    def build_request(self, stat_date: str) -> dict:
        raise NotImplementedError(f"[{self.ad_network}] build_request not implemented")

    def map_row(self, raw: dict, stat_date: str, evidence_ref: str | None = None) -> RevenueRow:
        raise NotImplementedError(f"[{self.ad_network}] map_row not implemented")

    def fetch(self, start: str, end: str) -> list[RevenueRow]:
        raise NotImplementedError(
            f"[{self.ad_network}] live fetch disabled in v0.2 skeleton (endpoint/sign 待复核; no real HTTP)")


ADAPTERS: dict[str, type[RevenueAdapter]] = {}


def register(name: str, *aliases: str):
    def deco(cls):
        for n in (name, *aliases):
            ADAPTERS[n.lower()] = cls
        return cls
    return deco


def get_adapter(name: str, **kw) -> RevenueAdapter:
    cls = ADAPTERS.get((name or "").lower())
    if cls is None:
        raise AdapterNotFoundError(f"no adapter for ad_network={name!r}; registered={sorted(ADAPTERS)}")
    return cls(**kw)


def list_adapters() -> list[str]:
    return sorted(ADAPTERS)
