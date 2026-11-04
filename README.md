# yixing-finance

翊行二代户只读财务台账，外加同仓 FastAPI（`/api/v1`）。金额内部为分，界面默认显示元（两位小数）。界面无录入、打款、关账控件。

## How to open the UI

### A) GitHub Pages（免安装）

静态演示：<https://sungday.github.io/yixing-finance/>

路由：`/` 概览 · `/recharges/` 充值 · `/revenues/` 收入 · `/reconcile/` 对账。数据来自 `web/fixtures`（与 `?mock=1` 相同）。Pages 访问不到本机 `127.0.0.1:8787`。

发布：推到 `main` 后，[`.github/workflows/pages.yml`](.github/workflows/pages.yml) 在 `web/` 执行 `npm run build:pages`（`output: 'export'`，`basePath=/yixing-finance`）并部署。

**一次性开关**（Actions 不能替仓库改这项）：GitHub 仓库 **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**。保存后再推 `main`，或在 Actions 页重跑 “GitHub Pages”。

### B) 本机

```bash
cd web && npm i && npm run dev
```

打开 <http://localhost:3000>。默认 fixtures。

接本机 API：把 `web/.env.example` 复制为 `web/.env.local`，设置 `NEXT_PUBLIC_FINANCE_API_BASE=/api/v1`。`next dev` 把该路径反代到 `FINANCE_API_INTERNAL_BASE`（默认 `http://127.0.0.1:8787/api/v1`）。`?mock=1` 强制 fixtures，`?mock=error` 看错误态。不要提交 `.env.local`。

### C) Codespaces

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/sunGday/yixing-finance?quickstart=1)

容器创建时会 `npm ci --prefix web`（见 `.devcontainer/devcontainer.json`），并转发 3000。创建完成后：

```bash
cd web && npm run dev
```

Ports 面板打开 3000。需要 API 时同样使用 `.env.local`，并把 8787 指到本机进程。

前端说明：[`web/DESIGN.md`](web/DESIGN.md)、[`web/VISUAL.md`](web/VISUAL.md)、[`docs/IA.md`](docs/IA.md)。截图在 [`web/docs/screenshots/`](web/docs/screenshots/)。

## API（FastAPI · v0.3）

不启投、不写 Omni、不发穿山甲/优量汇真实 HTTP。密钥不入库。草案见 `API-DRAFT.md`。代码：`main.py`、`api/routes.py`、`adapters/`、`sources/omni_billhis.py`、`reconcile.py`。

```bash
pip install -r requirements.txt
FIN_API_TOKEN=devtoken uvicorn main:app --host 0.0.0.0 --port 8787
python3 -m unittest discover -s tests -t . -v
```

- Base URL：`http://127.0.0.1:8787/api/v1`。端点 `health` `recharges` `recharges/summary` `revenues` `reconcile/summaries` `costs`（stub）`snapshots`（stub）
- 鉴权：`Authorization: Bearer $FIN_API_TOKEN`。未设 env → 开发放行并回 `X-Auth-Mode: open-dev`。错或缺少 token → 401 `40101`
- CORS：`FIN_CORS_ORIGINS`（逗号分隔，默认 `*`，上线前收紧）
- 充值：只读 Omni billHis JSONL（自动搜 `../**/billHis-1001108443-*.jsonl`，或 `FIN_RECHARGE_JSONL`）
- 收入：无 `PANGLE_*` / `YLH_*` → `source:"mock"` + `gap_flags: credential_missing:*`。`?strict=true` 或 `FIN_REVENUE_MOCK=0` → 503 `50301`。mock 不进对账

## 已锁定口径

- 充值 `basis=omni_parent_in`：一代→二代入账 = 充值；平台直充 / 划拨 / 回收旁报
- `settlement_basis`：日常可切换预估/结算；关账以结算为准

## env 名（只列名，值放 env/.secrets，绝不入库）

`FIN_API_TOKEN`；`PANGLE_USER_ID` `PANGLE_ROLE_ID` `PANGLE_SECURE_KEY`；`YLH_MEMBER_ID` `YLH_SECRET`（别名 `GDT_MEMBER_ID` `GDT_SECRET`）；Omni 沿用既有 `oppo-omniapi` 配置。

穿山甲/优量汇 endpoint 与签名算法仍是待复核占位。
