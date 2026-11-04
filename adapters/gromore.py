"""GroMore 收益报表总体（t320u）。预估总览，不是产品/代码位明细。

Allen 2026-11-03 实测 `csj-cli report gromore-daily`
`dimensions=date,network` `metrics=revenue,api_revenue`：
当日 revenue 合计 13403.59 元（1340359 分），网络编码：

| code | ad_network |
| 1    | pangle     |
| 3    | ylh        |
| 7    | kuaishou   |
| 10   | gm_adx     |

未知编码不猜测，调用方打 `network_unmapped:<code>`。
签名复用穿山甲适配器（排序 k=v 后拼接 security key 再 MD5）。
凭证即 PANGLE_*，不单独注册渠道（避免 credentials schema 多出一个 channel）。
单次请求跨度 ≤30 天（含首尾），更长区间分片。不在 import 时发 HTTP。
"""
from __future__ import annotations
import datetime as dt
import os
import threading
import time

from adapters.base import CredentialMissingError, yuan_to_fen
from adapters.pangle import PangleAdapter

PATH = "/union_media/open/api/mediation/get_daily_income_report_data"
DEFAULT_BASE = "https://www.csjplatform.com"
MAX_SPAN_DAYS = 30
# Allen verified 2026-11-03. Do not extend from the upload-API ADN table (code 9 ≠ gm_adx).
NETWORK_CODES = {"1": "pangle", "3": "ylh", "7": "kuaishou", "10": "gm_adx"}
OVERVIEW_NETWORKS = ("pangle", "ylh", "kuaishou", "gm_adx")
_OK_CODES = {None, 0, "0", 100, "100", 200, "200"}
_LIST_KEYS = ("report_list", "reportlist", "reportList", "list", "rows", "data_list", "dataList")


class GroMoreFetchError(RuntimeError):
    """上游失败。message 不得含凭证或响应正文。"""


def iter_shards(start: str, end: str, span: int = MAX_SPAN_DAYS):
    d0, d1 = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    cur = d0
    while cur <= d1:
        stop = min(d1, cur + dt.timedelta(days=span - 1))
        yield cur.isoformat(), stop.isoformat()
        cur = stop + dt.timedelta(days=1)


def network_code(value) -> str:
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    s = str(value).strip()
    if len(s) > 2 and s.endswith(".0") and s[:-2].isdigit():
        return s[:-2]
    return s


def map_network(value) -> tuple[str | None, str | None]:
    """返回 (ad_network, gap_flag)。已知编码或已是总览 id 才映射。"""
    code = network_code(value)
    if code in NETWORK_CODES:
        return NETWORK_CODES[code], None
    if code in OVERVIEW_NETWORKS:
        return code, None
    return None, f"network_unmapped:{code or 'missing'}"


def _norm_date(value) -> str:
    s = str(value).strip()
    if len(s) == 8 and s.isdigit():
        return f"{s[:4]}-{s[4:6]}-{s[6:]}"
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return s[:10]
    raise GroMoreFetchError("row date unusable")


def _yuan(value, field: str) -> int:
    try:
        return yuan_to_fen(value)
    except (ValueError, TypeError, ArithmeticError):
        raise GroMoreFetchError(f"row {field} unusable")


def _pick(raw: dict, *keys):
    for k in keys:
        if k in raw and raw[k] not in (None, ""):
            return raw[k]
    return None


def parse_payload(payload) -> tuple[list[dict], int | None]:
    if not isinstance(payload, dict):
        raise GroMoreFetchError("payload")
    code = payload.get("code", payload.get("Code", payload.get("status")))
    if code not in _OK_CODES:
        raise GroMoreFetchError(f"upstream code {code}")
    data = payload.get("data", payload.get("Data"))
    if isinstance(data, list):
        return data, None
    if data is None:
        raise GroMoreFetchError("no data")
    if not isinstance(data, dict):
        raise GroMoreFetchError("no data")
    total = data.get("total", data.get("total_count", data.get("totalCount")))
    for k in _LIST_KEYS:
        if isinstance(data.get(k), list):
            return data[k], _as_int(total)
    if total in (0, "0", None) and not any(isinstance(data.get(k), list) for k in _LIST_KEYS):
        # 空成功：没有 list 且 total 为 0 / 缺省
        if total in (0, "0") or not any(k in data for k in _LIST_KEYS):
            if total in (0, "0") or data == {} or set(data) <= {"total", "total_count", "totalCount", "currency"}:
                return [], _as_int(total) or 0
    raise GroMoreFetchError("no rows")


def _as_int(v):
    if v is None or v == "":
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def map_raw_row(raw: dict) -> dict:
    if not isinstance(raw, dict):
        raise GroMoreFetchError("row")
    revenue = _pick(raw, "revenue")
    if revenue is None:
        raise GroMoreFetchError("row revenue missing")
    day = _pick(raw, "date", "stat_date", "start_date", "time")
    if day is None:
        raise GroMoreFetchError("row date missing")
    net_raw = _pick(raw, "network", "network_id", "adn_id")
    if net_raw is None and raw.get("ad_network") not in (None, ""):
        net_raw = raw.get("ad_network")
    if net_raw is None:
        ad, gap = None, "network_unmapped:missing"
        code = "missing"
    else:
        code = network_code(net_raw)
        ad, gap = map_network(net_raw)
    api_raw = raw.get("api_revenue", raw.get("apiRevenue"))
    if api_raw in (None, ""):
        api_fen = None
    else:
        api_fen = _yuan(api_raw, "api_revenue")
    return {
        "stat_date": _norm_date(day),
        "ad_network": ad,
        "code": code,
        "amount_fen": _yuan(revenue, "revenue"),
        "api_amount_fen": api_fen,
        "gap": gap,
    }


def _default_get(url: str, params: dict) -> dict:
    import httpx
    try:
        with httpx.Client(timeout=20.0) as client:
            resp = client.get(url, params=params, headers={"Accept": "application/json"})
    except httpx.HTTPError:
        raise GroMoreFetchError("http error")
    if resp.status_code != 200:
        raise GroMoreFetchError(f"http {resp.status_code}")
    try:
        body = resp.json()
    except ValueError:
        raise GroMoreFetchError("invalid json")
    return body


class GroMoreClient:
    def __init__(self, env: dict | None = None, getter=None, limit: int = 100, base: str | None = None,
                 cache_ttl: float = 90.0):
        self._env = env
        self._getter = getter or _default_get
        self.limit = limit
        self._base = base
        # 按自然日记住已映射的行。重叠区间（本年、昨日、卡片）不再重复打穿山甲。
        # 键只有 user_id / role_id，不放 secure key。失败不写入。
        self._cache_ttl = cache_ttl
        self._lock = threading.Lock()
        self._gen = 0
        self._days: dict[tuple, dict[str, tuple[float, list]]] = {}

    def clear_cache(self) -> None:
        with self._lock:
            self._gen += 1
            self._days.clear()

    def _environ(self) -> dict:
        return self._env if self._env is not None else os.environ

    def _base_url(self) -> str:
        if self._base:
            return self._base.rstrip("/")
        return (self._environ().get("CSJ_API_BASE") or DEFAULT_BASE).rstrip("/")

    def _params(self, creds: dict, start: str, end: str, offset: int) -> dict:
        params = {
            "user_id": str(creds["PANGLE_USER_ID"]),
            "role_id": str(creds["PANGLE_ROLE_ID"]),
            "timestamp": str(int(time.time())),
            "sign_type": "MD5",
            "version": "2.0",
            "start_date": start,
            "end_date": end,
            "dimensions": "date,network",
            "metrics": "revenue,api_revenue",
            "limit": str(self.limit),
            "offset": str(offset),
        }
        params["sign"] = PangleAdapter.sign(params, creds["PANGLE_SECURE_KEY"])
        return params

    def fetch(self, start: str, end: str) -> tuple[list[dict], list[str]]:
        """返回 (rows, gap_flags)。rows 为已映射的 date×network 分。无凭证抛 CredentialMissingError。"""
        creds = PangleAdapter(env=self._environ()).credentials()
        if start > end:
            return [], []
        url = self._base_url() + PATH
        if self._cache_ttl <= 0:
            return self._fetch_uncached(url, creds, start, end)
        ns = (str(creds["PANGLE_USER_ID"]), str(creds["PANGLE_ROLE_ID"]))
        with self._lock:
            gen = self._gen
        now = time.monotonic()
        for shard_start, shard_end in self._missing_shards(ns, start, end, now):
            gaps: list[str] = []
            rows = self._fetch_shard(url, creds, shard_start, shard_end, gaps)
            self._store_span(ns, shard_start, shard_end, rows, now, gen)
        return self._read_span(ns, start, end, now)

    def _fetch_uncached(self, url, creds, start: str, end: str) -> tuple[list[dict], list[str]]:
        out: list[dict] = []
        gaps: list[str] = []
        for shard_start, shard_end in iter_shards(start, end):
            out.extend(self._fetch_shard(url, creds, shard_start, shard_end, gaps))
        kept = [r for r in out if start <= r["stat_date"] <= end]
        return kept, sorted(set(gaps))

    def _missing_shards(self, ns: tuple, start: str, end: str, now: float):
        missing: list[str] = []
        with self._lock:
            bucket = self._days.get(ns, {})
            day = dt.date.fromisoformat(start)
            last = dt.date.fromisoformat(end)
            while day <= last:
                iso = day.isoformat()
                hit = bucket.get(iso)
                if not hit or now - hit[0] >= self._cache_ttl:
                    missing.append(iso)
                day += dt.timedelta(days=1)
        if not missing:
            return []
        spans: list[tuple[str, str]] = []
        begin = prev = missing[0]
        for iso in missing[1:]:
            nxt = (dt.date.fromisoformat(prev) + dt.timedelta(days=1)).isoformat()
            if iso == nxt:
                prev = iso
                continue
            spans.append((begin, prev))
            begin = prev = iso
        spans.append((begin, prev))
        shards = []
        for span_start, span_end in spans:
            shards.extend(iter_shards(span_start, span_end))
        return shards

    def _store_span(self, ns: tuple, start: str, end: str, rows: list[dict], now: float, gen: int) -> None:
        by: dict[str, list] = {}
        for row in rows:
            by.setdefault(row["stat_date"], []).append(dict(row))
        with self._lock:
            if gen != self._gen:
                return
            bucket = self._days.setdefault(ns, {})
            day = dt.date.fromisoformat(start)
            last = dt.date.fromisoformat(end)
            while day <= last:
                iso = day.isoformat()
                bucket[iso] = (now, by.get(iso, []))
                day += dt.timedelta(days=1)
            if len(bucket) > 420:
                for old in sorted(bucket)[: len(bucket) - 400]:
                    bucket.pop(old, None)

    def _read_span(self, ns: tuple, start: str, end: str, now: float) -> tuple[list[dict], list[str]]:
        rows: list[dict] = []
        with self._lock:
            bucket = self._days.get(ns, {})
            day = dt.date.fromisoformat(start)
            last = dt.date.fromisoformat(end)
            while day <= last:
                hit = bucket.get(day.isoformat())
                if hit and now - hit[0] < self._cache_ttl:
                    rows.extend(dict(item) for item in hit[1])
                day += dt.timedelta(days=1)
        gaps = sorted({row["gap"] for row in rows if row.get("gap")})
        return rows, gaps

    def _fetch_shard(self, url, creds, start, end, gaps) -> list[dict]:
        offset = 0
        rows: list[dict] = []
        seen_first = None
        while True:
            payload = self._getter(url, self._params(creds, start, end, offset))
            page, total = parse_payload(payload)
            if not page:
                break
            first = (str(page[0].get("date") or page[0].get("stat_date") or ""), str(page[0].get("network") or ""))
            if seen_first == first and offset:
                raise GroMoreFetchError("pagination stalled")
            seen_first = first
            for raw in page:
                mapped = map_raw_row(raw)
                if not (start <= mapped["stat_date"] <= end):
                    continue
                if mapped["gap"]:
                    gaps.append(mapped["gap"])
                rows.append(mapped)
            offset += len(page)
            if len(page) < self.limit:
                break
            if total is not None and offset >= total:
                break
            if offset > self.limit * 200:
                raise GroMoreFetchError("pagination cap")
        return rows
