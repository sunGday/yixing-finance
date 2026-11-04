"""穿山甲 / CSJ 预估收入。GET https://open-api.csjplatform.com/union_media/open_api/rt/income

与 @csj-cn/csj-cli `report income` 同一路径与查询参数（region、date 或 start/end、
time_zone=8、currency=cny、user_id、role_id、timestamp 秒、version=2.0、sign_type=MD5、
current_time 上海时区）。签名：参数按 key 排序拼 `k=v&...` 后直接追加 security_key，MD5 小写。
凭证：PANGLE_USER_ID / PANGLE_ROLE_ID / PANGLE_SECURE_KEY，别名 CSJ_MEDIA_ID / CSJ_ROLE_ID / CSJ_SECURITY_KEY。
密钥只从 env（credentials store 热加载进 os.environ）读取，不入库、不进错误信息。
"""
from __future__ import annotations
import datetime as dt
import hashlib
import re
from .base import RevenueAdapter, RevenueRow, register, yuan_to_fen

HOST = "https://open-api.csjplatform.com"
INCOME_PATH = "/union_media/open_api/rt/income"
ENDPOINT = HOST + INCOME_PATH
SH = dt.timezone(dt.timedelta(hours=8))
MAX_SPAN_DAYS = 31
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_ENV_ALIASES = {
    "PANGLE_USER_ID": ("CSJ_MEDIA_ID",),
    "PANGLE_ROLE_ID": ("CSJ_ROLE_ID",),
    "PANGLE_SECURE_KEY": ("CSJ_SECURITY_KEY",),
}


class IncomeFetchError(RuntimeError):
    """上游收入接口失败。消息不得包含 security key。"""


def http_get(url: str, params: dict, headers: dict, timeout: float):
    """GET JSON。不跟随重定向（避免把带签名的 query 送到别的 host）。"""
    import httpx
    try:
        resp = httpx.get(url, params=params, headers=headers, timeout=timeout, follow_redirects=False)
    except httpx.HTTPError as e:
        raise IncomeFetchError(f"transport {type(e).__name__}") from None
    if resp.status_code != 200:
        raise IncomeFetchError(f"HTTP {resp.status_code}")
    try:
        body = resp.json()
    except Exception:
        raise IncomeFetchError("response is not JSON")
    if not isinstance(body, dict):
        raise IncomeFetchError("response JSON is not an object")
    return body


def sign(params: dict, secure_key: str) -> str:
    """md5(sorted `k=v` joined by `&`, then security_key). `sign` 与空值不参与。"""
    parts = [f"{k}={params[k]}" for k in sorted(params) if k != "sign" and params[k] not in (None, "")]
    return hashlib.md5(("&".join(parts) + secure_key).encode()).hexdigest()


def _as_shanghai(now) -> dt.datetime:
    if now is None:
        return dt.datetime.now(SH)
    if isinstance(now, (int, float)):
        return dt.datetime.fromtimestamp(now, SH)
    if now.tzinfo is None:
        return now.replace(tzinfo=SH)
    return now.astimezone(SH)


def _parse_date(v: str, name: str) -> dt.date:
    try:
        return dt.date.fromisoformat(v)
    except ValueError:
        raise IncomeFetchError(f"{name} must be YYYY-MM-DD") from None


def _windows(start: dt.date, end: dt.date):
    cur = start
    while cur <= end:
        wend = min(end, cur + dt.timedelta(days=MAX_SPAN_DAYS - 1))
        yield cur, wend
        cur = wend + dt.timedelta(days=1)


def _iter_raw_rows(data):
    if data is None:
        return
    if isinstance(data, str):
        import json
        try:
            data = json.loads(data)
        except ValueError:
            raise IncomeFetchError("data is not JSON")
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict):
                yield item
        return
    if not isinstance(data, dict):
        return
    if isinstance(data.get("list"), list):
        yield from _iter_raw_rows(data["list"])
        return
    for key, val in data.items():
        if isinstance(val, list):
            for item in val:
                if isinstance(item, dict):
                    row = dict(item)
                    if DATE_RE.match(str(key)) and not row.get("date"):
                        row["date"] = str(key)
                    yield row
        elif isinstance(val, dict) and any(k in val for k in ("revenue", "app_id", "ad_slot_id")):
            row = dict(val)
            if DATE_RE.match(str(key)) and not row.get("date"):
                row["date"] = str(key)
            yield row


@register("pangle", "csj")
class PangleAdapter(RevenueAdapter):
    ad_network = "pangle"
    env_keys = ("PANGLE_USER_ID", "PANGLE_ROLE_ID", "PANGLE_SECURE_KEY")
    live_supported = True

    def _get(self, key: str):
        v = super()._get(key)
        if v:
            return v
        for alt in _ENV_ALIASES.get(key, ()):
            v = self.env.get(alt)
            if v:
                return v
        return None

    @staticmethod
    def sign(params: dict, secure_key: str) -> str:
        """GroMore 日报复用 rt/income 的同一套签名（空值不参与）。"""
        return sign(params, secure_key)

    def _query(self, creds: dict, *, date: str | None, start: str | None, end: str | None, now) -> dict:
        moment = _as_shanghai(now)
        params = {
            "user_id": str(creds["PANGLE_USER_ID"]),
            "role_id": str(creds["PANGLE_ROLE_ID"]),
            "timestamp": str(int(moment.timestamp())),
            "sign_type": "MD5",
            "version": "2.0",
            "region": "cn",
            "currency": "cny",
            "time_zone": "8",
            "current_time": moment.strftime("%Y-%m-%d %H:%M:%S"),
        }
        if date:
            params["date"] = date
        else:
            params["start_date"] = start
            params["end_date"] = end
        params["sign"] = sign(params, creds["PANGLE_SECURE_KEY"])
        return params

    def build_request(self, stat_date: str, now=None) -> dict:
        c = self.credentials()
        params = self._query(c, date=stat_date, start=None, end=None, now=now)
        return {"method": "GET", "url": ENDPOINT, "params": params,
                "headers": {"Role-Id": params["role_id"], "Sign-Timestamp": params["timestamp"]},
                "dry_run": self.dry_run, "verified": not self.dry_run}

    def map_row(self, raw: dict, stat_date: str, evidence_ref=None) -> RevenueRow:
        """revenue(元,净)→amount_fen；show→impressions；click→clicks；ecpm(元)→ecpm_fen；
        app_id / ad_slot_id→placement_id；region→country（两位大写）。"""
        region = raw.get("region") or "CN"
        if isinstance(region, str) and len(region) == 2 and region.isalpha():
            region = region.upper()
        bundle = raw.get("package_name")
        return RevenueRow(
            ad_network="pangle", stat_date=raw.get("date") or stat_date,
            amount_fen=yuan_to_fen(raw.get("revenue")),
            gross_amount_fen=yuan_to_fen(raw["gross_revenue"]) if raw.get("gross_revenue") not in (None, "") else None,
            app_id=str(raw.get("app_id") or "") or None, placement_id=str(raw.get("ad_slot_id") or "") or None,
            bundle_id=str(bundle) if bundle not in (None, "") else None,
            country=region, impressions=int(raw.get("show") or 0), clicks=int(raw.get("click") or 0),
            ecpm_fen=yuan_to_fen(raw["ecpm"]) if raw.get("ecpm") not in (None, "") else None,
            settlement_status="estimated", evidence_ref=evidence_ref)

    def _resolve_range(self, start: str | None, end: str | None, now) -> tuple[dt.date, dt.date] | None:
        """收入接口不含当天。未给日期则取上海时区 T-1。只问今天/未来则无行。"""
        moment = _as_shanghai(now)
        latest = moment.date() - dt.timedelta(days=1)
        if not start and not end:
            return latest, latest
        s = _parse_date(start or end, "start_date")
        e = _parse_date(end or start, "end_date")
        if s > e:
            raise IncomeFetchError("start_date > end_date")
        if e > latest:
            e = latest
        if s > e:
            return None
        return s, e

    def _pull(self, creds: dict, start: dt.date, end: dt.date, now) -> list[RevenueRow]:
        rows: list[RevenueRow] = []
        for w0, w1 in _windows(start, end):
            if w0 == w1:
                params = self._query(creds, date=w0.isoformat(), start=None, end=None, now=now)
            else:
                params = self._query(creds, date=None, start=w0.isoformat(), end=w1.isoformat(), now=now)
            body = http_get(ENDPOINT, params, {"Role-Id": params["role_id"], "Sign-Timestamp": params["timestamp"],
                                                "User-Agent": "yixing-finance"}, timeout=20.0)
            code = body.get("code", body.get("Code"))
            if str(code).strip() != "100":
                msg = str(body.get("message") or body.get("msg") or body.get("Message") or "")
                secret = creds.get("PANGLE_SECURE_KEY") or ""
                if secret:
                    msg = msg.replace(secret, "***")
                raise IncomeFetchError(f"code={code} {msg[:160]}")
            for raw in _iter_raw_rows(body.get("data", body.get("Data"))):
                if raw.get("revenue") in (None, ""):
                    continue
                stat = str(raw.get("date") or w0.isoformat())
                if not DATE_RE.match(stat):
                    continue
                day = dt.date.fromisoformat(stat)
                if day < start or day > end:
                    continue
                rows.append(self.map_row(raw, stat, evidence_ref="csj-rt-income"))
        return rows

    def fetch(self, start: str | None = None, end: str | None = None, now=None) -> list[RevenueRow]:
        if self.dry_run:
            raise NotImplementedError(
                f"[{self.ad_network}] dry_run fetch does not send HTTP (pass dry_run=False)")
        creds = self.credentials()
        span = self._resolve_range(start, end, now)
        if span is None:
            return []
        return self._pull(creds, span[0], span[1], now)
