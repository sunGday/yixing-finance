import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { formatFen } from "./format.ts";
import {
  basisLabel,
  buildCards,
  buildOverview,
  cardsRequest,
  createSettlement,
  detailRequest,
  explainGap,
  markSettlementPaid,
  normalizeOverview,
  overviewRequest,
  parseSettlementImport,
  settlementsRequest,
  validateSettlementInput,
  yuanToFen,
  type EstimateRow,
  type Settlement,
} from "./revenue-overview.ts";

const TODAY = "2026-11-04";
const days = JSON.parse(readFileSync(new URL("../fixtures/revenue-days.json", import.meta.url), "utf8")) as EstimateRow[];
const bills = JSON.parse(readFileSync(new URL("../fixtures/settlement-bills.json", import.meta.url), "utf8")) as Settlement[];

const live = {
  from: "2026-11-03",
  to: "2026-11-03",
  basis: "auto",
  source: "gromore_daily",
  total_fen: 1340359,
  api_total_fen: null,
  networks: [
    { ad_network: "pangle", amount_fen: 567019, api_amount_fen: null, basis: "estimate", settlement_status: "estimated" },
    { ad_network: "ylh", amount_fen: 656399, api_amount_fen: null, basis: "estimate", settlement_status: "estimated" },
    { ad_network: "kuaishou", amount_fen: 116941, api_amount_fen: null, basis: "estimate", settlement_status: "estimated" },
    { ad_network: "gm_adx", amount_fen: 0, api_amount_fen: null, basis: "estimate", settlement_status: "estimated" },
  ],
  by_month: [{ period: "2026-11", basis: "estimate", settlement_status: "estimated", amount_fen: 1340359, estimate_fen: 1340359, diff_fen: null }],
  gap_flags: [],
  verified: true,
};

describe("fen formatting", () => {
  it("renders Allen's 1340359 fen as yuan with 2 decimals", () => {
    assert.equal(formatFen(1340359), "13,403.59");
    assert.equal(formatFen(0), "0.00");
    assert.equal(formatFen(null), "—");
    assert.equal(formatFen(567019, "fen"), "567,019");
  });

  it("parses yuan text back to fen", () => {
    assert.equal(yuanToFen("13,403.59"), 1340359);
    assert.equal(yuanToFen("13403.59"), 1340359);
    assert.equal(yuanToFen("0"), 0);
    assert.equal(yuanToFen("1.234"), null);
    assert.equal(yuanToFen("-1"), null);
  });
});

describe("basis and gap labels", () => {
  it("names the three overview bases", () => {
    assert.equal(basisLabel("auto"), "自动");
    assert.equal(basisLabel("estimate"), "预估");
    assert.equal(basisLabel("settlement"), "结算");
  });

  it("explains missing settlement and credential gaps", () => {
    assert.match(explainGap("settlement_missing:2026-11"), /没有结算单/);
    assert.match(explainGap("settlement_missing:2026-11"), /不是 0/);
    assert.match(explainGap("credential_missing:gromore"), /凭证未配齐/);
    assert.match(explainGap("fallback_rt_income:pangle_only"), /只含穿山甲/);
    assert.equal(explainGap("gromore_fetch_failed"), "收入拉取失败");
  });
});

describe("mock to live mapping", () => {
  it("calls the real overview, cards, settlements, and detail paths", () => {
    assert.deepEqual(overviewRequest("2026-11-03", "2026-11-03", "auto"), {
      path: "/revenues/overview",
      params: { from: "2026-11-03", to: "2026-11-03", basis: "auto" },
    });
    assert.deepEqual(cardsRequest("settlement"), {
      path: "/revenues/overview/cards",
      params: { basis: "settlement" },
    });
    assert.equal(settlementsRequest().path, "/settlements");
    assert.deepEqual(detailRequest("2026-11-03", "2026-11-03", "pangle").params.ad_network, "pangle");
    assert.equal(detailRequest("2026-11-03", "2026-11-03", "kuaishou").params.ad_network, undefined);
  });

  it("maps the live ECS payload for 2026-11-03", () => {
    const view = normalizeOverview(live);
    assert.equal(view.total_fen, 1340359);
    assert.deepEqual(view.networks.map((row) => [row.ad_network, row.amount_fen]), [
      ["pangle", 567019],
      ["ylh", 656399],
      ["kuaishou", 116941],
      ["gm_adx", 0],
    ]);
    assert.equal(view.networks.reduce((sum, row) => sum + (row.amount_fen ?? 0), 0), 1340359);
  });

  it("sums the year by network instead of a single day", () => {
    const year = buildOverview("2026-01-01", "2026-11-03", "estimate", TODAY, days, bills);
    assert.equal(year.basis, "estimate");
    assert.equal(year.source, "gromore_daily");
    assert.deepEqual(year.networks.map((row) => row.ad_network), ["pangle", "ylh", "kuaishou", "gm_adx"]);
    assert.ok(year.networks.every((row) => row.basis === "estimate"));
    const net = year.networks.reduce((sum, row) => sum + (row.amount_fen ?? 0), 0);
    assert.equal(year.total_fen, net + 100);
    assert.ok((year.total_fen ?? 0) > 1340359);
    assert.equal(year.by_month.find((month) => month.period === "2026-10")?.amount_fen, 300);
    assert.equal(year.by_month[0]?.period, "2026-01");
    assert.equal(year.by_month.at(-1)?.period, "2026-11");
    assert.ok(year.networks.every((row) => !("app_id" in row) && !("placement_id" in row)));
  });

  it("builds the same yesterday total from fixtures", () => {
    const view = buildOverview("2026-11-03", "2026-11-03", "auto", TODAY, days, bills);
    assert.equal(view.total_fen, 1340359);
    assert.equal(view.source, "gromore_daily");
    assert.deepEqual(view.gap_flags, []);
    assert.deepEqual(view.networks.map((row) => row.amount_fen), [567019, 656399, 116941, 0]);
    const cards = buildCards(TODAY, "auto", days, bills);
    assert.equal(cards.cards.find((card) => card.key === "yesterday")?.total_fen, 1340359);
  });

  it("leaves settlement amount empty instead of zero when the bill is missing", () => {
    const view = buildOverview("2026-11-03", "2026-11-03", "settlement", TODAY, days, bills);
    assert.equal(view.total_fen, null);
    assert.deepEqual(view.networks, []);
    assert.ok(view.gap_flags.includes("settlement_missing:2026-11"));
  });

  it("uses a full-month bill on auto and keeps estimate when forced", () => {
    const auto = buildOverview("2026-10-01", "2026-10-31", "auto", TODAY, days, bills);
    assert.equal(auto.total_fen, 1860000);
    assert.equal(auto.networks[0]?.ad_network, null);
    assert.equal(auto.networks[0]?.basis, "settlement");
    const estimate = buildOverview("2026-10-01", "2026-10-31", "estimate", TODAY, days, bills);
    assert.equal(estimate.total_fen, 300);
    assert.ok(estimate.networks.every((row) => row.basis === "estimate"));
  });
});

describe("settlement writes", () => {
  it("rejects estimated and accepts a settled bill", () => {
    const rejected = validateSettlementInput({
      period: "2026-10", business_type: "sdk_ads", amount_text: "100", unit: "yuan",
      settlement_status: "estimated", signed_date: "2026-11-02", evidence_ref: "bill",
    });
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.equal(rejected.message, "预估不入账");
    const ok = validateSettlementInput({
      period: "2026-10", business_type: "sdk_ads", amount_text: "18,600.00", unit: "yuan",
      settlement_status: "settled", signed_date: "2026-11-02", evidence_ref: "gromore-bill",
    });
    assert.equal(ok.ok, true);
    if (!ok.ok) return;
    assert.equal(ok.value.amount_fen, 1860000);
    const created = createSettlement([], ok.value, "2026-11-02T12:00:00+08:00");
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const paid = markSettlementPaid(created.items, created.created.settlement_id, "2026-11-04", "2026-11-04T12:00:00+08:00");
    assert.equal(paid.ok, true);
    if (!paid.ok) return;
    assert.equal(paid.items[0]?.settlement_status, "paid");
    assert.equal(markSettlementPaid(paid.items, created.created.settlement_id, "2026-11-05", "2026-11-05T00:00:00+08:00").ok, false);
  });

  it("refuses an import that tries to store an estimate", () => {
    const parsed = parseSettlementImport(JSON.stringify({
      items: [{ period: "2026-09", business_type: "sdk_ads", amount_fen: 1, settlement_status: "estimated", signed_date: "2026-10-01", evidence_ref: "x" }],
    }));
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.match(parsed.message, /预估不入账/);
  });
});
