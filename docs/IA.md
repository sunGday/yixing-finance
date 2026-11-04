# 信息架构 · 翊行二代户财务系统

字段真源：`holiday-finance/reports/2026-11-04-yixing-finance-fields.md`（下称「真源」）。UI 标签中文，括号内为真源英文字段名。金额存 `*_fen`（整数分），默认展示元（÷100，2 位小数），可切「分」（§8 金额单位显示）。时区 Asia/Shanghai。

## 1. 用户目标
- 财务：某日/某段时间翊行及各子户 **充了多少、扣了多少、余额是否勾稽**；穿山甲/优量汇 **收了多少**；**哪里对不上、差多少**。
- 运营：手机上早上 10 秒看昨日 KPI + 异常（unmatched / partial）。
- 主操作 = 查看 / 筛选 / 下钻 / 导出 CSV（含 `amount_yuan` 派生列）。**阶段 1 无写操作**（补录/调整 §9 留到二期，且须确认流程）。

## 2. 站点地图
```
财务系统（代理商：翊行二代户 1001108443，只读锁定）
├── 概览            /            （日报 KPI 汇总，入口页，非 §8 三关键页之一）
├── ① 充值流水      /recharges    （真源 §3，API 10C /recharges）
├── ② 收入流水      /revenues     （真源 §5，API 10C /revenues）
├── ③ 对账汇总      /reconcile    （真源 §6，API 10C /reconcile/summaries）
│     └── 差异明细抽屉 /reconcile/:recon_id
└── 报表（二期）    /reports/{day|week|month}  （真源 §7；月报「待用户确认」区）
```
- 消耗（§4）不单独成页：作为充值流水「资金类型=消耗」与对账汇总的右侧口径出现。
- Web：左侧栏（概览/充值/收入/对账/报表）+ 顶部全局筛选条（吸顶）。
- 移动：底栏 4 项（概览 / 充值 / 收入 / 对账）；筛选收进顶部「筛选」底部弹层，已选条件以 chip 显示。

## 3. 全局筛选（真源 §8，原样）
| 筛选项（中文） | 绑定字段 | Web | App | 级别 | 出现页 |
|---|---|---|---|---|---|
| 日期范围（日） | `biz_date` / `stat_date` | ✓ | ✓ | 必填，默认「昨天」 | 全部 |
| 快捷：昨日/近7日/本周/本月 | 派生 | ✓ | ✓ | 必填 | 全部 |
| 代理商 | `agency_owner_id` | ✓ | ✓ | 必填，只读锁定翊行 | 全部 |
| 子客户（多选+全选） | `sub_owner_id` / `to_owner_id` / `owner_id` | ✓ | ✓ | 必填 | 概览/充值/对账 |
| 资金类型 充值/消耗/余额快照/全部 | 充值§3 / 消耗§4 / 快照§6.1 | ✓ | ✓ | 必填 | 充值流水 |
| 收入网络 穿山甲/优量汇/全部 | `ad_network` pangle/ylh | ✓ | ✓ | 必填（收入页） | 收入/概览 |
| 对账状态 | `status` matched/partial/unmatched | ✓ | 可选 | 必填（对账页） | 对账 |
| 金额单位显示 元/分 | `amount_unit` | ✓ | 可选 | 可选，默认元 | 全部 |
| 计划/组/创意（高级，默认折叠） | `plan_id`/`ad_group_id`/`ad_id` | ✓ | — | 可选 | 充值（消耗视图） |
| 关键词（子户名 / txn_id） | `sub_owner_name` / `txn_id` | ✓ | ✓ | 可选 | 充值/对账 |

筛选条件写入 URL query，可分享、刷新保留。

## 4. 关键页

### 0 概览 `/`
- 目的：一屏看昨日（或所选区间）资金与收入全貌 + 异常入口。
- 主指标（§7 日报）：充值合计 Σ`amount_fen`(credit) · 消耗合计 Σ`cost_fen` · 期末余额 Σ`total_balance_fen` · 收入合计 Σ`amount_fen`（分 `ad_network`）· 日差额 Σ`delta_fen` · 未匹配笔数。
- 次级：毛利草稿 `Σ INC-AD-NET − Σ EXP-ADS-OMNI`，固定标「非关账口径」（§11.4 待确认是否可见，默认折叠）。
- 图：近 7/30 日 充值 vs 消耗 柱线；收入按网络堆叠。
- 主操作：点 KPI 跳对应页并带筛选；点「未匹配 N 笔」→ 对账页 status=unmatched。

### ① 充值流水 `/recharges`
- 目的：按 **时间 + 金额** 统计代理商充值（需求原文）。
- 主指标：区间充值合计、笔数、扣回合计（`direction=debit`）、按 `biz_date` 日桶柱图（小时粒度 `txn_time` 预留，默认隐藏）。
- 表列：充值时间 `txn_time` · 业务日 `biz_date` · 流水号 `txn_id`(mono) · 入账子户 `to_owner_id`+名称 · 金额 `amount_fen`（右对齐，debit 前缀 −）· 方向 `direction` · 渠道 `channel` · 出资方 `from_party` · 充值后余额 `balance_after_fen` · 状态 `status` raw/posted/reversed · 证据 `request_id`/`evidence_path`。
- 资金类型=消耗：切换为 §4 表（`stat_date`、`owner_id`、`cost_fen`、`cash_cost_fen`、`grant_cost_fen`、`source_api`）；=余额快照：§6.1 表（`snapshot_time`、`owner_id`、`total_balance_fen`、`cash_bal_fen`、`today_total_cost_fen`）。
- 合计行吸底（OPPO 台经验）。`MANUAL-` 前缀流水号显示「人工」chip；`reversed` 行删除线 + 显示 `reversal_of`/`reversed_by` 链接。
- 主操作：导出 CSV；行展开看证据。

### ② 收入流水 `/revenues`
- 目的：穿山甲/优量汇日收入，预估 vs 结算。
- 主指标：净收入合计 `amount_fen`、毛收 `gross_amount_fen`、平台费 `fee_fen`（均可空则「—」）、各网络占比；结算进度（estimated/settled/paid 笔数与金额）。
- 口径切换：预估 / 结算（§11.2 未决，默认显示全部 + chip 标 `settlement_status`；关账用结算）。
- 表列：归属日 `stat_date` · 网络 `ad_network` · 收入 ID `revenue_id`(mono) · 应用 `app_id` · 广告位 `placement_id`/`ad_unit_id` · 净收入 `amount_fen` · 毛收 · 平台费 · 结算状态 `settlement_status` · 到账日 `paid_date` · 批次 `evidence_ref`。
- 主操作：按网络/应用分组切换；导出。

### ③ 对账汇总 `/reconcile`
- 目的：日差额 + 未匹配列表；**不强平**。
- 主指标：未匹配笔数 / 部分匹配笔数 / 差额合计 `delta_fen` / 匹配率。
- 分区 Tab：资金等式（§6.1：Δ余额 vs Σ充值−Σ消耗±Σ调整）· 代理商日汇总（子户加总 vs 代理商层）· 收入去重/预估vs结算（§6.2）· 跨源观察（§6.3，标「仅观察」）。
- 表列（§6 结果行）：对账 ID `recon_id` · 业务日 `biz_date` · 范围 `scope` · 左侧 `left_fen` · 右侧 `right_fen` · 差额 `delta_fen`（≠0 着色）· 状态 `status` · 说明 `note` · 证据 `evidence_paths[]`。
- 默认排序：unmatched → partial → matched，再按 |delta| 降序。
- 详情抽屉：左右两侧构成明细（列出参与的 txn_id / 消耗行 / 快照）、partial 原因（如缺期初快照）。
- 主操作：查看 / 导出；「调整分录」二期才有（§9，需确认）。

## 5. 状态（每页）
| 态 | 表现 |
|---|---|
| 加载 | KPI 卡与表 skeleton；筛选条可用 |
| 空（无数据） | 说明原因：所选日期无充值 / 该网络未接入（阶段 1 先接 1 家，§10）/ 子户未同步 |
| 部分 | 某源失败或缺快照：顶部 warning 条「优量汇数据未拉取，合计不含该网络」，对应 KPI 标「部分」 |
| 错误 | 「拉取 /recharges 失败：<原因>，request_id: xxx。请稍后重试」+ 重试按钮（仅错误态显示） |
| 成功 | 正常；数据更新时间 + 来源标签（OMNI/PANGLE/YLH/MANUAL） |

## 6. Web vs 移动
| | Web | 移动 |
|---|---|---|
| 首屏 | 筛选条 + KPI 行 + 图 + 表 | KPI 2×3 卡 + 异常卡（未匹配 N 笔、差额） |
| 详表 | 全列表格，吸顶表头、吸底合计 | 卡片列表（时间/子户/金额/状态 4 要素），点开看全字段；宽表横滑带提示 |
| 筛选 | 全部 §8 项 | 日期/快捷、子客户、资金类型、收入网络；对账状态与单位放「更多」 |
| 高级（计划/组/创意） | 折叠面板 | 不提供 |
| 导出 | CSV | 不提供（二期可「发到邮箱」） |
实现建议：同一 Next.js 响应式 Web（<768px 切卡片 + 底栏），PWA 可装桌面；不单独做原生 App（阶段 1）。
