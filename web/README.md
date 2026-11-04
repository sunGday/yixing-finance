# 翊行财务 · 只读前端

打开方式以仓库根目录 README 为准。这里只记前端自己的两条路径。

## GitHub Pages = 演示 fixtures

<https://sungday.github.io/yixing-finance/>

`npm run build:pages` 设 `STATIC_EXPORT=1`，**不注入** `NEXT_PUBLIC_FINANCE_API_BASE`。导出的 HTML 是 `web/fixtures` 的数字。这个站点到不了 `127.0.0.1:8787`。

## 真数据 = 本机两步

`next dev` / `next start` 默认请求 `/api/v1`，由 Next 反代到 `http://127.0.0.1:8787/api/v1`。

```bash
# 仓库根目录，先起 mario
uvicorn main:app --host 127.0.0.1 --port 8787

# 再开页面
cd web && npm i && npm run dev
```

角标：`数据来源 · 真数据`。充值页切到「消耗」或「余额快照」时标 `真数据 · 消耗/快照样例`，这两块表仍是 fixtures。概览的消耗走 `/costs`。

- `?mock=1` 强制演示 fixtures。`?mock=error` 演示错误态。
- 改前缀或代理目标：复制 `.env.example` 为 `.env.local`。不要提交 `.env.local`。
- 筛选在 URL query：`quick from to subs fund network status unit q tab`。
- 字段见 `../docs/IA.md`。视觉见 `DESIGN.md`、`VISUAL.md`。
