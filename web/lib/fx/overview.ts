import costs from "@/fixtures/costs.json";
import recharges from "@/fixtures/recharges.json";
import { fixtureParentSummary } from "../agency-recharge";
import type { Filters } from "../filters";
import { normalizeFixtureCosts } from "../pnl";
import type { Cost, Recharge } from "../types";
import { loadRevenueOverview } from "./revenue-overview";

/** 概览样例：收入走总览聚合，消耗按天铺满才有盈亏，充值只留一代→二代。 */
export function loadOverviewModel(f: Filters) {
  return {
    overview: loadRevenueOverview(f.from, f.to, f.basis),
    costs: normalizeFixtureCosts(costs as Cost[], f.from, f.to),
    summary: fixtureParentSummary(recharges as Recharge[], f.from, f.to),
  };
}
