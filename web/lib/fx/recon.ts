import recon from "@/fixtures/reconcile.json";
import type { ReconRow } from "../types";
import type { Filters } from "../filters";
import { selectRecon } from "../select";
import { loadSubs } from "./subs";

export function loadReconBundle(f: Filters) {
  const all = selectRecon(recon as ReconRow[], { ...f, status: "all" });
  const rows = f.status === "all" ? all : all.filter((r) => r.status === f.status);
  return { rows, all, subs: loadSubs() };
}
