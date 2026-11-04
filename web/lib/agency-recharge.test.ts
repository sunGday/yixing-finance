import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  agencyTotal,
  fixtureParentSummary,
  isParentIn,
  listTotal,
  normalizeRechargeSummary,
  parentInListRequest,
  parentMonths,
  visibleParentRows,
} from "./agency-recharge.ts";
import type { Recharge } from "./types.ts";

const rows = JSON.parse(readFileSync(new URL("../fixtures/recharges.json", import.meta.url), "utf8")) as Recharge[];

describe("agency parent_in", () => {
  it("asks the list for omni_parent_in only", () => {
    assert.equal(parentInListRequest("2026-01-01", "2026-11-03").params.side, "omni_parent_in");
  });

  it("keeps the summary total and drops side_items", () => {
    const view = normalizeRechargeSummary({
      basis: "omni_parent_in",
      total_amount_fen: 2000000,
      items: [{ biz_date: "2026-11-03", amount_fen: 2000000, count: 1 }],
      side_items: [{ biz_date: "2026-11-03", side: "transfer_out", amount_fen: 999999, count: 4 }],
      gap_flags: [],
    }, "2026-11-03", "2026-11-03");
    assert.equal(view.total_amount_fen, 2000000);
    assert.equal(view.count, 1);
    assert.equal("side_items" in view, false);
    assert.equal(agencyTotal(view), 2000000);
  });

  it("does not turn an empty recharge source into a zero total", () => {
    const view = normalizeRechargeSummary({
      total_amount_fen: 0,
      items: [],
      gap_flags: ["recharge_source_empty"],
    }, "2026-01-01", "2026-11-03");
    assert.equal(view.total_amount_fen, 0);
    assert.equal(agencyTotal(view), null);
  });

  it("leaves a missing total empty when there are no days", () => {
    const view = normalizeRechargeSummary({ items: [] }, "2026-11-03", "2026-11-03");
    assert.equal(view.total_amount_fen, null);
    assert.equal(agencyTotal(view), null);
  });

  it("hides transfer_out rows in the fixture ledger", () => {
    const visible = visibleParentRows(rows, "2026-01-01", "2026-11-03", "");
    assert.deepEqual(visible.map((row) => row.txn_id), ["OMNI-PARENT-20261103-1"]);
    assert.equal(rows.some((row) => row.side === "transfer_out"), true);
    assert.equal(isParentIn({ side: "transfer_out" }), false);
    const summary = fixtureParentSummary(rows, "2026-11-03", "2026-11-03");
    assert.equal(summary.total_amount_fen, 800000);
    assert.equal(parentMonths(summary.items)[0]?.period, "2026-11");
  });

  it("keeps the recharge screen on the agency ledger", () => {
    const src = readFileSync(new URL("../app/recharges/view.tsx", import.meta.url), "utf8");
    assert.match(src, /omni_parent_in/);
    assert.match(src, /总共充了多少钱/);
    assert.equal(src.includes("side_items"), false);
    assert.equal(src.includes("入账子户"), false);
  });

  it("does not sum a truncated list into a fake total", () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ amount_fen: 1, direction: "credit" as const, status: "posted" as const }));
    assert.equal(listTotal(many as Recharge[], true), null);
    assert.equal(listTotal([{ amount_fen: 10, direction: "credit", status: "posted" } as Recharge], false), 10);
  });
});
