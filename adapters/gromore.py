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
单次请求跨度 ≤30 天（含首尾），更长区间分片。分页 limit 默认 500：
上游忽略 offset，30 天 × 4 网络（120 行）必须落在一页里。不在 import 时发 HTTP。

日缓存按 (user_id, role_id, 上海自然日) 记已映射的行，不写 secure key。
早于昨日的日子默认留 24 小时，昨日及更新的日子 90 秒；失败不写入。
设了 FIN_DATA_DIR 时落到 gromore-daily.json，重启后仍可命中。分片并行拉取，
单次等待有上限，避免本年区间把请求挂到 BFF 断开。
"""
from __future__ import annotations
import datetime as dt
import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, wait

from adapters.base import CredentialMissingError, yuan_to_fen
from adapters.pangle import PangleAdapter

PATH = "/union_media/open/api/mediation/get_daily_income_report_data"
DEFAULT_BASE = "https://www.csjplatform.com"
MAX_SPAN_DAYS = 30
# 穿山甲忽略 offset，第二页会原样再返回第一页。30 天 × 4 网络 = 120 行，
# limit=100 必然翻页然后 pagination stalled，整段预估失败。500 让一个分片一页装下。
DEFAULT_PAGE_LIMIT = 500
# Allen verified 2026-11-03. Do not extend from the upload-API ADN table (code 9 ≠ gm_adx).
NETWORK_CODES = {"1": "pangle", "3": "ylh", "7": "kuaishou", "10": "gm_adx"}
OVERVIEW_NETWORKS = ("pangle", "ylh", "kuaishou", "gm_adx")
_OK_CODES = {None, 0, "0", 100, "100", 200, "200"}
_LIST_KEYS = ("report_list", "reportlist", "reportList", "list", "rows", "data_list", "dataList")


class GroMoreFetchError(RuntimeError):
    """上游失败。message 不得含凭证或响应正文。"""


class GroMoreTimeout(GroMoreFetchError):
    """等待上限到了，这一段还没有完整的日缓存。"""


# 昨日（上海）仍可能改数，短 TTL。更早的自然日作为闭日，避免每次点本年都重拉全年。
RECENT_TTL = 90.0
CLOSED_TTL = 24 * 60 * 60
DEFAULT_MAX_WAIT = 20.0
MAX_FETCH_WORKERS = 6
CACHE_FILE = "gromore-daily.json"
_SH = dt.timezone(dt.timedelta(hours=8))
_ROW_KEYS = ("stat_date", "ad_network", "code", "amount_fen", "api_amount_fen", "gap")


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


def _ns_key(ns: tuple) -> str:
    return str(ns[0]) + "\x1f" + str(ns[1])


def _safe_row(row: dict) -> dict | None:
    if not isinstance(row, dict) or not row.get("stat_date"):
        return None
    try:
        amount = int(row["amount_fen"])
    except (KeyError, TypeError, ValueError):
        return None
    api = row.get("api_amount_fen")
    if api is not None:
        try:
            api = int(api)
        except (TypeError, ValueError):
            return None
    out = {k: row.get(k) for k in _ROW_KEYS}
    out["stat_date"] = str(row["stat_date"])[:10]
    out["amount_fen"] = amount
    out["api_amount_fen"] = api
    return out


class GroMoreClient:
    def __init__(self, env: dict | None = None, getter=None, limit: int = DEFAULT_PAGE_LIMIT, base: str | None = None,
                 cache_ttl: float = RECENT_TTL, closed_ttl: float = CLOSED_TTL, clock=None, today=None):
        self._env = env
        self._getter = getter or _default_get
        self.limit = limit
        self._base = base
        # 键只有 user_id / role_id + 自然日，不放 secure key。失败不写入。
        # cache_ttl<=0 关闭缓存（与旧行为一致）。闭日用 closed_ttl，昨日用 cache_ttl。
        self._cache_ttl = cache_ttl
        self._closed_ttl = closed_ttl
        self._clock = clock or time.time
        self._today = today
        self._lock = threading.Lock()
        self._persist_lock = threading.Lock()
        self._gen = 0
        self._persist_gen = 0
        self._loaded = False
        self._loading = None
        self._refreshing = False
        self._days: dict[tuple, dict[str, tuple[float, list]]] = {}
        self._inflight: dict[tuple, dict] = {}

    def clear_cache(self) -> None:
        with self._persist_lock:
            with self._lock:
                self._gen += 1
                self._days.clear()
                self._loaded = True
                slots = list(self._inflight.values())
                self._inflight.clear()
            for slot in slots:
                slot["event"].set()
            self._delete_cache_file()

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

    def fetch(self, start: str, end: str, *, max_wait: float | None = DEFAULT_MAX_WAIT,
              stale_ok: bool = False) -> tuple[list[dict], list[str]]:
        """返回 (rows, gap_flags)。rows 为已映射的 date×network 分。无凭证抛 CredentialMissingError。

        max_wait：本次同步等待上限（秒）。到点仍缺日，且区间里没有任何日缓存，才抛 GroMoreTimeout。
        已完成的分片留在缓存里；只要有一天，就返回这些行并带 gromore_partial，不把整段变成空。
        stale_ok：区间里每一天都有过缓存（含过期）时立刻返回，缺的新鲜日放到后台刷新。
        """
        creds = PangleAdapter(env=self._environ()).credentials()
        if start > end:
            return [], []
        url = self._base_url() + PATH
        if self._cache_ttl <= 0:
            return self._fetch_uncached(url, creds, start, end)
        ns = (str(creds["PANGLE_USER_ID"]), str(creds["PANGLE_ROLE_ID"]))
        self._ensure_loaded()
        with self._lock:
            gen = self._gen
        if stale_ok and self._covered(ns, start, end, allow_stale=True):
            missing = self._missing_shards(ns, start, end)
            if missing:
                self._refresh_async(url, creds, ns, missing, gen)
            return self._read_span(ns, start, end, allow_stale=True)
        shards = self._missing_shards(ns, start, end)
        failure = None
        if shards:
            try:
                self._run_shards(url, creds, ns, start, end, shards, gen, max_wait)
            except GroMoreFetchError as exc:
                failure = exc
        if self._covered(ns, start, end, allow_stale=False):
            return self._read_span(ns, start, end, allow_stale=False)
        if stale_ok and self._covered(ns, start, end, allow_stale=True):
            return self._read_span(ns, start, end, allow_stale=True)
        if self._has_cached(ns, start, end):
            rows, gaps = self._read_span(ns, start, end, allow_stale=True)
            missing = self._missing_shards(ns, start, end)
            if missing:
                self._refresh_async(url, creds, ns, missing, gen)
            return rows, sorted(set(gaps) | {"gromore_partial", "gromore_fetch_failed"})
        if failure is not None and not isinstance(failure, GroMoreTimeout):
            raise failure
        raise GroMoreTimeout("deadline")

    def _fetch_uncached(self, url, creds, start: str, end: str) -> tuple[list[dict], list[str]]:
        out: list[dict] = []
        gaps: list[str] = []
        for shard_start, shard_end in iter_shards(start, end):
            out.extend(self._fetch_shard(url, creds, shard_start, shard_end, gaps))
        kept = [r for r in out if start <= r["stat_date"] <= end]
        return kept, sorted(set(gaps))

    def _today_date(self) -> dt.date:
        src = self._today() if callable(self._today) else self._today
        if isinstance(src, str):
            return dt.date.fromisoformat(src)
        if isinstance(src, dt.datetime):
            return src.date()
        if isinstance(src, dt.date):
            return src
        return dt.datetime.now(_SH).date()

    def _ttl_for(self, iso: str, today: dt.date) -> float:
        yesterday = (today - dt.timedelta(days=1)).isoformat()
        if iso < yesterday:
            return self._closed_ttl
        return self._cache_ttl

    def _fresh(self, hit, iso: str, now: float, today: dt.date) -> bool:
        return bool(hit) and now - hit[0] < self._ttl_for(iso, today)

    def _has_cached(self, ns: tuple, start: str, end: str) -> bool:
        with self._lock:
            bucket = self._days.get(ns, {})
            day = dt.date.fromisoformat(start)
            last = dt.date.fromisoformat(end)
            while day <= last:
                if day.isoformat() in bucket:
                    return True
                day += dt.timedelta(days=1)
        return False

    def _covered(self, ns: tuple, start: str, end: str, *, allow_stale: bool) -> bool:
        now = self._clock()
        today = self._today_date()
        with self._lock:
            bucket = self._days.get(ns, {})
            day = dt.date.fromisoformat(start)
            last = dt.date.fromisoformat(end)
            while day <= last:
                iso = day.isoformat()
                hit = bucket.get(iso)
                if hit is None or (not allow_stale and not self._fresh(hit, iso, now, today)):
                    return False
                day += dt.timedelta(days=1)
        return True

    def _missing_shards(self, ns: tuple, start: str, end: str):
        missing: list[str] = []
        now = self._clock()
        today = self._today_date()
        with self._lock:
            bucket = self._days.get(ns, {})
            day = dt.date.fromisoformat(start)
            last = dt.date.fromisoformat(end)
            while day <= last:
                iso = day.isoformat()
                hit = bucket.get(iso)
                if not self._fresh(hit, iso, now, today):
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

    def _store_span(self, ns: tuple, start: str, end: str, rows: list[dict], gen: int) -> None:
        by: dict[str, list] = {}
        for row in rows:
            safe = _safe_row(row)
            if safe is None:
                continue
            by.setdefault(safe["stat_date"], []).append(safe)
        stamp = self._clock()
        with self._lock:
            if gen != self._gen:
                return
            bucket = self._days.setdefault(ns, {})
            day = dt.date.fromisoformat(start)
            last = dt.date.fromisoformat(end)
            while day <= last:
                iso = day.isoformat()
                bucket[iso] = (stamp, [dict(item) for item in by.get(iso, [])])
                day += dt.timedelta(days=1)
            if len(bucket) > 420:
                for old in sorted(bucket)[: len(bucket) - 400]:
                    bucket.pop(old, None)
            self._persist_gen += 1
            token = self._persist_gen
            stored_gen = self._gen
        self._write_snapshot(stored_gen, token)

    def _read_span(self, ns: tuple, start: str, end: str, *, allow_stale: bool) -> tuple[list[dict], list[str]]:
        rows: list[dict] = []
        now = self._clock()
        today = self._today_date()
        with self._lock:
            bucket = self._days.get(ns, {})
            day = dt.date.fromisoformat(start)
            last = dt.date.fromisoformat(end)
            while day <= last:
                iso = day.isoformat()
                hit = bucket.get(iso)
                if hit and (allow_stale or self._fresh(hit, iso, now, today)):
                    rows.extend(dict(item) for item in hit[1])
                day += dt.timedelta(days=1)
        gaps = sorted({row["gap"] for row in rows if row.get("gap")})
        return rows, gaps

    def _run_shards(self, url, creds, ns, start, end, shards, gen, max_wait) -> None:
        if max_wait is not None and max_wait < 0:
            max_wait = 0
        deadline = None if max_wait is None else time.monotonic() + max_wait
        workers = min(MAX_FETCH_WORKERS, len(shards))
        ex = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="gromore")
        futs = [ex.submit(self._fetch_store_shard, url, creds, ns, a, b, gen, deadline) for a, b in shards]
        try:
            done, pending = wait(futs, timeout=max_wait)
        finally:
            ex.shutdown(wait=False, cancel_futures=False)
        errors = []
        for fut in done:
            err = fut.exception()
            if err is not None:
                errors.append(err)
        hard = [e for e in errors if not isinstance(e, GroMoreTimeout)]
        if hard:
            raise hard[0]
        if pending and not self._covered(ns, start, end, allow_stale=False):
            raise GroMoreTimeout("deadline")
        if errors and not self._covered(ns, start, end, allow_stale=False):
            raise GroMoreTimeout("deadline")

    def _fetch_store_shard(self, url, creds, ns, start, end, gen, deadline) -> None:
        key = (ns, start, end)
        with self._lock:
            slot = self._inflight.get(key)
            if slot is None:
                slot = {"event": threading.Event(), "err": None}
                self._inflight[key] = slot
                owner = True
            else:
                owner = False
        if not owner:
            timeout = None if deadline is None else max(0.0, deadline - time.monotonic())
            if not slot["event"].wait(timeout):
                raise GroMoreTimeout("deadline")
            if slot["err"] is not None:
                raise slot["err"]
            return
        try:
            gaps: list[str] = []
            rows = self._fetch_shard(url, creds, start, end, gaps)
            self._store_span(ns, start, end, rows, gen)
        except Exception as e:
            slot["err"] = e
            raise
        finally:
            slot["event"].set()
            with self._lock:
                if self._inflight.get(key) is slot:
                    self._inflight.pop(key, None)

    def _refresh_async(self, url, creds, ns, shards, gen) -> None:
        with self._lock:
            if self._refreshing:
                return
            self._refreshing = True

        def run():
            try:
                self._run_shards(url, creds, ns, shards[0][0], shards[-1][1], shards, gen, None)
            except GroMoreFetchError:
                return
            finally:
                with self._lock:
                    self._refreshing = False

        threading.Thread(target=run, name="gromore-refresh", daemon=True).start()

    def _cache_file(self) -> str | None:
        folder = os.environ.get("FIN_DATA_DIR")
        if not folder:
            return None
        return os.path.join(folder, CACHE_FILE)

    def _delete_cache_file(self) -> None:
        path = self._cache_file()
        if not path:
            return
        try:
            os.remove(path)
        except FileNotFoundError:
            return
        except OSError:
            return

    def _export_locked(self) -> dict:
        accounts = {}
        for ns, bucket in self._days.items():
            days = {}
            for iso, (stamp, rows) in bucket.items():
                days[iso] = {"t": stamp, "rows": [dict(r) for r in rows]}
            accounts[_ns_key(ns)] = days
        return {"version": 1, "accounts": accounts}

    def _write_snapshot(self, gen: int, token: int) -> None:
        path = self._cache_file()
        if not path:
            return
        secret = str(self._environ().get("PANGLE_SECURE_KEY") or "")
        try:
            with self._persist_lock:
                with self._lock:
                    if gen != self._gen or token != self._persist_gen:
                        return
                    snapshot = self._export_locked()
                try:
                    body = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"))
                except (TypeError, ValueError):
                    return
                if secret and secret in body:
                    return
                os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
                tmp = path + ".tmp"
                with open(tmp, "w", encoding="utf-8") as fh:
                    fh.write(body)
                    fh.flush()
                    os.fsync(fh.fileno())
                with self._lock:
                    if gen != self._gen or token != self._persist_gen:
                        try:
                            os.remove(tmp)
                        except OSError:
                            pass
                        return
                    os.replace(tmp, path)
        except OSError:
            return

    def _ensure_loaded(self) -> None:
        with self._lock:
            if self._loaded:
                return
            if self._loading is None:
                self._loading = threading.Event()
                leader = True
            else:
                leader = False
            loading = self._loading
        if not leader:
            loading.wait()
            return
        try:
            self._load_file()
        finally:
            with self._lock:
                self._loaded = True
                self._loading = None
            loading.set()

    def _load_file(self) -> None:
        path = self._cache_file()
        if not path or not os.path.exists(path):
            return
        try:
            with open(path, encoding="utf-8") as fh:
                payload = json.load(fh)
        except (OSError, ValueError):
            return
        if not isinstance(payload, dict) or payload.get("version") != 1:
            return
        accounts = payload.get("accounts")
        if not isinstance(accounts, dict):
            return
        secret = str(self._environ().get("PANGLE_SECURE_KEY") or "")
        if secret and secret in json.dumps(accounts):
            return
        parsed: dict[tuple, dict] = {}
        for key, days in accounts.items():
            if not isinstance(key, str) or "\x1f" not in key or not isinstance(days, dict):
                continue
            user, role = key.split("\x1f", 1)
            bucket: dict[str, tuple] = {}
            for iso, item in days.items():
                if not isinstance(iso, str) or len(iso) != 10 or not isinstance(item, dict):
                    continue
                try:
                    stamp = float(item.get("t"))
                except (TypeError, ValueError):
                    continue
                raw_rows = item.get("rows") if isinstance(item.get("rows"), list) else []
                safe_rows = []
                for raw in raw_rows:
                    safe = _safe_row(raw)
                    if safe is not None and safe["stat_date"] == iso:
                        safe_rows.append(safe)
                bucket[iso] = (stamp, safe_rows)
            if bucket:
                parsed[(user, role)] = bucket
        with self._lock:
            for ns, bucket in parsed.items():
                cur = self._days.setdefault(ns, {})
                for iso, item in bucket.items():
                    prev = cur.get(iso)
                    if prev is None or item[0] >= prev[0]:
                        cur[iso] = item

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
                # offset 被忽略时下一页与上一页相同，再翻也没有新行。停在已拿到的页，避免整段失败。
                break
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
