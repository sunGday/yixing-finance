# yixing-finance

翊行二代户只读财务台账：概览、充值流水、收入流水、对账汇总。金额内部为分，界面默认显示元（两位小数）。无录入、打款、关账控件。

## How to open the UI

### A) GitHub Pages（免安装）

静态演示：<https://sungday.github.io/yixing-finance/>

路由：`/` 概览 · `/recharges/` 充值 · `/revenues/` 收入 · `/reconcile/` 对账。数据来自 `web/fixtures`（与 `?mock=1` 相同）。Pages 访问不到内网 `127.0.0.1:8787`。

发布：推到 `main` 后，[`.github/workflows/pages.yml`](.github/workflows/pages.yml) 在 `web/` 执行 `npm run build:pages`（`output: 'export'`，`basePath=/yixing-finance`）并部署。

**一次性开关**（Actions 不能替仓库改这项）：GitHub 仓库 **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**。保存后再推 `main`，或在 Actions 页重跑 “GitHub Pages”。环境 `github-pages` 的页面 URL 即为上面的地址。

### B) 本机

```bash
cd web && npm i && npm run dev
```

打开 <http://localhost:3000>。默认 fixtures。

接本机 mario：把 `web/.env.example` 复制为 `web/.env.local`，设置 `NEXT_PUBLIC_FINANCE_API_BASE=/api/v1`。`next dev` 把该路径反代到 `FINANCE_API_INTERNAL_BASE`（默认 `http://127.0.0.1:8787/api/v1`）。`?mock=1` 强制 fixtures，`?mock=error` 看错误态。不要提交 `.env.local`。

### C) Codespaces

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/sunGday/yixing-finance?quickstart=1)

容器创建时会 `npm ci --prefix web`（见 `.devcontainer/devcontainer.json`），并转发 3000。创建完成后：

```bash
cd web && npm run dev
```

Ports 面板打开 3000。需要 mario 时同样使用 `.env.local`，并把 API 指到转发的 8787。

## 仓库里还有什么

- 可运行前端：[`web/`](web/)（Next.js 15 App Router，静态导出 + 本地反代）
- 视觉与信息架构：[`web/DESIGN.md`](web/DESIGN.md)、[`web/VISUAL.md`](web/VISUAL.md)、[`docs/IA.md`](docs/IA.md)、[`docs/RECON-UX.md`](docs/RECON-UX.md)
- 截图：[`web/docs/screenshots/`](web/docs/screenshots/)
