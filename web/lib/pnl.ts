// 盈亏 = 收入 − 消耗。两边都有、而且消耗铺满同一区间，才出数。缺的留空，不用 0 去减。
import type { Cost } from "./types";

function daySpan(from: string, to: string, cap = 400): string[] {
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

export interface KnownCost {
  date: string;
  fen: number;
}

export interface CostWindow {
  from: string;
  to: string;
  total_fen: number | null;
  partial_fen: number | null;
  covered: number;
  expected: number;
  gap: string | null;
  known: KnownCost[];
}

export interface ProfitLoss {
  fen: number | null;
  text: string;
  tone: "success" | "danger" | undefined;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function finish(from: string, to: string, known: KnownCost[], incomplete: number, emptySource: boolean): CostWindow {
  const span = daySpan(from, to);
  const clipped = span.length === 400 && (span.at(-1) ?? "") < to;
  const inRange = known.filter((row) => row.date >= from && row.date <= to);
  const byDay = new Map<string, number>();
  for (const row of inRange) byDay.set(row.date, (byDay.get(row.date) ?? 0) + row.fen);
  const coveredDates = span.filter((day) => byDay.has(day));
  const partial = coveredDates.length ? coveredDates.reduce((s, day) => s + (byDay.get(day) ?? 0), 0) : null;
  const full = !clipped && !emptySource && incomplete === 0 && coveredDates.length === span.length && span.length > 0;
  let gap: string | null = null;
  if (!span.length) gap = "区间无效";
  else if (clipped) gap = "区间超过 400 天";
  else if (emptySource || coveredDates.length === 0) gap = "这个区间没有消耗";
  else if (!full) gap = `消耗只覆盖 ${coveredDates.length}/${span.length} 天${incomplete ? `，${incomplete} 天未完成` : ""}`;
  return {
    from,
    to,
    total_fen: full ? partial : null,
    partial_fen: full ? null : partial,
    covered: coveredDates.length,
    expected: span.length,
    gap,
    known: coveredDates.map((date) => ({ date, fen: byDay.get(date) ?? 0 })),
  };
}

/** 样例是按子户的行。同一天相加，没有行的日子不算 0。 */
export function normalizeFixtureCosts(rows: Cost[], from: string, to: string): CostWindow {
  const known: KnownCost[] = [];
  for (const row of rows) {
    if (!row.stat_date || typeof row.cost_fen !== "number") continue;
    known.push({ date: row.stat_date, fen: row.cost_fen });
  }
  return finish(from, to, known, 0, false);
}

/**
 * /costs 的 data。complete 为 false，或 cost_fen 为空，这一天不算。
 * partial_cost_fen 不采用。缺的日子不加 0。
 */
export function normalizeLiveCosts(raw: unknown, from: string, to: string): CostWindow {
  if (!isObj(raw) && !Array.isArray(raw)) throw new Error("消耗响应不是对象");
  const body = Array.isArray(raw) ? { items: raw, gap_flags: [] as string[] } : raw;
  const rows = Array.isArray(body.items) ? body.items : [];
  const flags = Array.isArray(body.gap_flags) ? body.gap_flags.filter((g): g is string => typeof g === "string") : [];
  const known: KnownCost[] = [];
  let incomplete = 0;
  for (const row of rows) {
    if (!isObj(row)) continue;
    const date = typeof row.biz_date === "string" ? row.biz_date : typeof row.stat_date === "string" ? row.stat_date : "";
    if (!date) continue;
    const amount = finite(row.cost_fen);
    const agency = "complete" in row || typeof row.biz_date === "string";
    if (agency) {
      if (row.complete === false || amount == null) incomplete += 1;
      else known.push({ date, fen: amount });
      continue;
    }
    if (amount != null) known.push({ date, fen: amount });
  }
  const emptySource = flags.includes("cost_source_empty") && known.length === 0;
  return finish(from, to, known, incomplete, emptySource);
}

export function sliceCostWindow(window: CostWindow, from: string, to: string): CostWindow {
  return finish(from, to, window.known, 0, false);
}

export function clipMonth(period: string, from: string, to: string): [string, string] | null {
  if (!/^\d{4}-\d{2}$/.test(period)) return null;
  const start = `${period}-01`;
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7));
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const endDate = new Date(`${next}T00:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  const end = endDate.toISOString().slice(0, 10);
  const a = start > from ? start : from;
  const b = end < to ? end : to;
  if (a > b) return null;
  return [a, b];
}

/** 只采用与当前筛选同一区间的一份。换区间时丢掉上一份，避免旧数字留在新日期下面。 */
export function forRequestedRange<T extends { from: string | null; to: string | null }>(
  data: T | undefined,
  from: string,
  to: string,
): T | undefined {
  if (!data || data.from !== from || data.to !== to) return undefined;
  return data;
}

/** 铺满用 total；没铺满用 partial，并标成部分。没有数就留空，不用 0。 */
export function shownCost(cost: CostWindow): { fen: number | null; partial: boolean } {
  if (cost.total_fen != null) return { fen: cost.total_fen, partial: false };
  if (cost.partial_fen != null) return { fen: cost.partial_fen, partial: true };
  return { fen: null, partial: false };
}

export function incomeBasis(months: { basis: string }[], fallback: string): string {
  const kinds = new Set(months.map((month) => month.basis));
  if (kinds.size > 1) return "预估与结算";
  if (kinds.has("settlement")) return "结算";
  if (kinds.has("estimate")) return "预估";
  if (fallback === "settlement") return "结算";
  if (fallback === "estimate" || fallback === "auto") return fallback === "auto" ? "自动" : "预估";
  return fallback || "—";
}

function describe(fen: number, extra?: string): ProfitLoss {
  const base = fen > 0 ? "赚了" : fen < 0 ? "亏了" : "持平";
  const text = extra ? `${base} · ${extra}` : base;
  if (fen > 0) return { fen, text, tone: "success" };
  if (fen < 0) return { fen, text, tone: "danger" };
  return { fen, text, tone: undefined };
}

/**
 * 消耗没铺满时，只用「整段都被消耗盖住」的月份：
 * 该月在查询区间里的收入 − 这些天的消耗。盖不住的月份不拿全年收入去减。
 */
function coveredMonthPnl(
  months: { period: string; amount_fen: number | null }[],
  cost: CostWindow,
): { fen: number; days: number } | null {
  let income = 0;
  let spend = 0;
  let days = 0;
  let any = false;
  for (const month of months) {
    const clip = clipMonth(month.period, cost.from, cost.to);
    if (!clip || month.amount_fen == null) continue;
    const slice = sliceCostWindow(cost, clip[0], clip[1]);
    if (slice.total_fen == null) continue;
    income += month.amount_fen;
    spend += slice.total_fen;
    days += slice.expected;
    any = true;
  }
  return any ? { fen: income - spend, days } : null;
}

export function profitAndLoss(
  revenue: {
    total_fen: number | null;
    from: string | null;
    to: string | null;
    by_month?: { period: string; amount_fen: number | null }[];
  } | null,
  cost: CostWindow | null,
): ProfitLoss {
  if (!revenue || !cost) return { fen: null, text: "收入或消耗还没到", tone: undefined };
  if (!revenue.from || !revenue.to || revenue.from !== cost.from || revenue.to !== cost.to) {
    return { fen: null, text: "区间还没对齐", tone: undefined };
  }
  if (revenue.total_fen == null) return { fen: null, text: "收入没有数", tone: undefined };
  if (cost.total_fen != null) return describe(revenue.total_fen - cost.total_fen);
  const covered = coveredMonthPnl(revenue.by_month ?? [], cost);
  if (covered) return describe(covered.fen, `已覆盖 ${covered.days} 天`);
  const cover = cost.expected ? `消耗覆盖 ${cost.covered}/${cost.expected} 天` : "消耗没有铺满";
  return { fen: null, text: cover, tone: undefined };
}
