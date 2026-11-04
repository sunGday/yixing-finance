# yixing-finance

翊行二代户只读财务台账，外加同仓 FastAPI（`/api/v1`）。金额内部为分，界面默认显示元（两位小数）。界面无录入、打款、关账控件。

**Pages = fixtures。Live = Docker Compose on [yunrong.ink](https://yunrong.ink)**（Nginx Proxy Manager → `web:3000`，见 [`deploy/README.md`](deploy/README.md)）。浏览器只打 `/api/v1`；Bearer 由 Next BFF 注入，不进前端包。

## How to open the UI

两套数据，不要混：

| | 数据 | 打得到 `127.0.0.1:8787` 吗 |
|---|---|---|
| **GitHub Pages** | **fixtures 演示** | 不能 |
| **本机 / Codespaces** | **真数据**（默认） | 能，只要 mario 在 8787 |

页面角标写着 `数据来源 · 演示 fixtures` 或 `数据来源 · 真数据`。`?mock=1` 强制演示，`?mock=error` 看故障卡。

### A) GitHub Pages = 演示 fixtures

<https://sungday.github.io/yixing-finance/>

路由：`/` 概览 · `/recharges/` 充值 · `/revenues/` 收入 · `/reconcile/` 对账。数字来自 `web/fixtures`，和 `?mock=1` 同一条路径。Pages **到不了** 本机 `:8787`。

发布：推到 `main` 后，[`.github/workflows/pages.yml`](.github/workflows/pages.yml) 跑 `npm run build:pages`（`STATIC_EXPORT=1`，`output: 'export'`，`basePath=/yixing-finance`）。这个构建**不注入** `NEXT_PUBLIC_FINANCE_API_BASE`。

**一次性开关**（Actions 改不了这项）：**Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**。

### B) 真数据 = 本机两步

先起 mario，再开页面。`next dev` 默认把浏览器的 `/api/v1` 反代到 `http://127.0.0.1:8787/api/v1`，不用再配 `.env.local`。

```bash
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8787

cd web && npm i && npm run dev
```

打开 <http://localhost:3000>。角标应为「真数据」。8787 未启动时页面给出拉取失败，而不是悄悄退回样例。

要看演示数字：地址加 `?mock=1`。可选：复制 `web/.env.example` 为 `web/.env.local` 只为改前缀或代理目标。不要提交 `.env.local`。

### C) Codespaces（同样是真数据）

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/sunGday/yixing-finance?quickstart=1)

容器会 `npm ci --prefix web`（见 `.devcontainer/devcontainer.json`），并转发 3000 和 8787。创建完成后同样两步：先 `uvicorn main:app --host 127.0.0.1 --port 8787`，再 `cd web && npm run dev`。

前端说明：[`web/DESIGN.md`](web/DESIGN.md)、[`web/VISUAL.md`](web/VISUAL.md)、[`docs/IA.md`](docs/IA.md)。截图在 [`web/docs/screenshots/`](web/docs/screenshots/)。

## API（FastAPI · v0.3）

不启投、不写 Omni、不发穿山甲/优量汇真实 HTTP。密钥不入库。草案见 `API-DRAFT.md`。代码：`main.py`、`api/routes.py`、`adapters/`、`sources/omni_billhis.py`、`reconcile.py`。

```bash
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8787
python3 -m unittest discover -s tests -t . -v
```

- Base URL：`http://127.0.0.1:8787/api/v1`。端点 `health` `recharges` `recharges/summary` `revenues` `reconcile/summaries` `costs`（stub）`snapshots`（stub）
- 鉴权：`Authorization: Bearer $FIN_API_TOKEN`。未设 env → 开发放行并回 `X-Auth-Mode: open-dev`。错或缺少 token → 401 `40101`
- CORS：`FIN_CORS_ORIGINS`（逗号分隔，默认 `*`，上线前收紧）
- 充值：只读 Omni billHis JSONL（自动搜 `../**/billHis-1001108443-*.jsonl`，或 `FIN_RECHARGE_JSONL`）
- 收入：无 `PANGLE_*` / `YLH_*` → `source:"mock"` + `gap_flags: credential_missing:*`。`?strict=true` 或 `FIN_REVENUE_MOCK=0` → 503 `50301`。mock 不进对账
- 概览和充值页在真数据下仍用 fixtures 画消耗与余额快照（这两个接口是空 stub）

## 已锁定口径

- 充值 `basis=omni_parent_in`：一代→二代入账 = 充值；平台直充 / 划拨 / 回收旁报
- `settlement_basis`：日常可切换预估/结算；关账以结算为准

## env 名（只列名，值放 env/.secrets，绝不入库）

`FIN_API_TOKEN`；`PANGLE_USER_ID` `PANGLE_ROLE_ID` `PANGLE_SECURE_KEY`；`YLH_MEMBER_ID` `YLH_SECRET`（别名 `GDT_MEMBER_ID` `GDT_SECRET`）；Omni 沿用既有 `oppo-omniapi` 配置。

穿山甲/优量汇 endpoint 与签名算法仍是待复核占位。
