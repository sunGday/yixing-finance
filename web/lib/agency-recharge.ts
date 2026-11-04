// 代理商充值 = omni_parent_in（一代→二代入账）。子户划出 transfer_out 不进这张表，也不进合计。
import type { Recharge } from "./types";

/** 一代户。与 store.py GEN1_PARENT_OWNER_ID 相同。 */
const GEN1_PARENT_OWNER_ID = "1000015399";

export const LIST_PAGE_CAP = 500;

export interface ParentInDay {
  biz_date: string;
  amount_fen: number;
  count: number;
}

export interface RechargeSummary {
  from: string;
  to: string;
  basis: string;
  total_amount_fen: number | null;
  count: number;
  items: ParentInDay[];
  gap_flags: string[];
  source: string | null;
}

export interface ParentMonth {
  period: string;
  amount_fen: number;
  count: number;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** 主口径行。有 side 时只认 omni_parent_in；没有 side 时按一代户 + billSub=300，借记不算。 */
export function isParentIn(row: {
  side?: string | null;
  bill_sub?: number | null;
  to_owner_id?: string | null;
  direction?: string | null;
}): boolean {
  if (row.side) return row.side === "omni_parent_in";
  return row.bill_sub === 300 && row.direction !== "debit" && String(row.to_owner_id ?? "") === GEN1_PARENT_OWNER_ID;
}

export function rechargeSummaryRequest(from: string, to: string) {
  return {
    path: "/recharges/summary",
    params: { start_date: from, end_date: to, granularity: "day" } as Record<string, string | undefined>,
  };
}

export function parentInListRequest(from: string, to: string) {
  return {
    path: "/recharges",
    params: { start_date: from, end_date: to, side: "omni_parent_in" } as Record<string, string | undefined>,
  };
}

/** 读总账。旁报 side_items 丢掉，不参与合计。total 缺失时才加总 items。 */
export function normalizeRechargeSummary(raw: unknown, from: string, to: string): RechargeSummary {
  if (!isObj(raw)) throw new Error("充值总账不是对象");
  const rows = Array.isArray(raw.items) ? raw.items : [];
  const items: ParentInDay[] = [];
  for (const row of rows) {
    if (!isObj(row) || typeof row.biz_date !== "string") continue;
    const amount = finite(row.amount_fen);
    const count = finite(row.count);
    if (amount == null) continue;
    items.push({ biz_date: row.biz_date, amount_fen: amount, count: count ?? 0 });
  }
  items.sort((a, b) => (a.biz_date < b.biz_date ? -1 : a.biz_date > b.biz_date ? 1 : 0));
  const declared = finite(raw.total_amount_fen);
  const flags = Array.isArray(raw.gap_flags) ? raw.gap_flags.filter((g): g is string => typeof g === "string") : [];
  return {
    from,
    to,
    basis: typeof raw.basis === "string" && raw.basis ? raw.basis : "omni_parent_in",
    total_amount_fen: declared ?? (items.length ? items.reduce((s, row) => s + row.amount_fen, 0) : null),
    count: items.reduce((s, row) => s + row.count, 0),
    items,
    gap_flags: flags,
    source: typeof raw.source === "string" ? raw.source : null,
  };
}

/** 空源的 0 不是「没充钱」。其它 0 是这个区间真的没有入账。 */
export function agencyTotal(summary: RechargeSummary): number | null {
  if (summary.gap_flags.includes("recharge_source_empty")) return null;
  return summary.total_amount_fen;
}

export function parentMonths(items: ParentInDay[]): ParentMonth[] {
  const bucket = new Map<string, ParentMonth>();
  for (const row of items) {
    const period = row.biz_date.slice(0, 7);
    const slot = bucket.get(period) ?? { period, amount_fen: 0, count: 0 };
    slot.amount_fen += row.amount_fen;
    slot.count += row.count;
    bucket.set(period, slot);
  }
  return [...bucket.values()].sort((a, b) => (a.period < b.period ? -1 : 1));
}

export function daySpan(from: string, to: string, cap = 400): string[] {
  const out: string[] = [];
  const t = new Date(`${from}T00:00:00Z`);
  if (Number.isNaN(t.getTime())) return out;
  for (let i = 0; i < cap; i++) {
    const day = t.toISOString().slice(0, 10);
    if (day > to) break;
    out.push(day);
    t.setUTCDate(t.getUTCDate() + 1);
  }
  return out;
}

/** 短区间补上没有入账的日子，柱高为 0。总账已经覆盖整段，缺的那天就是 0，不是缺口。 */
export function parentSeries(summary: RechargeSummary): { day: string; recharge: number }[] | null {
  const span = daySpan(summary.from, summary.to, 32);
  if (!span.length || span.length > 31 || (span.length === 31 && span[span.length - 1] < summary.to)) return null;
  const byDay = new Map(summary.items.map((row) => [row.biz_date, row.amount_fen]));
  return span.map((day) => ({ day, recharge: byDay.get(day) ?? 0 }));
}

export function matchesParentQuery(row: Recharge, q: string): boolean {
  if (!q) return true;
  const n = q.toLowerCase();
  return [row.txn_id, row.from_party, row.bill_desc, row.to_owner_name].some((v) => v?.toLowerCase().includes(n));
}

export function visibleParentRows(rows: Recharge[], from: string, to: string, q: string): Recharge[] {
  return rows.filter((row) => isParentIn(row) && row.biz_date >= from && row.biz_date <= to && matchesParentQuery(row, q));
}

/** 列表被 page_size 截断时，不能用列表加总冒充总账。 */
export function listTotal(rows: Recharge[], truncated: boolean): number | null {
  if (truncated) return null;
  return rows.filter((row) => row.status !== "reversed").reduce((s, row) => s + (row.direction === "debit" ? -row.amount_fen : row.amount_fen), 0);
}

export function fixtureParentSummary(rows: Recharge[], from: string, to: string): RechargeSummary {
  const kept = rows.filter((row) => isParentIn(row) && row.biz_date >= from && row.biz_date <= to && row.status !== "reversed");
  const items = parentDays(kept);
  const total = kept.reduce((s, row) => s + row.amount_fen, 0);
  return {
    from,
    to,
    basis: "omni_parent_in",
    total_amount_fen: kept.length ? total : 0,
    count: kept.length,
    items,
    gap_flags: [],
    source: "fixtures",
  };
}

function parentDays(rows: Recharge[]): ParentInDay[] {
  const bucket = new Map<string, ParentInDay>();
  for (const row of rows) {
    const slot = bucket.get(row.biz_date) ?? { biz_date: row.biz_date, amount_fen: 0, count: 0 };
    slot.amount_fen += row.amount_fen;
    slot.count += 1;
    bucket.set(row.biz_date, slot);
  }
  return [...bucket.values()].sort((a, b) => (a.biz_date < b.biz_date ? -1 : 1));
}

export function counterparty(row: Recharge): string {
  if (row.to_owner_id === GEN1_PARENT_OWNER_ID) return "一代户";
  return row.to_owner_name || row.sub_owner_name || "—";
}
