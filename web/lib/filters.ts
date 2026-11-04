import { AGENCY_OWNER_ID, type AdNetwork, type ReconStatus } from "./types";
import type { Unit } from "./format";
import { quickRange } from "./range";

export { quickRange } from "./range";

export type RevenueBasis = "auto" | "estimate" | "settlement";

/** 全局筛选（holiday §8），全部存在 URL query */
export interface Filters {
  from: string; to: string; quick: string;
  agency: string; subs: string[];
  fund: "recharge" | "cost" | "snapshot" | "all";
  network: AdNetwork | "all";
  basis: RevenueBasis;
  status: ReconStatus | "all";
  unit: Unit; q: string; mock?: string;
}
export type SP = Record<string, string | string[] | undefined>;
// mock 基准日：fixtures 截止 2026-11-03；接 mario 后改为 new Date()（上海时区）
export const TODAY = "2026-11-04";
/** 收入页默认：本年截止到昨天，口径预估（GroMore 分网络，不把整月结算单换成总额）。 */
export const revenueDefaults: Partial<Filters> = { quick: "year", basis: "estimate" };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const NETWORKS = ["pangle", "ylh", "kuaishou", "gm_adx"] as const;
function parseNetwork(v: string): Filters["network"] {
  return (NETWORKS as readonly string[]).includes(v) ? (v as Filters["network"]) : "all";
}
function parseBasis(v: string): Filters["basis"] {
  return v === "estimate" || v === "settlement" ? v : "auto";
}
export function parseFilters(sp: SP, defaults: Partial<Filters> = {}): Filters {
  const quick = one(sp.quick) || (one(sp.from) ? "custom" : defaults.quick ?? "yesterday");
  const [qf, qt] = quickRange(quick, TODAY);
  return {
    quick, from: one(sp.from) || qf, to: one(sp.to) || qt,
    agency: AGENCY_OWNER_ID,
    subs: one(sp.subs) ? one(sp.subs).split(",") : [],
    fund: (one(sp.fund) || defaults.fund || "recharge") as Filters["fund"],
    network: parseNetwork(one(sp.network)),
    basis: parseBasis(one(sp.basis) || defaults.basis || ""),
    status: (one(sp.status) || defaults.status || "all") as Filters["status"],
    unit: one(sp.unit) === "fen" ? "fen" : "yuan",
    q: one(sp.q), mock: one(sp.mock) || undefined,
  };
}
export const inRange = (d: string, f: Filters) => d.slice(0, 10) >= f.from && d.slice(0, 10) <= f.to;
export const subOk = (id: string, f: Filters) => f.subs.length === 0 || f.subs.includes(id);
