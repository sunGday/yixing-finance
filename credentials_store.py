"""收入渠道凭证存储（t294u）。文件在 FIN_SECRETS_DIR（非 repo），dir 0700 / file 0600；可选 Fernet(FIN_CREDENTIALS_KEY)。
加载规则：进程 env 优先于文件（同名键或其别名已在启动时 env 中 → 不覆盖）。写入后热更新 os.environ（仅文件来源的键）。
绝不 log/print 明文；API 只返回脱敏 hint。"""
from __future__ import annotations
import datetime as dt, json, os, tempfile, threading
from adapters.base import ADAPTERS

FILE_NAME = "revenue-credentials.json"
PROD_DIR = "/var/lib/yixing-finance/secrets"
BOX_DIR = "/home/box/.secrets/yixing-finance"
SH = dt.timezone(dt.timedelta(hours=8))
CHANNEL_LABELS = {"pangle": "穿山甲", "ylh": "优量汇"}
FIELD_LABELS = {"PANGLE_USER_ID": "User ID", "PANGLE_ROLE_ID": "Role ID", "PANGLE_SECURE_KEY": "Secure Key",
                "YLH_MEMBER_ID": "Member ID", "YLH_SECRET": "Secret"}
MAX_LEN = 4096


class CredentialInputError(ValueError):
    """→ 40002 (unknown channel/field) or 40001 (bad value)."""
    def __init__(self, code: int, msg: str):
        super().__init__(msg); self.code = code


def secrets_dir() -> str:
    d = os.environ.get("FIN_SECRETS_DIR")
    if d: return d
    return PROD_DIR if os.path.isdir(PROD_DIR) else BOX_DIR


def is_secret(key: str) -> bool:
    k = key.upper()
    return any(s in k for s in ("SECRET", "KEY", "TOKEN", "PASSWORD"))


def now_iso() -> str: return dt.datetime.now(SH).isoformat(timespec="seconds")


def schema() -> list[dict]:
    """从已注册适配器的 env_keys 生成（加渠道 = 加 adapter，表单自动出现）。"""
    by_cls: dict[type, list[str]] = {}
    for name, cls in ADAPTERS.items(): by_cls.setdefault(cls, []).append(name)
    out = []
    for cls, names in by_cls.items():
        cid = cls.ad_network
        fields = []
        for k in cls.env_keys:
            sec = is_secret(k)
            f = {"key": k, "label": FIELD_LABELS.get(k, k.split("_", 1)[-1].replace("_", " ").title()),
                 "secret": sec, "required": True, "input": "password" if sec else "text"}
            al = [p + k.split("_", 1)[1] for p in cls.env_alias_prefixes]
            if al: f["aliases"] = al
            fields.append(f)
        out.append({"id": cid, "label": CHANNEL_LABELS.get(cid, cid), "aliases": sorted(n for n in names if n != cid),
                    "fields": fields})
    return sorted(out, key=lambda c: c["id"])


def _channel_map():
    sc = {c["id"]: c for c in schema()}
    alias = {a: c["id"] for c in sc.values() for a in [c["id"], *c["aliases"]]}
    return sc, alias


def resolve_channel(ch: str) -> dict:
    sc, alias = _channel_map()
    cid = alias.get((ch or "").strip().lower())
    if not cid: raise CredentialInputError(40002, f"unknown channel {ch!r}; allowed {sorted(alias)}")
    return sc[cid]


def _field_alias(chan: dict) -> dict:
    m = {}
    for f in chan["fields"]:
        m[f["key"]] = f["key"]
        for a in f.get("aliases", []): m[a] = f["key"]
    return m


def mask(value: str | None, secret: bool) -> str | None:
    if not value: return None
    if secret: return "••••"
    return value[0] + "***" + value[-2:] if len(value) > 4 else "****"


class CredentialStore:
    def __init__(self, directory: str | None = None):
        self.dir = directory or secrets_dir()
        self.path = os.path.join(self.dir, FILE_NAME)
        self.channels: dict[str, dict] = {}
        self._lock = threading.Lock()
        self._applied: set[str] = set()          # 由本 store 写入 os.environ 的键
        self._env_owned: set[str] = set()        # 加载前进程 env 已有（含别名）→ 永不覆盖/删除
        self.load_error: str | None = None
        self._snapshot_env_owned()
        self.load()

    # ---- crypto ----
    @staticmethod
    def _fernet():
        k = os.environ.get("FIN_CREDENTIALS_KEY")
        if not k: return None
        from cryptography.fernet import Fernet  # requirements: cryptography（仅设 key 时需要）
        return Fernet(k.encode())

    def _snapshot_env_owned(self):
        for c in schema():
            for f in c["fields"]:
                if any(os.environ.get(k) for k in [f["key"], *f.get("aliases", [])]):
                    self._env_owned.add(f["key"])

    def encrypted(self) -> bool: return bool(os.environ.get("FIN_CREDENTIALS_KEY"))

    def load(self):
        self.load_error = None
        if not os.path.exists(self.path):
            self.channels = {}; return
        try:
            with open(self.path, "rb") as fh: raw = fh.read()
            obj = json.loads(raw)
            if isinstance(obj, dict) and obj.get("enc") == "fernet":
                f = self._fernet()
                if f is None: raise RuntimeError("file encrypted but FIN_CREDENTIALS_KEY not set")
                obj = json.loads(f.decrypt(obj["token"].encode()))
            self.channels = dict(obj.get("channels") or {})
        except Exception as e:  # 不回显内容
            self.channels = {}; self.load_error = f"{type(e).__name__}: credentials file unreadable"
        self._apply_env()

    def _save(self):
        os.makedirs(self.dir, mode=0o700, exist_ok=True)
        try: os.chmod(self.dir, 0o700)
        except OSError: pass
        body = json.dumps({"version": 1, "channels": self.channels}, ensure_ascii=False, sort_keys=True).encode()
        f = self._fernet()
        if f is not None:
            body = json.dumps({"version": 1, "enc": "fernet", "token": f.encrypt(body).decode()}).encode()
        fd, tmp = tempfile.mkstemp(prefix=".rc-", dir=self.dir)
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "wb") as fh: fh.write(body); fh.flush(); os.fsync(fh.fileno())
            os.replace(tmp, self.path); os.chmod(self.path, 0o600)
        except BaseException:
            if os.path.exists(tmp): os.unlink(tmp)
            raise

    def _apply_env(self):
        want = {k: v for c in self.channels.values() for k, v in (c.get("fields") or {}).items() if v}
        for k in list(self._applied):
            if k not in want:
                os.environ.pop(k, None); self._applied.discard(k)
        for k, v in want.items():
            if k in self._env_owned: continue  # 进程 env 优先
            os.environ[k] = v; self._applied.add(k)

    # ---- queries ----
    def _source(self, key: str, chan: dict) -> str:
        if key in self._env_owned: return "env"
        if (self.channels.get(chan["id"], {}).get("fields") or {}).get(key): return "file"
        return "none"

    def _effective(self, key: str, chan: dict) -> str | None:
        f = next(x for x in chan["fields"] if x["key"] == key)
        for k in [key, *f.get("aliases", [])]:
            if os.environ.get(k): return os.environ[k]
        return None

    def describe(self, ch: str) -> dict:
        chan = resolve_channel(ch)
        stored = self.channels.get(chan["id"], {})
        fields, n_set, n_req = [], 0, 0
        for f in chan["fields"]:
            v = self._effective(f["key"], chan); src = self._source(f["key"], chan)
            file_v = (stored.get("fields") or {}).get(f["key"])
            n_req += f["required"]; n_set += bool(v) and f["required"]
            fields.append({"key": f["key"], "label": f["label"], "secret": f["secret"], "required": f["required"],
                           "set": bool(v), "hint": mask(v, f["secret"]), "source": src,
                           "overridden_by_env": bool(file_v) and src == "env"})
        status = "configured" if n_set == n_req else ("missing" if n_set == 0 else "partial")
        return {"channel": chan["id"], "label": chan["label"], "status": status,
                "updated_at": stored.get("updated_at"), "fields": fields}

    def statuses(self) -> dict:
        return {c["id"]: self.describe(c["id"])["status"] for c in schema()}

    def list(self) -> dict:
        return {"storage": {"dir": self.dir, "file": FILE_NAME, "exists": os.path.exists(self.path),
                            "encrypted": self.encrypted(), "load_error": self.load_error},
                "channels": [self.describe(c["id"]) for c in schema()]}

    # ---- writes ----
    def _validate(self, chan: dict, fields) -> dict:
        if not isinstance(fields, dict) or not fields:
            raise CredentialInputError(40001, "body must be {\"fields\": {KEY: value}} with at least one key")
        amap, out = _field_alias(chan), {}
        for k, v in fields.items():
            ck = amap.get(str(k).strip().upper())
            if not ck: raise CredentialInputError(40002, f"unknown field {k!r} for channel {chan['id']}; allowed {sorted(amap)}")
            if v is None: v = ""
            if not isinstance(v, str): raise CredentialInputError(40001, f"field {ck} must be string")
            v = v.strip()
            if len(v) > MAX_LEN or any(c in v for c in "\r\n\x00"):
                raise CredentialInputError(40001, f"field {ck} invalid (newline/too long)")
            out[ck] = v
        return out

    def upsert(self, ch: str, fields, replace: bool) -> dict:
        chan = resolve_channel(ch); vals = self._validate(chan, fields)
        with self._lock:
            cur = {} if replace else dict((self.channels.get(chan["id"], {}).get("fields") or {}))
            for k, v in vals.items():
                if v: cur[k] = v
                else: cur.pop(k, None)
            if cur: self.channels[chan["id"]] = {"fields": cur, "updated_at": now_iso()}
            else: self.channels.pop(chan["id"], None)
            self._save(); self._apply_env()
        d = self.describe(chan["id"])
        if not cur: d["updated_at"] = now_iso()
        return d

    def delete(self, ch: str) -> dict:
        chan = resolve_channel(ch)
        with self._lock:
            self.channels.pop(chan["id"], None); self._save(); self._apply_env()
        d = self.describe(chan["id"]); d["deleted"] = True
        return d
