import recharges from "@/fixtures/recharges.json";
import costs from "@/fixtures/costs.json";
import snapshots from "@/fixtures/snapshots.json";
import type { BalanceSnapshot, Cost, Recharge } from "../types";
import type { Filters } from "../filters";
import { selectCosts, selectRecharges, selectSnapshots } from "../select";
import { loadSubs } from "./subs";

export function loadRechargeBundle(f: Filters) {
  return {
    rc: selectRecharges(recharges as Recharge[], f),
    cs: selectCosts(costs as Cost[], f),
    sn: selectSnapshots(snapshots as BalanceSnapshot[], f),
    subs: loadSubs(),
  };
}
