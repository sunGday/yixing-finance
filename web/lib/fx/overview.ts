import recharges from "@/fixtures/recharges.json";
import costs from "@/fixtures/costs.json";
import snapshots from "@/fixtures/snapshots.json";
import revenues from "@/fixtures/revenues.json";
import recon from "@/fixtures/reconcile.json";
import type { BalanceSnapshot, Cost, Recharge, ReconRow, Revenue } from "../types";
import type { Filters } from "../filters";
import { selectCosts, selectRecharges, selectRecon, selectRevenues, selectSnapshots } from "../select";
import { loadSubs } from "./subs";

/** 概览差额/未匹配按全状态计算，不受对账页默认 unmatched 影响。 */
export function loadOverview(f: Filters) {
  const wide = { ...f, status: "all" as const };
  return {
    rc: selectRecharges(recharges as Recharge[], f),
    cs: selectCosts(costs as Cost[], f),
    sn: selectSnapshots(snapshots as BalanceSnapshot[], f),
    rv: selectRevenues(revenues as Revenue[], f),
    re: selectRecon(recon as ReconRow[], wide),
    subs: loadSubs(),
  };
}
