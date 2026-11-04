// 字段名对齐 holiday-finance/reports/2026-11-04-yixing-finance-fields.md §3–§6（英文），UI 标签中文。
// 金额一律整数分 *_fen。
export type Source = "OMNI" | "PANGLE" | "YLH" | "MANUAL";

/** §3 充值流水 */
export interface Recharge {
  txn_id: string; txn_time: string; biz_date: string;
  amount_fen: number; direction: "credit" | "debit";
  from_party?: string | null; to_owner_id: string; sub_owner_name?: string | null;
  channel?: "omni_recharge" | "omni_transfer" | "bank" | "other" | null;
  balance_after_fen?: number | null; request_id?: string | null; evidence_path?: string | null;
  posted_ledger_id?: string | null; status: "raw" | "posted" | "reversed";
  reversal_of?: string | null; reversed_by?: string | null;
  side?: "omni_parent_in" | "platform_direct" | "transfer_out" | "reclaim_in" | null;
  bill_sub?: number | null; bill_desc?: string | null; to_owner_name?: string | null;
}
/** §4 消耗 */
export interface Cost {
  stat_date: string; stat_hour?: number | null; owner_id: string;
  plan_id?: string | null; ad_group_id?: string | null; ad_id?: string | null;
  cost_fen: number; cash_cost_fen?: number | null; grant_cost_fen?: number | null;
  source_api?: string | null; request_id?: string | null;
}
/** §6.1 余额快照 */
export interface BalanceSnapshot {
  snapshot_time: string; owner_id: string; total_balance_fen: number;
  cash_bal_fen?: number | null; today_total_cost_fen?: number | null;
}
/** GroMore 收益报表网络。明细接口仍只接受 pangle|ylh。 */
export type AdNetwork = "pangle" | "ylh" | "kuaishou" | "gm_adx";
/** §5 收入流水 */
export interface Revenue {
  revenue_id: string; ad_network: AdNetwork; stat_date: string; stat_hour?: number | null;
  amount_fen: number; gross_amount_fen?: number | null; fee_fen?: number | null;
  app_id?: string | null; placement_id?: string | null; ad_unit_id?: string | null;
  settlement_status?: "estimated" | "settled" | "paid" | null; paid_date?: string | null; evidence_ref?: string | null;
}
/** §6 对账结果行 — 对齐 API-DRAFT.md §3（commit 717c426）GET /api/v1/reconcile/summaries */
export type ReconStatus = "matched" | "partial" | "unmatched";
export type ReconTab = "fund_equation" | "agency_daily" | "revenue_dedup" | "cross_source";
/** 消耗/扣回用负分；amount_fen 可 null，UI 显示「—」禁静默 0 */
export interface ReconComponent { label: string; ref: string; amount_fen: number | null }
export interface ReconRow {
  recon_id: string; biz_date: string; scope: string; tab: ReconTab;
  left_fen: number | null; right_fen: number | null; delta_fen: number | null;
  status: ReconStatus; note?: string | null; evidence_paths: string[];
  components?: ReconComponent[];
  /** 工程旁报，UI 可并入 note */
  gap_flags?: string[];
}
/** 通用响应包（接真 API 时用）；鉴权 Authorization: Bearer <FIN_API_TOKEN> 仅占位 */
export interface ApiEnvelope<T> { code: number; msg: string; request_id: string; data: T }
export interface ApiList<T> { items: T[]; page: number; page_size: number; total: number }
export interface SubOwner { sub_owner_id: string; sub_owner_name: string }

export const AGENCY_OWNER_ID = "1001108443";
export const CHANNEL: Record<string, string> = {
  omni_recharge: "Omni充值",
  omni_transfer: "Omni划转",
  bank: "银行",
  other: "其他",
};
export const LABEL = {
  network: { pangle: "穿山甲", ylh: "优量汇", kuaishou: "快手", gm_adx: "gm_adx" },
  direction: { credit: "充值", debit: "扣回" },
  recon: { matched: "已匹配", partial: "部分匹配", unmatched: "未匹配" },
  rstatus: { raw: "原始", posted: "已过账", reversed: "已冲正" },
  settle: { estimated: "预估", settled: "已结算", paid: "已到账" },
  tab: { fund_equation: "资金等式", agency_daily: "代理商日汇总", revenue_dedup: "收入去重/预估vs结算", cross_source: "跨源观察" },
} as const;
