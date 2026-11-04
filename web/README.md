# 翊行财务 · 只读前端

上级目录 README 有打开方式。本目录是 Next.js 15 应用。

```bash
npm i && npm run dev          # http://localhost:3000  fixtures
npm run build:pages           # out/  → GitHub Pages（basePath /yixing-finance）
```

- 未设置 `NEXT_PUBLIC_FINANCE_API_BASE`，或 URL 带 `?mock=1`：读 `fixtures/`。Pages 构建不注入该变量。
- `.env.local` 设置 `NEXT_PUBLIC_FINANCE_API_BASE=/api/v1` 后，浏览器请求由 `next dev` rewrite 到 `http://127.0.0.1:8787/api/v1`。消耗与余额快照仍用 fixtures（契约暂无路径）。
- `?mock=error` 演示错误态。筛选在 URL query：`quick from to subs fund network status unit q tab`。
- 字段与筛选见 `../docs/IA.md`。视觉决策见 `DESIGN.md`、`VISUAL.md`。
