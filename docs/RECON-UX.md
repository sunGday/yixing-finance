# 对账交互说明 · 借鉴 Revenue-Recon（Apache-2.0）

来源：https://github.com/SpaceAd-ops/Revenue-Recon-Ad-Discrepancy-Monitor  
许可可合法参考；**不**引入 Streamlit UI，只移植交互与分级语义到我们的 `/reconcile`（字段以 holiday §6 为准）。

## 1. 可借鉴的产品模式
| Revenue-Recon | 我们阶段 1 映射 |
|---|---|
| 双源 ingest → merge on Date | mario 产出已对好的 `reconcile/summaries`；UI 只读，不做 CSV 上传一期 |
| `discrepancy_*` 百分比 + 绝对差额 | 展示 `left_fen` / `right_fen` / `delta_fen`（分→元）；百分比作次要列 |
| 全局 `DISCREPANCY_THRESHOLD` 高亮 | 阈值：`status=unmatched` 或 `|delta_fen|` 超阈值（默认 **0 分**，holiday §6.1；可配置「观察阈值」元） |
| KPI：平均差异、收入缺口、点数 | KPI：未匹配笔数 · partial 笔数 · `Σ|delta_fen|` · 匹配率 |
| 趋势图 + 并列收入柱 | 可选：近 7/30 日 `delta_fen` 折线；首屏可折叠，移动默认藏图 |
| 表条件格式 | `StatusChip`：matched 绿 / partial 黄 / unmatched 红；超阈行浅底 |
| inner join 丢单边日 | **禁止照搬**：缺一侧须落 `partial`/`unmatched` + note（如缺 `snapshot_time`），不能静默丢行 |

## 2. `/reconcile` 交互细则
1. **默认筛选**：对账状态 = `unmatched`（可一键「全部」）；排序 `unmatched → partial → matched`，组内 `|delta_fen|` 降序。
2. **四 Tab**（holiday §6）：资金等式 · 代理商日汇总 · 收入去重/预估vs结算 · 跨源观察（标「仅观察·非关账」）。
3. **行点击**：右侧抽屉（移动全屏 sheet）展示：`recon_id`、构成明细、`evidence_paths[]`、`request_id`（若有）、partial 原因文案。
4. **无写**：不做「Run Reconciliation」按钮（对账由 mario 批任务）；无调整分录提交（二期 + MANUAL）。
5. **空态**：无差异 →「所选范围全部 matched」；无数据 → 说明等 10B/10C；错误 → 路径 + 重新加载（仅错误态）。

## 3. 给 mario 的最小结果行（与 holiday 一致）
`recon_id`, `biz_date`, `scope`, `left_fen`, `right_fen`, `delta_fen`, `status` (`matched`|`partial`|`unmatched`), `note`, `evidence_paths[]`  
可选：`discrepancy_pct` 供图表，不替代分差额。

## 4. 明确不抄的
- Streamlit / Plotly 具体代码与布局像素  
- 仅 Date inner-join 丢行行为  
- Demo Partner 占位逻辑  
