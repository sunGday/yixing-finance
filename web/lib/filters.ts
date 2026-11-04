import { AGENCY_OWNER_ID, type ReconStatus } from "./types";
import type { Unit } from "./format";

/** 全局筛选（holiday §8），全部存在 URL query */
export interface Filters {
  from: string; to: string; quick: string;
  agency: string; subs: string[];
  fund: "recharge" | "cost" | "snapshot" | "all";
  network: "pangle" | "ylh" | "all";
  status: ReconStatus | "all";
  unit: Unit; q: string; mock?: string;
}
export type SP = Record<string, string | string[] | undefined>;
// mock 基准日：fixtures 截止 2026-11-03；接 mario 后改为 new Date()（上海时区）
export const TODAY = "2026-11-04";
const addDays = (d: string, n: number) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
export function quickRange(q: string): [string, string] {
  const y = addDays(TODAY, -1);
  if (q === "7d") return [addDays(TODAY, -7), y];
  if (q === "week") { const w = new Date(TODAY + "T00:00:00Z").getUTCDay() || 7; return [addDays(TODAY, 1 - w), TODAY]; }
  if (q === "month") return [TODAY.slice(0, 8) + "01", TODAY];
  return [y, y];
}
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
export function parseFilters(sp: SP, defaults: Partial<Filters> = {}): Filters {
  const quick = one(sp.quick) || (one(sp.from) ? "custom" : defaults.quick ?? "yesterday");
  const [qf, qt] = quickRange(quick);
  return {
    quick, from: one(sp.from) || qf, to: one(sp.to) || qt,
    agency: AGENCY_OWNER_ID,
    subs: one(sp.subs) ? one(sp.subs).split(",") : [],
    fund: (one(sp.fund) || defaults.fund || "recharge") as Filters["fund"],
    network: (one(sp.network) || "all") as Filters["network"],
    status: (one(sp.status) || defaults.status || "all") as Filters["status"],
    unit: one(sp.unit) === "fen" ? "fen" : "yuan",
    q: one(sp.q), mock: one(sp.mock) || undefined,
  };
}
export const inRange = (d: string, f: Filters) => d.slice(0, 10) >= f.from && d.slice(0, 10) <= f.to;
export const subOk = (id: string, f: Filters) => f.subs.length === 0 || f.subs.includes(id);
