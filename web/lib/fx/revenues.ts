import revenues from "@/fixtures/revenues.json";
import type { Revenue } from "../types";
import type { Filters } from "../filters";
import { selectRevenues } from "../select";
import { loadSubs } from "./subs";

export function loadRevenueBundle(f: Filters) {
  return { rv: selectRevenues(revenues as Revenue[], f), subs: loadSubs() };
}
