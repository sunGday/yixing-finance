// 收入总览 / 结算单。形状对齐 mario v0.6（GET /revenues/overview、/overview/cards、/settlements）。
// 金额整数分。预估只展示；结算单只存 settled|paid。
import type { Revenue } from "./types";

export type Unit = "yuan" | "fen";
export type AdNetwork = "pangle" | "ylh" | "kuaishou" | "gm_adx";
export type RevenueBasis = "auto" | "estimate" | "settlement";
export type BasisShown = "estimate" | "settlement";
export type SettlementStatus = "estimated" | "settled" | "paid";
export type OverviewSource = "gromore_daily" | "rt_income_fallback" | "settlement_manual" | "mixed";
export type BusinessType = "sdk_ads" | "ad_coop";
export type CardKey = "yesterday" | "last7" | "this_month" | "last_month";

export interface OverviewNetwork {
  ad_network: string | null;
  amount_fen: number | null;
  api_amount_fen: number | null;
  basis: BasisShown;
  settlement_status: SettlementStatus | null;
}

export interface OverviewMonth {
  period: string;
  basis: BasisShown;
  settlement_status: SettlementStatus | null;
  amount_fen: number | null;
  estimate_fen: number | null;
  diff_fen: number | null;
}

export interface RevenueOverview {
  from: string | null;
  to: string | null;
  basis: RevenueBasis;
  source: OverviewSource | null;
  total_fen: number | null;
  api_total_fen: number | null;
  networks: OverviewNetwork[];
  by_month: OverviewMonth[];
  gap_flags: string[];
  verified: boolean;
}

export interface OverviewCard extends RevenueOverview {
  key: CardKey;
  label: string;
}

export interface OverviewCards {
  timezone: string;
  today: string;
  basis: RevenueBasis;
  cards: OverviewCard[];
}

export interface Settlement {
  settlement_id: string;
  period: string;
  business_type: BusinessType;
  ad_network: AdNetwork | null;
  amount_fen: number;
  settlement_status: "settled" | "paid";
  signed_date: string;
  paid_date: string | null;
  evidence_ref: string;
  created_at: string;
  updated_at: string;
}

export interface EstimateRow {
  stat_date: string;
  ad_network: string | null;
  code?: string | null;
  amount_fen: number;
  api_amount_fen?: number | null;
}

export const BASIS_LABEL: Record<RevenueBasis, string> = { auto: "自动", estimate: "预估", settlement: "结算" };
export const BUSINESS_LABEL: Record<BusinessType, string> = { sdk_ads: "SDK广告", ad_coop: "广告合作" };
const NETWORK_ORDER = ["pangle", "ylh", "kuaishou", "gm_adx"] as const;

function asNetwork(value: string | null): AdNetwork | null {
  if (value === "pangle" || value === "ylh" || value === "kuaishou" || value === "gm_adx") return value;
  return null;
}
const HARD_GAP = ["credential_missing", "gromore_fetch_failed", "network_unmapped", "settlement_missing", "fallback_rt_income", "today_excluded"];
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function basisLabel(basis: string | null | undefined): string {
  if (basis === "auto" || basis === "estimate" || basis === "settlement") return BASIS_LABEL[basis];
  if (basis === "estimated") return "预估";
  return basis || "—";
}

const NETWORK_LABEL: Record<string, string> = { pangle: "穿山甲", ylh: "优量汇", kuaishou: "快手", gm_adx: "gm_adx" };

export function networkLabel(id: string | null | undefined): string {
  if (!id) return "月总额";
  return NETWORK_LABEL[id] ?? id;
}

function rowNetworkParam(network: AdNetwork | "all"): string | undefined {
  return network === "pangle" || network === "ylh" ? network : undefined;
}

export function explainGap(flag: string): string {
  if (flag.startsWith("credential_missing:gromore")) return "GroMore 凭证未配齐";
  if (flag.startsWith("credential_missing:")) return `${networkLabel(flag.slice("credential_missing:".length))}凭证未配齐`;
  if (flag.startsWith("fallback_rt_income")) return "部分数据：GroMore 不可用，合计只含穿山甲";
  if (flag.startsWith("settlement_missing:")) return `${flag.slice("settlement_missing:".length)} 没有结算单，金额留空，不是 0`;
  if (flag === "gromore_fetch_failed") return "GroMore 拉取失败";
  if (flag.startsWith("network_unmapped:")) return `未映射广告网络 ${flag.slice("network_unmapped:".length)}，金额计入合计`;
  if (flag.startsWith("today_excluded:")) return `不含今天 ${flag.slice("today_excluded:".length)}`;
  if (flag.startsWith("estimate_settlement_diff:")) return `${flag.slice("estimate_settlement_diff:".length)} 预估与结算差额较大`;
  return flag;
}

export function hasCredentialGapFlag(flags: string[] | undefined): boolean {
  return !!flags?.some((flag) => flag.startsWith("credential_missing"));
}

export function overviewRequest(from: string, to: string, basis: RevenueBasis) {
  return { path: "/revenues/overview", params: { from, to, basis } };
}

export function cardsRequest(basis: RevenueBasis) {
  return { path: "/revenues/overview/cards", params: { basis } };
}

export function settlementsRequest() {
  return { path: "/settlements", params: { page_size: "500" } };
}

export function detailRequest(from: string, to: string, network: AdNetwork | "all") {
  return {
    path: "/revenues",
    params: { start_date: from, end_date: to, ad_network: rowNetworkParam(network), page_size: "500" },
  };
}

function addDays(d: string, n: number) {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

function monthsBetween(start: string, end: string): string[] {
  const out: string[] = [];
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  const last = end.slice(0, 7);
  for (let i = 0; i < 36; i++) {
    const period = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
    if (period > last) break;
    out.push(period);
    m += 1;
    if (m === 13) { m = 1; y += 1; }
  }
  return out;
}

function monthBounds(period: string): [string, string] {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7));
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return [`${period}-01`, addDays(next, -1)];
}

function material(diff: number, base: number) {
  const ratio = Math.round(Math.abs(base) * 0.01);
  return Math.abs(diff) > Math.max(100, ratio);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function reqString(v: unknown, name: string): string {
  if (typeof v !== "string" || !v) throw new Error(`${name} 缺失`);
  return v;
}

function numOrNull(v: unknown, name: string): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  throw new Error(`${name} 不是数字`);
}

function strOrNull(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v !== "string") throw new Error("字段不是字符串");
  return v;
}

function gapList(v: unknown): string[] {
  if (v == null) return [];
  if (!Array.isArray(v) || v.some((item) => typeof item !== "string")) throw new Error("gap_flags 不是字符串列表");
  return v as string[];
}

export function normalizeNetworkRow(raw: unknown): OverviewNetwork {
  if (!isObj(raw)) throw new Error("网络行不是对象");
  const basis = raw.basis;
  if (basis !== "estimate" && basis !== "settlement") throw new Error("网络口径非法");
  const status = raw.settlement_status;
  if (status != null && status !== "estimated" && status !== "settled" && status !== "paid") throw new Error("结算状态非法");
  return {
    ad_network: strOrNull(raw.ad_network),
    amount_fen: numOrNull(raw.amount_fen, "amount_fen"),
    api_amount_fen: numOrNull(raw.api_amount_fen, "api_amount_fen"),
    basis,
    settlement_status: status ?? null,
  };
}

export function normalizeOverview(raw: unknown): RevenueOverview {
  if (!isObj(raw)) throw new Error("总览响应不是对象");
  const basis = raw.basis;
  if (basis !== "auto" && basis !== "estimate" && basis !== "settlement") throw new Error("basis 非法");
  if (!Array.isArray(raw.networks)) throw new Error("总览缺少 networks");
  const source = raw.source;
  if (source != null && source !== "gromore_daily" && source !== "rt_income_fallback" && source !== "settlement_manual" && source !== "mixed") {
    throw new Error("source 非法");
  }
  const byMonth = Array.isArray(raw.by_month) ? raw.by_month.map(normalizeMonth) : [];
  return {
    from: strOrNull(raw.from),
    to: strOrNull(raw.to),
    basis,
    source: source ?? null,
    total_fen: numOrNull(raw.total_fen, "total_fen"),
    api_total_fen: numOrNull(raw.api_total_fen, "api_total_fen"),
    networks: raw.networks.map(normalizeNetworkRow),
    by_month: byMonth,
    gap_flags: gapList(raw.gap_flags),
    verified: raw.verified === true,
  };
}

function normalizeMonth(raw: unknown): OverviewMonth {
  if (!isObj(raw)) throw new Error("月份行不是对象");
  const basis = raw.basis === "settlement" ? "settlement" : "estimate";
  const status = raw.settlement_status;
  return {
    period: reqString(raw.period, "period"),
    basis,
    settlement_status: status === "estimated" || status === "settled" || status === "paid" ? status : null,
    amount_fen: numOrNull(raw.amount_fen, "amount_fen"),
    estimate_fen: numOrNull(raw.estimate_fen, "estimate_fen"),
    diff_fen: numOrNull(raw.diff_fen, "diff_fen"),
  };
}

export function normalizeCards(raw: unknown): OverviewCards {
  if (!isObj(raw) || !Array.isArray(raw.cards)) throw new Error("卡片响应缺少 cards");
  const basis = raw.basis === "estimate" || raw.basis === "settlement" ? raw.basis : "auto";
  return {
    timezone: typeof raw.timezone === "string" ? raw.timezone : "Asia/Shanghai",
    today: typeof raw.today === "string" ? raw.today : "",
    basis,
    cards: raw.cards.map((card) => {
      if (!isObj(card)) throw new Error("卡片不是对象");
      const key = card.key;
      if (key !== "yesterday" && key !== "last7" && key !== "this_month" && key !== "last_month") throw new Error("卡片 key 非法");
      return { key, label: typeof card.label === "string" ? card.label : key, ...normalizeOverview({ ...card, basis: card.basis ?? basis }) };
    }),
  };
}

export function normalizeSettlement(raw: unknown): Settlement {
  if (!isObj(raw)) throw new Error("结算单不是对象");
  if (raw.settlement_status === "estimated") throw new Error("预估不入账");
  if (raw.settlement_status !== "settled" && raw.settlement_status !== "paid") throw new Error("结算状态非法");
  const business = raw.business_type;
  if (business !== "sdk_ads" && business !== "ad_coop") throw new Error("业务类型非法");
  const network = asNetwork(strOrNull(raw.ad_network));
  if (strOrNull(raw.ad_network) && !network) throw new Error("广告网络非法");
  const amount = raw.amount_fen;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 0) throw new Error("amount_fen 必须是非负整数分");
  return {
    settlement_id: reqString(raw.settlement_id, "settlement_id"),
    period: reqString(raw.period, "period"),
    business_type: business,
    ad_network: network,
    amount_fen: amount,
    settlement_status: raw.settlement_status,
    signed_date: reqString(raw.signed_date, "signed_date"),
    paid_date: strOrNull(raw.paid_date),
    evidence_ref: reqString(raw.evidence_ref, "evidence_ref"),
    created_at: typeof raw.created_at === "string" ? raw.created_at : "",
    updated_at: typeof raw.updated_at === "string" ? raw.updated_at : "",
  };
}

export function normalizeSettlementList(raw: unknown): Settlement[] {
  const items = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.items) ? raw.items : null;
  if (!items) throw new Error("结算单响应缺少 items");
  return items.map(normalizeSettlement);
}

export function normalizeDetail(raw: unknown): { items: Revenue[]; gap_flags: string[] } {
  if (Array.isArray(raw)) return { items: raw as Revenue[], gap_flags: [] };
  if (!isObj(raw)) throw new Error("明细响应不是对象");
  const items = Array.isArray(raw.items) ? raw.items as Revenue[] : [];
  return { items, gap_flags: gapList(raw.gap_flags) };
}

export interface CardSpec { key: CardKey; label: string; from: string | null; to: string | null }

export function cardSpecs(today: string): CardSpec[] {
  const yest = addDays(today, -1);
  const monthStart = today.slice(0, 8) + "01";
  const prevEnd = addDays(monthStart, -1);
  const prevStart = prevEnd.slice(0, 8) + "01";
  const thisMonth = yest >= monthStart ? { from: monthStart, to: yest } : { from: null, to: null };
  return [
    { key: "yesterday", label: "昨日", from: yest, to: yest },
    { key: "last7", label: "近7日", from: addDays(today, -7), to: yest },
    { key: "this_month", label: "本月", from: thisMonth.from, to: thisMonth.to },
    { key: "last_month", label: "上月", from: prevStart, to: prevEnd },
  ];
}

function netRow(ad: string | null, amount: number, api: number | null, basis: BasisShown, status: SettlementStatus): OverviewNetwork {
  return { ad_network: ad, amount_fen: amount, api_amount_fen: api, basis, settlement_status: status };
}

function rollupBills(bills: Settlement[]) {
  if (!bills.length) return null;
  const totals = bills.filter((bill) => !bill.ad_network);
  const chosen = totals.length ? totals : bills;
  const amount = chosen.reduce((sum, bill) => sum + bill.amount_fen, 0);
  const statuses = new Set(chosen.map((bill) => bill.settlement_status));
  const status: "settled" | "paid" = statuses.size === 1 && statuses.has("paid") ? "paid" : "settled";
  let parts: OverviewNetwork[];
  if (totals.length) parts = [netRow(null, amount, null, "settlement", status)];
  else {
    const bucket = new Map<string, { amount: number; st: Set<string> }>();
    for (const bill of chosen) {
      const key = bill.ad_network || "";
      const slot = bucket.get(key) ?? { amount: 0, st: new Set<string>() };
      slot.amount += bill.amount_fen;
      slot.st.add(bill.settlement_status);
      bucket.set(key, slot);
    }
    parts = [...bucket.entries()].map(([key, info]) => netRow(key, info.amount, null, "settlement", info.st.size === 1 && info.st.has("paid") ? "paid" : "settled"));
  }
  return { amount_fen: amount, settlement_status: status, parts };
}

function accumulate(acc: Map<string, OverviewNetwork>, part: OverviewNetwork) {
  const key = `${part.ad_network ?? ""}\0${part.basis}\0${part.settlement_status ?? ""}`;
  const slot = acc.get(key);
  if (!slot) { acc.set(key, { ...part }); return; }
  slot.amount_fen = (slot.amount_fen ?? 0) + (part.amount_fen ?? 0);
  if (part.api_amount_fen == null) return;
  slot.api_amount_fen = (slot.api_amount_fen ?? 0) + part.api_amount_fen;
}

function sortNets(rows: OverviewNetwork[]) {
  const rank = (id: string | null) => {
    if (id == null) return 50;
    const i = (NETWORK_ORDER as readonly string[]).indexOf(id);
    return i === -1 ? 40 : i;
  };
  return [...rows].sort((a, b) => rank(a.ad_network) - rank(b.ad_network) || a.basis.localeCompare(b.basis));
}

/** 与 overview.py build_overview 对齐的 fixtures 聚合。live 不走这里。 */
export function buildOverview(
  dateFrom: string,
  dateTo: string,
  basis: RevenueBasis,
  today: string,
  estimateRows: EstimateRow[],
  settlementItems: Settlement[],
  estimateSource: OverviewSource | null = "gromore_daily",
  fetchGaps: string[] = [],
): RevenueOverview {
  const yest = addDays(today, -1);
  const gaps = [...fetchGaps];
  if (dateTo >= today) gaps.push(`today_excluded:${today}`);
  const estEnd = dateTo > yest ? yest : dateTo;
  const window = dateFrom <= estEnd ? estimateRows.filter((row) => row.stat_date >= dateFrom && row.stat_date <= estEnd) : [];
  const apis = window.map((row) => row.api_amount_fen).filter((n): n is number => n != null);
  const apiTotal = apis.length ? apis.reduce((s, n) => s + n, 0) : null;
  const billsBy = new Map<string, Settlement[]>();
  for (const bill of settlementItems) {
    if ((bill.settlement_status === "settled" || bill.settlement_status === "paid") && bill.period) {
      const list = billsBy.get(bill.period) ?? [];
      list.push(bill);
      billsBy.set(bill.period, list);
    }
  }
  const byMonth: OverviewMonth[] = [];
  const acc = new Map<string, OverviewNetwork>();
  let usedEstimate = false;
  let usedSettlement = false;
  const usedRows: EstimateRow[] = [];

  for (const period of monthsBetween(dateFrom, dateTo)) {
    const [ms, me] = monthBounds(period);
    const full = dateFrom <= ms && dateTo >= me;
    const monthClosed = me <= yest;
    const rolled = rollupBills(billsBy.get(period) ?? []);
    const rows = window.filter((row) => row.stat_date.slice(0, 7) === period);
    const estimateFen = estimateSource === "gromore_daily" || rows.length ? rows.reduce((s, row) => s + row.amount_fen, 0) : null;
    let mode: "settlement" | "estimate" | "missing";
    if (basis === "settlement") mode = rolled ? "settlement" : "missing";
    else if (basis === "estimate") mode = "estimate";
    else mode = full && rolled ? "settlement" : "estimate";
    let diff: number | null = null;
    if (rolled && full && monthClosed && estimateSource === "gromore_daily" && estimateFen != null) {
      diff = rolled.amount_fen - estimateFen;
      if (material(diff, rolled.amount_fen)) gaps.push(`estimate_settlement_diff:${period}`);
    }
    let amount: number | null;
    let status: SettlementStatus | null;
    if (mode === "settlement" && rolled) {
      usedSettlement = true;
      amount = rolled.amount_fen;
      status = rolled.settlement_status;
      for (const part of rolled.parts) accumulate(acc, part);
    } else if (mode === "missing") {
      gaps.push(`settlement_missing:${period}`);
      amount = null;
      status = null;
    } else if (estimateFen == null) {
      amount = null;
      status = "estimated";
    } else {
      usedEstimate = true;
      amount = estimateFen;
      status = "estimated";
      usedRows.push(...rows);
      const byNet = new Map<string, { amount: number; api: number | null }>();
      for (const row of rows) {
        if (!row.ad_network) continue;
        const slot = byNet.get(row.ad_network) ?? { amount: 0, api: null };
        slot.amount += row.amount_fen;
        if (row.api_amount_fen != null) slot.api = (slot.api ?? 0) + row.api_amount_fen;
        byNet.set(row.ad_network, slot);
      }
      for (const [net, info] of byNet) accumulate(acc, netRow(net, info.amount, info.api, "estimate", "estimated"));
    }
    byMonth.push({
      period,
      basis: mode === "estimate" ? "estimate" : "settlement",
      settlement_status: status,
      amount_fen: amount,
      estimate_fen: estimateFen,
      diff_fen: diff,
    });
  }

  for (const row of usedRows) {
    if (!row.ad_network) gaps.push(`network_unmapped:${row.code || "missing"}`);
  }
  const amounts = byMonth.map((month) => month.amount_fen).filter((n): n is number => n != null);
  const total = amounts.length ? amounts.reduce((s, n) => s + n, 0) : null;
  let source: OverviewSource | null;
  if (usedSettlement && usedEstimate) source = "mixed";
  else if (usedSettlement) source = "settlement_manual";
  else if (usedEstimate || basis !== "settlement") source = estimateSource;
  else source = null;
  const gapFlags = [...new Set(gaps)].sort();
  const verified = (source === "gromore_daily" || source === "settlement_manual" || source === "mixed")
    && !gapFlags.some((flag) => HARD_GAP.some((hard) => flag.startsWith(hard)));
  return {
    from: dateFrom, to: dateTo, basis, source, total_fen: total, api_total_fen: apiTotal,
    networks: sortNets([...acc.values()]), by_month: byMonth, gap_flags: gapFlags, verified,
  };
}

function emptyCard(spec: CardSpec, basis: RevenueBasis, today: string): OverviewCard {
  return {
    key: spec.key, label: spec.label, from: null, to: null, basis, source: null,
    total_fen: null, api_total_fen: null, networks: [], by_month: [],
    gap_flags: [`today_excluded:${today}`], verified: false,
  };
}

export function buildCards(today: string, basis: RevenueBasis, rows: EstimateRow[], bills: Settlement[]): OverviewCards {
  const cards = cardSpecs(today).map((spec) => {
    if (!spec.from || !spec.to) return emptyCard(spec, basis, today);
    return { key: spec.key, label: spec.label, ...buildOverview(spec.from, spec.to, basis, today, rows, bills) };
  });
  return { timezone: "Asia/Shanghai", today, basis, cards };
}

export function yuanToFen(text: string): number | null {
  const t = text.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

export function parseAmountToFen(text: string, unit: Unit): number | null {
  if (unit === "fen") {
    const t = text.trim().replace(/,/g, "");
    if (!/^\d+$/.test(t)) return null;
    return Number(t);
  }
  return yuanToFen(text);
}

export interface SettlementInput {
  period: string;
  business_type: BusinessType;
  ad_network: AdNetwork | null;
  amount_fen: number;
  settlement_status: "settled" | "paid";
  signed_date: string;
  paid_date: string | null;
  evidence_ref: string;
  settlement_id?: string;
}

export function validateSettlementInput(raw: {
  period?: string;
  business_type?: string;
  ad_network?: string | null;
  amount_text?: string;
  unit?: Unit;
  settlement_status?: string;
  signed_date?: string;
  paid_date?: string | null;
  evidence_ref?: string;
  settlement_id?: string | null;
}): { ok: true; value: SettlementInput } | { ok: false; message: string } {
  if (raw.settlement_status === "estimated") return { ok: false, message: "预估不入账" };
  if (raw.settlement_status !== "settled" && raw.settlement_status !== "paid") return { ok: false, message: "结算状态只能是已签订或已到账" };
  if (!raw.period || !PERIOD.test(raw.period)) return { ok: false, message: "月份要是 YYYY-MM" };
  if (raw.business_type !== "sdk_ads" && raw.business_type !== "ad_coop") return { ok: false, message: "业务类型要选 SDK广告或广告合作" };
  const network = asNetwork(raw.ad_network ? raw.ad_network : null);
  if (raw.ad_network && !network) return { ok: false, message: "广告网络非法" };
  const amount = parseAmountToFen(raw.amount_text ?? "", raw.unit ?? "yuan");
  if (amount == null) return { ok: false, message: raw.unit === "fen" ? "金额要是非负整数分" : "金额要是元，最多两位小数" };
  if (!raw.signed_date || !DAY.test(raw.signed_date)) return { ok: false, message: "签订日要是 YYYY-MM-DD" };
  const paid = raw.paid_date || null;
  if (raw.settlement_status === "paid" && !paid) return { ok: false, message: "已到账要填到账日" };
  if (raw.settlement_status === "settled" && paid) return { ok: false, message: "未到账不要填到账日" };
  if (paid && !DAY.test(paid)) return { ok: false, message: "到账日要是 YYYY-MM-DD" };
  const evidence = (raw.evidence_ref ?? "").trim();
  if (!evidence) return { ok: false, message: "要填证据编号" };
  if (evidence.length > 500 || /[\r\n\u0000]/.test(evidence)) return { ok: false, message: "证据编号无效" };
  const sid = raw.settlement_id?.trim() || undefined;
  if (sid && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(sid)) return { ok: false, message: "结算单号无效" };
  return {
    ok: true,
    value: {
      period: raw.period,
      business_type: raw.business_type,
      ad_network: network,
      amount_fen: amount,
      settlement_status: raw.settlement_status,
      signed_date: raw.signed_date,
      paid_date: raw.settlement_status === "paid" ? paid : null,
      evidence_ref: evidence,
      settlement_id: sid,
    },
  };
}

function newSettlementId() {
  const id = globalThis.crypto?.randomUUID?.().replace(/-/g, "").slice(0, 12) ?? Math.random().toString(16).slice(2, 14);
  return `stl-${id}`;
}

function toRecord(value: SettlementInput, id: string, created: string, updated: string): Settlement {
  return {
    settlement_id: id,
    period: value.period,
    business_type: value.business_type,
    ad_network: value.ad_network,
    amount_fen: value.amount_fen,
    settlement_status: value.settlement_status,
    signed_date: value.signed_date,
    paid_date: value.paid_date,
    evidence_ref: value.evidence_ref,
    created_at: created,
    updated_at: updated,
  };
}

export function createSettlement(items: Settlement[], value: SettlementInput, now: string):
  { ok: true; items: Settlement[]; created: Settlement } | { ok: false; message: string } {
  if (value.settlement_status !== "settled") return { ok: false, message: "新建只记已签订。到账用单独操作" };
  const id = value.settlement_id || newSettlementId();
  if (items.some((item) => item.settlement_id === id)) return { ok: false, message: "结算单号已存在" };
  const created = toRecord({ ...value, paid_date: null, settlement_status: "settled" }, id, now, now);
  return { ok: true, items: [...items, created], created };
}

export function markSettlementPaid(items: Settlement[], id: string, paidDate: string, now: string):
  { ok: true; items: Settlement[] } | { ok: false; message: string } {
  if (!DAY.test(paidDate)) return { ok: false, message: "到账日要是 YYYY-MM-DD" };
  const cur = items.find((item) => item.settlement_id === id);
  if (!cur) return { ok: false, message: "找不到结算单" };
  if (cur.settlement_status === "paid") return { ok: false, message: "已经是已到账" };
  const next = items.map((item) => item.settlement_id === id
    ? { ...item, settlement_status: "paid" as const, paid_date: paidDate, updated_at: now }
    : item);
  return { ok: true, items: next };
}

export function parseSettlementImport(text: string, unit: Unit = "fen"):
  { ok: true; rows: SettlementInput[] } | { ok: false; message: string } {
  const raw = text.trim();
  if (!raw) return { ok: false, message: "没有可导入的内容" };
  let records: Record<string, string>[] = [];
  if (raw.startsWith("{") || raw.startsWith("[")) {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return { ok: false, message: "JSON 无法解析" }; }
    const list = Array.isArray(parsed) ? parsed : isObj(parsed) && Array.isArray(parsed.items) ? parsed.items : null;
    if (!list) return { ok: false, message: "需要 {\"items\":[]} 或数组" };
    records = list.map((row) => {
      if (!isObj(row)) return {};
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(row)) if (v != null) out[k] = String(v);
      return out;
    });
  } else {
    const lines = raw.split(/\r?\n/).filter((line) => line.trim());
    const header = lines[0]?.split(",").map((cell) => cell.trim()) ?? [];
    records = lines.slice(1).map((line) => {
      const cells = line.split(",");
      const out: Record<string, string> = {};
      header.forEach((key, i) => { out[key] = (cells[i] ?? "").trim(); });
      return out;
    });
  }
  if (!records.length) return { ok: false, message: "没有数据行" };
  const rows: SettlementInput[] = [];
  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    const amount = row.amount_fen ?? row.amount ?? "";
    const checked = validateSettlementInput({
      period: row.period,
      business_type: row.business_type,
      ad_network: row.ad_network || null,
      amount_text: amount,
      unit: row.amount_fen != null || row.amount == null ? "fen" : unit,
      settlement_status: row.settlement_status,
      signed_date: row.signed_date,
      paid_date: row.paid_date || null,
      evidence_ref: row.evidence_ref,
      settlement_id: row.settlement_id || null,
    });
    if (!checked.ok) return { ok: false, message: `第 ${i + 1} 行：${checked.message}` };
    rows.push(checked.value);
  }
  return { ok: true, rows };
}

export function importSettlements(items: Settlement[], rows: SettlementInput[], now: string):
  { ok: true; items: Settlement[]; inserted: number; updated: number } | { ok: false; message: string } {
  if (!rows.length) return { ok: false, message: "没有数据行" };
  const by = new Map(items.map((item) => [item.settlement_id, item]));
  let inserted = 0;
  let updated = 0;
  for (const row of rows) {
    const id = row.settlement_id || newSettlementId();
    const prev = by.get(id);
    if (prev) updated += 1;
    else inserted += 1;
    by.set(id, toRecord(row, id, prev?.created_at || now, now));
  }
  return { ok: true, items: [...by.values()], inserted, updated };
}

export function shanghaiStamp(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}+08:00`;
}

export function shanghaiToday(now = new Date()): string {
  return shanghaiStamp(now).slice(0, 10);
}
