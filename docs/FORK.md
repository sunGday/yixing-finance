# 参考仓库评估与二改计划

可运行前端在仓库 `web/`（由早期 `app/` 脚手架迁入）。本文件只保留许可与范围记录。

调研于 2026-11-04（浅 clone 到 /tmp，未入 team）。  
**Allen ACK 2026-11-04 ~09:30**：已建议用户选 clean-room；**用户拍板前禁止抄 AI_ad_spend 任何代码**。可继续打磨 IA/线框与 Revenue-Recon 交互说明。认证等用户 / mario 契约后再定。

| 仓库 | 栈 | 许可 | 最近推送 | 覆盖 充值/收入/对账 | Web/移动 | 评估 |
|---|---|---|---|---|---|---|
| wade56754/AI_ad_spend | Next.js App Router + React19 + Tailwind3 + shadcn/ui + Recharts + Supabase；FastAPI | **无 LICENSE** | 2025-11-08 | finance/ledger、reconcile、analytics…；中文 | 响应式 Web | 栈近、中文、有对账路由；0 star、Supabase、录入为主、无分/元约定 |
| OpenMediationProject（OM-Dashboard-UI） | Vue；Java OM-ADC | LGPL-3.0 | 2022-12（停更） | 收入强，无充值/对账 | Web | 仅交互参考 |
| xfingerdev/adverse-dashboard | Expo / RN | GPL-3.0 | 2026-08 | 多网络收入，无充值/对账 | 原生 App | GPL 不宜二改；移动卡片可借鉴 |
| SpaceAd-ops/Revenue-Recon | Python Streamlit + SQLAlchemy + Plotly | **Apache-2.0** | 活跃原型 | 内外收入差异、阈值、看板 | Web | **模块参考合法**；规则可给 mario，交互见 `RECON-UX.md` |

## 选定（当前闸门）
- **结构灵感（非代码）**：AI_ad_spend 的路由划分（`/`、`/recharges`、`/revenues`、`/reconcile`）与 shadcn 密度——**仅文档级对照，零代码复制**。
- **默认路径：clean-room** — `create-next-app` + shadcn + Recharts 自建；token 用本目录 `DESIGN.md`；数据读 mario 样例 JSON（同 OPPO `sync-data`）。
- **许可例外**：仅当用户书面确认「已获作者授权或确认为我方仓库」后，才可评估是否 fork；在此之前任何 PR/拷贝视为违规。
- **合法可引用代码/算法**：Revenue-Recon（Apache-2.0）的差异计算思路与阈值分级——优先由 mario 移植服务层；前端只做展示与交互（见 `RECON-UX.md`）。

## 一期范围（只读）
路由：`/` · `/recharges` · `/revenues` · `/reconcile`（+ `recon_id` 抽屉）。  
砍：录入表单、实写、Supabase、投手 spend、settings。  
认证：TBD（等用户 / mario）。  
报表 `/reports/*`：二期。

## Allen 拍板 2026-11-04：clean-room，已开工脚手架
- 栈：Next.js 15 + shadcn/ui（base-nova）自写于 `app/`；**零** AI_ad_spend 代码、未 clone、无 Supabase（`rg -i 'ai_ad_spend|supabase' app --glob '!node_modules'` 为空）。
- Revenue-Recon 仅借鉴交互语义（见 RECON-UX.md），无 Streamlit 代码。
- 仍等 mario 10C 契约；数据为 mock fixtures。认证 TBD。
