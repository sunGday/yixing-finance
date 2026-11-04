import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { buildOverview, type EstimateRow, type Settlement } from "./revenue-overview.ts";
import { forRequestedRange, normalizeFixtureCosts, normalizeLiveCosts, profitAndLoss, shownCost, sliceCostWindow } from "./pnl.ts";
import type { Cost } from "./types.ts";

const TODAY = "2026-11-04";
const days = JSON.parse(readFileSync(new URL("../fixtures/revenue-days.json", import.meta.url), "utf8")) as EstimateRow[];
const bills = JSON.parse(readFileSync(new URL("../fixtures/settlement-bills.json", import.meta.url), "utf8")) as Settlement[];
const costs = JSON.parse(readFileSync(new URL("../fixtures/costs.json", import.meta.url), "utf8")) as Cost[];

describe("profit and loss", () => {
  it("drops the previous range instead of holding it until both sides match", () => {
    const src = readFileSync(new URL("../app/overview-view.tsx", import.meta.url), "utf8");
    assert.equal(src.includes("useStableTrio"), false);
    assert.match(src, /forRequestedRange/);
    assert.match(src, /消耗 · 部分/);
    assert.match(src, /收入拉取失败/);
    const previous = { from: "2026-11-03", to: "2026-11-03", total_fen: 1 };
    assert.equal(forRequestedRange(previous, "2026-01-01", "2026-11-03"), undefined);
    assert.equal(forRequestedRange(previous, "2026-11-03", "2026-11-03"), previous);
  });

  it("subtracts a fully covered day", () => {
    const revenue = buildOverview("2026-11-03", "2026-11-03", "auto", TODAY, days, bills);
    const cost = normalizeFixtureCosts(costs, "2026-11-03", "2026-11-03");
    assert.equal(revenue.total_fen, 1340359);
    assert.equal(cost.total_fen, 195776 + 88000);
    const pnl = profitAndLoss(revenue, cost);
    assert.equal(pnl.fen, 1340359 - 283776);
    assert.equal(pnl.text, "赚了");
  });

  it("does not subtract a partial year cost from the year revenue", () => {
    const revenue = buildOverview("2026-01-01", "2026-11-03", "estimate", TODAY, days, bills);
    const cost = normalizeFixtureCosts(costs, "2026-01-01", "2026-11-03");
    assert.ok((revenue.total_fen ?? 0) > 0);
    assert.equal(cost.total_fen, null);
    assert.ok((cost.partial_fen ?? 0) > 0);
    assert.match(cost.gap ?? "", /只覆盖/);
    const pnl = profitAndLoss(revenue, cost);
    assert.equal(pnl.fen, null);
    assert.match(pnl.text, /消耗覆盖/);
    assert.equal(shownCost(cost).partial, true);
    assert.equal(shownCost(cost).fen, cost.partial_fen);
  });

  it("uses a fully covered month inside a longer range", () => {
    const items = [];
    for (let day = 1; day <= 31; day++) {
      items.push({ biz_date: `2026-10-${String(day).padStart(2, "0")}`, complete: true, cost_fen: 10 });
    }
    items.push({ biz_date: "2026-11-03", complete: true, cost_fen: 999 });
    const cost = normalizeLiveCosts({ items }, "2026-01-01", "2026-11-03");
    assert.equal(cost.total_fen, null);
    const pnl = profitAndLoss({
      total_fen: 5000,
      from: "2026-01-01",
      to: "2026-11-03",
      by_month: [
        { period: "2026-10", amount_fen: 1000 },
        { period: "2026-11", amount_fen: 4000 },
      ],
    }, cost);
    assert.equal(pnl.fen, 1000 - 31 * 10);
    assert.match(pnl.text, /已覆盖 31 天/);
  });

  it("ignores partial_cost_fen and null cost_fen", () => {
    const cost = normalizeLiveCosts({
      gap_flags: [],
      items: [
        { biz_date: "2026-11-03", complete: false, cost_fen: null, partial_cost_fen: 999999 },
        { biz_date: "2026-11-02", complete: true, cost_fen: 100 },
      ],
    }, "2026-11-02", "2026-11-03");
    assert.equal(cost.total_fen, null);
    assert.equal(cost.partial_fen, 100);
    assert.equal(cost.known.some((row) => row.fen === 999999), false);
    const refused = normalizeLiveCosts({
      items: [{ biz_date: "2026-11-03", complete: false, cost_fen: 50, partial_cost_fen: 50 }],
    }, "2026-11-03", "2026-11-03");
    assert.equal(refused.total_fen, null);
    assert.equal(refused.partial_fen, null);
    const one = sliceCostWindow(cost, "2026-11-02", "2026-11-02");
    assert.equal(one.total_fen, 100);
    assert.equal(profitAndLoss({ total_fen: 250, from: "2026-11-02", to: "2026-11-02" }, one).fen, 150);
  });

  it("keeps an empty cost source empty", () => {
    const cost = normalizeLiveCosts({ items: [], gap_flags: ["cost_source_empty"] }, "2026-11-03", "2026-11-03");
    assert.equal(cost.total_fen, null);
    assert.equal(cost.partial_fen, null);
    assert.equal(cost.gap, "这个区间没有消耗");
    assert.equal(profitAndLoss({ total_fen: null, from: "2026-11-03", to: "2026-11-03" }, cost).fen, null);
  });

  it("does not mix two ranges", () => {
    const cost = normalizeFixtureCosts(costs, "2026-11-03", "2026-11-03");
    const pnl = profitAndLoss({ total_fen: 10, from: "2026-01-01", to: "2026-11-03" }, cost);
    assert.equal(pnl.fen, null);
    assert.match(pnl.text, /没对齐/);
  });

  it("names a loss", () => {
    const cost = normalizeLiveCosts({ items: [{ biz_date: "2026-11-03", complete: true, cost_fen: 50 }] }, "2026-11-03", "2026-11-03");
    const pnl = profitAndLoss({ total_fen: 20, from: "2026-11-03", to: "2026-11-03" }, cost);
    assert.equal(pnl.fen, -30);
    assert.equal(pnl.text, "亏了");
    assert.equal(pnl.tone, "danger");
  });
});
