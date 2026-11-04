import days from "@/fixtures/revenue-days.json";
import bills from "@/fixtures/settlement-bills.json";
import { TODAY } from "../filters";
import type { RevenueBasis } from "../filters";
import { buildCards, buildOverview, type EstimateRow, type Settlement } from "../revenue-overview";

const rows = days as EstimateRow[];
const settlements = bills as Settlement[];

/** Pages / ?mock=1。live 不走这里。今日锁在 fixtures 基准日，和充值样例同一天。 */
export function loadRevenueOverview(from: string, to: string, basis: RevenueBasis) {
  return buildOverview(from, to, basis, TODAY, rows, settlements);
}

export function loadRevenueCards(basis: RevenueBasis) {
  return buildCards(TODAY, basis, rows, settlements);
}

export function loadSettlementFixtures(): Settlement[] {
  return settlements;
}
