# 翊行二代户财务系统 API 草案 · REQ-20261104-10C（**v0.2 草案**，2026-11-04）
字段真源：`holiday-finance/reports/2026-11-04-yixing-finance-fields.md` §3 充值 / §5 收入 / §6 对账 / §10。
金额一律 **int 分**；时间 Asia/Shanghai；**未 push，未建远程仓库**（等 Allen 确认）。充值主口径**已锁定** `basis=omni_parent_in`（别名 `gen1_transfer_in`）（user_locked，2026-11-04）；`settlement_basis: user_locked`（关账以结算）。

## 0. 通用
- 前缀 `/api/v1`；鉴权占位 `Authorization: Bearer <internal-token>`（token 走 env `FIN_API_TOKEN`，不入库）；角色占位 `viewer|operator|admin`，写接口需 operator+。
- 响应包：`{"code":0,"msg":"ok","request_id":"fin-…","data":{…}}`；列表 `data={"items":[],"page":1,"page_size":50,"total":0}`。
- 日期参数 `YYYY-MM-DD`（上海日历日，闭区间）；`page_size` ≤ 500。

### 错误码
| code | HTTP | 含义 |
|---|---|---|
| 0 | 200 | ok |
| 40001 | 400 | 参数错误（日期/枚举/金额非 int） |
| 40002 | 400 | 枚举非法（如 ad_network 不在 pangle\|ylh，gdt 自动映射 ylh 不报错） |
| 40101 | 401 | 未鉴权 |
| 40301 | 403 | 无权限（写接口） |
| 40401 | 404 | 资源不存在 |
| 40901 | 409 | txn_id / revenue_id 冲突 |
| 42201 | 422 | 业务校验失败（MANUAL 缺 evidence_path / note） |
| 50201 | 502 | 上游失败（Omni/Pangle/YLH，`data.upstream_request_id` 透传） |
| 50301 | 503 | 上游限流 / 凭证缺失（`CredentialMissingError`） |

## 1. 充值流水（§3）
### 字段
| 字段 | 必填 | 说明 |
|---|---|---|
| txn_id | 必 | Omni seqNo；无则 `OMNI-H-<hash>`；人工 `MANUAL-…` |
| txn_time | 必 | `YYYY-MM-DD HH:MM:SS` 上海 |
| biz_date | 必 | 派生 |
| amount_fen | 必 | int >0 |
| direction | 必 | credit\|debit（统一用 direction，金额恒正） |
| to_owner_id | 必 | 缺则不得 matched |
| status | 必 | raw\|posted\|reversed |
| from_party, channel(omni_recharge\|omni_transfer\|bank\|other), balance_after_fen, request_id, evidence_path, posted_ledger_id | 可 | |
| agency_owner_id, hour, bill_sub, bill_desc | 扩展 | 默认 agency `1001108443`；原值保留 |

### `GET /api/v1/recharges?start_date=2026-11-01&end_date=2026-11-03&to_owner_id=&channel=&direction=&page=1&page_size=50`
```json
{"code":0,"msg":"ok","request_id":"fin-7f3a","data":{"page":1,"page_size":50,"total":1,"items":[
 {"txn_id":"S1","txn_time":"2026-11-03 14:05:00","biz_date":"2026-11-03","hour":14,"amount_fen":2000000,
  "direction":"credit","from_party":null,"to_owner_id":"123","agency_owner_id":"1001108443","channel":"omni_transfer",
  "balance_after_fen":null,"request_id":"omni-rid-1","evidence_path":null,"posted_ledger_id":null,"status":"raw",
  "bill_sub":300,"bill_desc":"…"}]}}
```
### `GET /api/v1/recharges/summary?start_date&end_date&granularity=day|hour&group_by=to_owner_id&channel=`
```json
{"code":0,"request_id":"fin-…","data":{"granularity":"day","basis":"omni_parent_in","basis_alias":"gen1_transfer_in","basis_status":"user_locked","settlement_basis":"user_locked","items":[
 {"biz_date":"2026-11-03","hour":null,"to_owner_id":null,"channel":"omni_transfer","amount_fen":2000000,"count":1}],
 "gap_flags":[]}}
```
`basis` 锁死 `omni_parent_in`：一代→二代入账（billSub=300、存入、对端一代户 1000015399）= 充值，`amount_fen` 合计只含此项。
旁报维度（`side=platform_direct|transfer_out|reclaim_in`，不并入主合计）：平台直充 billSub=100、二代→子户划拨、子户划回回收。
结算（**user_locked**）：日常 `/revenues`、`/reconcile/summaries` 可传 `settlement_status=estimated|settled`；**关账路径强制 settled**。

> 仓库：将迁独立 GitHub 仓 `sunGday/yixing-finance`（Allen 建空仓后发 URL 再 push）；当前禁止 push / 建远程。
### `POST /api/v1/recharges/sync`
请求 `{"start_date":"2026-11-01","end_date":"2026-11-03","dry_run":false}` → 只读拉 Omni billHis，按 txn_id upsert：
```json
{"code":0,"data":{"fetched":12,"inserted":10,"updated":2,"pages":[{"page":1,"request_id":"omni-rid-1","itemCount":12}]}}
```
### `POST /api/v1/recharges`（MANUAL 补录，§9）
请求 `{"txn_time":"2026-11-03 10:00:00","amount_fen":100000,"to_owner_id":"123","note":"银行回单","evidence_path":"receipts/2026-11-03-1.pdf","operator":"holiday"}`
→ `{"code":0,"data":{"txn_id":"MANUAL-20261103-0001","status":"raw"}}`；缺 note/evidence_path → 42201。

## 2. 广告收入流水（§5）
### v0.1 → v0.2 映射（以真源为准）
| v0.1 | v0.2（§5） |
|---|---|
| revenue_fen | **amount_fen**（净收入，主金额） |
| biz_date | **stat_date** |
| ad_network=gdt | **ylh**（gdt 仅作入参/注册别名，存储一律 ylh） |
| status estimated\|final | **settlement_status** estimated\|settled\|paid |
| source_request_id | evidence_ref |
| — | 新增 gross_amount_fen / fee_fen / stat_hour / ad_unit_id / site_id / bundle_id / country / paid_date |

### 字段
必填：revenue_id、ad_network(pangle\|ylh)、stat_date、amount_fen。可选：stat_hour、gross_amount_fen、fee_fen(=毛−净，提供毛时派生)、app_id、placement_id、ad_unit_id、site_id、bundle_id、country(默认 CN)、settlement_status、paid_date、evidence_ref；报表附加 impressions/clicks/ecpm_fen。

### `GET /api/v1/revenues?start_date&end_date&ad_network=pangle|ylh&app_id&placement_id&settlement_status&granularity=day`
```json
{"code":0,"request_id":"fin-…","data":{"page":1,"page_size":50,"total":1,"items":[
 {"revenue_id":"pangle-1a2b3c4d5e6f7a8b","ad_network":"pangle","stat_date":"2026-11-03","stat_hour":null,
  "amount_fen":12345,"gross_amount_fen":null,"fee_fen":null,"app_id":"5","placement_id":"9","ad_unit_id":null,
  "country":"CN","settlement_status":"estimated","paid_date":null,"evidence_ref":"pangle-batch-…",
  "impressions":1000,"clicks":7,"ecpm_fen":120}]}}
```
### `POST /api/v1/revenues/sync`
请求 `{"ad_network":"pangle","start_date":"2026-11-03","end_date":"2026-11-03","dry_run":true}`；v0.2 骨架 **dry_run 只返回拼装请求**（`verified:false`），不发真实 HTTP；凭证缺失 → 50301 `missing env: PANGLE_…`。
同步策略（草案）：每日 10:00 拉 T-1 estimated，T+3 覆盖；结算确认走 MANUAL（§9）置 settled/paid。

## 3. 对账汇总（§6）
### `GET /api/v1/reconcile/summaries?start_date&end_date&granularity=day|week|month&to_owner_id&status=matched|partial|unmatched`
```json
{"code":0,"data":{"items":[
 {"recon_id":"fund-2026-11-03-123","biz_date":"2026-11-03","scope":"owner:123","kind":"daily_fund_equation",
  "left_fen":50,"right_fen":50,"delta_fen":0,"status":"matched","gap_flags":[],"note":"","evidence_paths":[]},
 {"recon_id":"gp-2026-11-03","biz_date":"2026-11-03","scope":"agency:1001108443","kind":"gross_profit_draft",
  "revenue_net_fen":null,"cost_fen":300,"gross_profit_draft_fen":null,"label":"非关账",
  "gap_flags":["revenue_missing:ylh"],"status":"partial"}]}}
```
- 日资金等式：`left=期末−期初`，`right=Σ充值−Σ消耗±Σ调整`，`delta=left−right`；容差 0 分。任一侧缺数 → `partial`（全缺 `unmatched`），`delta_fen=null` + gap_flags（`open_balance_missing` / `close_balance_missing` / `recharge_missing` / `cost_missing`），**禁止静默 0**。
- 单笔唯一性：`agency_owner_id+txn_id` 重复 → `gap_flags:["duplicate_txn"]`。
- 收入去重：`ad_network+stat_date+revenue_id`。
- 毛利草稿：`Σ净收入 − Σ Omni 消耗`，固定 `label:"非关账"`；任一网络缺 → `revenue_missing:<net>` 且毛利 null。
### `POST /api/v1/reconcile/summaries/rebuild`
`{"start_date":"2026-11-01","end_date":"2026-11-03"}` → `{"code":0,"data":{"rebuilt":3,"partial":1,"unmatched":0}}`

## 4. 收入适配器（代码：`adapters/`）
- `get_adapter("pangle"|"ylh"|"gdt")`；`build_request()` 仅 dry-run（`verified:false`）；`fetch()` 抛 NotImplementedError。
- **穿山甲**：URL / 参数 / md5 签名 均 **待复核**（未经官方文档核实）。env `PANGLE_USER_ID` `PANGLE_ROLE_ID` `PANGLE_SECURE_KEY`。
- **优量汇**：URL `api.adnet.qq.com/...` / token 算法 **待复核**。env `YLH_MEMBER_ID` `YLH_SECRET`（兼容 `GDT_*`）。
- 充值源：`sources/omni_billhis.py` 复用 `oppo_omni.finance.to_txn`，只读。
- 参考：OpenMediation OM-ADC、Revenue-Recon（仅借鉴公开设计）。
