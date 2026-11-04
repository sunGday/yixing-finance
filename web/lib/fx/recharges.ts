import recharges from "@/fixtures/recharges.json";
import costs from "@/fixtures/costs.json";
import snapshots from "@/fixtures/snapshots.json";
import { fixtureParentSummary, visibleParentRows } from "../agency-recharge";
import type { BalanceSnapshot, Cost, Recharge } from "../types";
import type { Filters } from "../filters";
import { selectCosts, selectRecharges, selectSnapshots } from "../select";
import { loadSubs } from "./subs";

const ledger = recharges as Recharge[];

export function loadRechargeBundle(f: Filters) {
  return {
    rc: selectRecharges(ledger, f),
    cs: selectCosts(costs as Cost[], f),
    sn: selectSnapshots(snapshots as BalanceSnapshot[], f),
    subs: loadSubs(),
  };
}

/** 样例里的代理商充值。子户划出不在这里。 */
export function loadParentBundle(f: Filters) {
  return {
    summary: fixtureParentSummary(ledger, f.from, f.to),
    rows: visibleParentRows(ledger, f.from, f.to, f.q),
  };
}
