import type { BalanceSnapshot, Cost, Recharge, ReconRow, Revenue } from "./types";
import { inRange, subOk, type Filters } from "./filters";

const kw = (f: Filters, ...vals: (string | null | undefined)[]) =>
  !f.q || vals.some((v) => v?.toLowerCase().includes(f.q.toLowerCase()));

const rank = { unmatched: 0, partial: 1, matched: 2 } as const;

export const sum = <T,>(xs: T[], k: (x: T) => number | null | undefined) =>
  xs.reduce((s, x) => s + (k(x) ?? 0), 0);

export function selectRecharges(rows: Recharge[], f: Filters) {
  return rows.filter((r) => inRange(r.biz_date, f) && subOk(r.to_owner_id, f) && kw(f, r.txn_id, r.sub_owner_name));
}
export function selectCosts(rows: Cost[], f: Filters) {
  return rows.filter((r) => inRange(r.stat_date, f) && subOk(r.owner_id, f));
}
export function selectSnapshots(rows: BalanceSnapshot[], f: Filters) {
  return rows.filter((r) => inRange(r.snapshot_time, f) && subOk(r.owner_id, f));
}
export function selectRevenues(rows: Revenue[], f: Filters) {
  return rows.filter((r) => inRange(r.stat_date, f) && (f.network === "all" || r.ad_network === f.network));
}
export function selectRecon(rows: ReconRow[], f: Filters) {
  return rows
    .filter((r) => inRange(r.biz_date, f) && (f.status === "all" || r.status === f.status) && kw(f, r.recon_id, r.scope))
    .filter((r) => f.subs.length === 0 || !r.scope.startsWith("owner:") || f.subs.includes(r.scope.slice(6)))
    .sort((a, b) => rank[a.status] - rank[b.status] || Math.abs(b.delta_fen ?? 0) - Math.abs(a.delta_fen ?? 0));
}

type Named = Recharge & { to_owner_name?: string | null };
export function normalizeRecharges(rows: Named[]): Recharge[] {
  return rows.map((r) => ({ ...r, sub_owner_name: r.sub_owner_name ?? r.to_owner_name ?? null }));
}

export function rangeParams(f: Filters): Record<string, string | undefined> {
  return { start_date: f.from, end_date: f.to, to_owner_id: f.subs.length === 1 ? f.subs[0] : undefined };
}

export function shiftDay(d: string, n: number) {
  const t = new Date(d + "T00:00:00Z");
  if (Number.isNaN(t.getTime())) return d;
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** 所选不足 7 日时，图轴向区间末日回看 7 日，避免单日柱孤悬。 */
export function chartDays(from: string, to: string) {
  const span = eachDay(from, to);
  if (span.length >= 7) return span;
  return eachDay(shiftDay(to, -6), to);
}

export function eachDay(from: string, to: string, cap = 62): string[] {
  const out: string[] = [];
  const t = new Date(from + "T00:00:00Z");
  if (Number.isNaN(t.getTime())) return out;
  for (let i = 0; i < cap; i++) {
    const d = t.toISOString().slice(0, 10);
    if (d > to) break;
    out.push(d);
    t.setUTCDate(t.getUTCDate() + 1);
  }
  return out;
}
