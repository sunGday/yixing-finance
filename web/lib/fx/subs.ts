import raw from "@/fixtures/sub-owners.json";
import type { SubOwner } from "../types";

export function loadSubs(): SubOwner[] {
  return raw as SubOwner[];
}
