"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FilterBar } from "@/components/fin/filter-bar";
import { ErrorState, StaleNote, StatusChip } from "@/components/fin/bits";
import { CredentialGapBanner } from "@/components/fin/credential-gap";
import { Banner, Empty, Kpi, Money, PageHeader, Panel } from "@/components/fin/ui";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { clearRevenueCredRetry, CREDENTIALS_HREF, isCredentialGap, takeRevenueCredRetry } from "@/lib/credentials";
import { LoadError } from "@/lib/errors";
import { revenueDefaults, TODAY, type RevenueBasis } from "@/lib/filters";
import { formatFen, type Unit } from "@/lib/format";
import { loadRevenueCards, loadRevenueOverview, loadSettlementFixtures } from "@/lib/fx/revenue-overview";
import { loadRevenueBundle } from "@/lib/fx/revenues";
import {
  basisLabel, cardsRequest, detailRequest, explainGap, hasCredentialGapFlag, networkLabel,
  normalizeCards, normalizeDetail, normalizeOverview, normalizeSettlementList, overviewRequest,
  settlementsRequest, shanghaiToday, type OverviewCard, type RevenueOverview, type Settlement, type SettlementInput,
} from "@/lib/revenue-overview";
import { selectRevenues } from "@/lib/select";
import { wantsLive } from "@/lib/source";
import { liveDropPrefix } from "@/lib/live-cache";
import { patchQuery, useFilters, useHeldRange, useQueryString } from "@/lib/url-state";
import { useLiveValue, type LiveError } from "@/lib/use-live";
import { cn } from "@/lib/utils";
import { RevenueDetail } from "./detail";
import { SettlementsPanel } from "./settlements";

const TH = "text-xs text-muted-foreground bg-sunken";
const FOOT = "sticky bottom-0 bg-sunken font-medium";

function failMessage(error: unknown) {
  if (error instanceof LoadError) return error.request_id ? `${error.message}（request_id: ${error.request_id}）` : error.message;
  return error instanceof Error ? error.message : String(error);
}

function cardHint(card: OverviewCard) {
  if (!card.from || !card.to) return "不含今天";
  if (card.total_fen == null && card.gap_flags.some((flag) => flag.startsWith("settlement_missing"))) return "没有结算单";
  if (card.gap_flags.some((flag) => flag.startsWith("fallback_rt_income"))) return "部分 · 只含穿山甲";
  if (card.source === "mixed") return "预估与结算";
  if (card.source === "settlement_manual" || card.networks.some((row) => row.basis === "settlement")) return "结算";
  return "预估";
}

function sourceText(source: RevenueOverview["source"]) {
  if (source === "gromore_daily") return "GroMore 日报";
  if (source === "rt_income_fallback") return "穿山甲回退";
  if (source === "settlement_manual") return "结算单";
  if (source === "mixed") return "预估与结算";
  return "无来源";
}

function BasisMark({ basis }: { basis: "estimate" | "settlement" }) {
  if (basis === "estimate") return <StatusChip s="estimated" />;
  return <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-xs text-success"><span className="size-1.5 rounded-full bg-current" />结算</span>;
}

function CardStrip({ loading, error, cards, from, to, unit, onRetry }: {
  loading: boolean; error?: LiveError; cards?: { cards: OverviewCard[] }; from: string; to: string; unit: Unit; onRetry?: () => void;
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2" aria-busy="true" aria-label="汇总卡加载中">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[92px]" />)}
      </div>
    );
  }
  if (error) return <ErrorState path={error.path} message={error.message} requestId={error.requestId} onRetry={onRetry} />;
  if (!cards) return null;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      {cards.cards.map((card) => {
        const active = card.from === from && card.to === to;
        return (
          <button key={card.key} type="button" disabled={!card.from || !card.to}
            onClick={() => card.from && card.to && patchQuery({ quick: "custom", from: card.from, to: card.to })}
            className={cn("text-left rounded-lg disabled:cursor-default focus-visible:outline-2 focus-visible:outline-brand", active && "ring-2 ring-brand")}>
            <Kpi size={active ? "lg" : "md"} label={card.label} value={formatFen(card.total_fen, unit)} hint={cardHint(card)} />
          </button>
        );
      })}
    </div>
  );
}

export function RevenuesView() {
  const f = useFilters(revenueDefaults);
  const search = useQueryString();
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const section = q.get("section") === "settlements" ? "settlements" : "overview";
  const detailOpen = q.get("detail") === "1";
  const liveOn = wantsLive(f.mock);
  const ovReq = overviewRequest(f.from, f.to, f.basis);
  const cardReq = cardsRequest(f.basis);
  const setReq = settlementsRequest();
  const detReq = detailRequest(f.from, f.to, "all");
  const cardsLive = useLiveValue(liveOn, cardReq.path, cardReq.params, normalizeCards);
  const overviewLive = useLiveValue(liveOn, ovReq.path, ovReq.params, normalizeOverview);
  const settleLive = useLiveValue(liveOn && section === "settlements", setReq.path, setReq.params, normalizeSettlementList);
  const detailLive = useLiveValue(liveOn && detailOpen && section === "overview", detReq.path, detReq.params, normalizeDetail);
  const [credRetry, setCredRetry] = useState(false);
  const [localBills, setLocalBills] = useState<Settlement[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => { setCredRetry(takeRevenueCredRetry()); }, []);
  useEffect(() => {
    if (!credRetry || !overviewLive.data) return;
    clearRevenueCredRetry();
    setCredRetry(false);
  }, [credRetry, overviewLive.data]);

  const overview = liveOn ? overviewLive.data : loadRevenueOverview(f.from, f.to, f.basis);
  const cards = liveOn ? cardsLive.data : loadRevenueCards(f.basis);
  const bills = liveOn ? (settleLive.data ?? []) : (localBills ?? loadSettlementFixtures());
  const detailHeld = useHeldRange(detailLive.data, f.from, f.to, liveOn && detailOpen);
  const detailRows = detailOpen
    ? selectRevenues(liveOn ? (detailLive.data?.items ?? []) : loadRevenueBundle(f).rv, { ...f, from: detailHeld.from, to: detailHeld.to })
    : [];

  async function write(path: string, method: string, body: unknown, done: string) {
    setBusy(true);
    setNotice(null);
    try {
      const { apiSend } = await import("@/lib/api-client");
      await apiSend(path, { method, body });
      liveDropPrefix("/revenues/overview");
      liveDropPrefix("/settlements");
      settleLive.retry();
      overviewLive.retry();
      cardsLive.retry();
      setNotice(done);
      return true;
    } catch (error) {
      setNotice(failMessage(error));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <FilterBar fields={["network", "basis"]} subOwners={[]} defaults={revenueDefaults} />
      <div className="px-3 md:px-4 py-3 flex flex-col gap-3">
        {f.mock === "error" ? <ErrorState path="/revenues/overview" message="mock 故障注入" requestId="req-mock-error" /> : <>
          <PageHeader
            title="收入" unit={f.unit} from={f.from} to={f.to} badge={f.quick === "year" ? "本年" : null}
            status={overviewLive.refreshing || cardsLive.refreshing || settleLive.refreshing || detailLive.refreshing ? "更新中" : null}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div role="tablist" aria-label="收入内容" className="inline-flex rounded-md border bg-sunken p-0.5">
              <button type="button" role="tab" aria-selected={section === "overview"} onClick={() => patchQuery({ section: null })}
                className={cn("h-7 px-3 text-xs rounded", section === "overview" ? "bg-surface text-brand font-medium shadow-sm" : "text-muted-foreground")}>总览</button>
              <button type="button" role="tab" aria-selected={section === "settlements"} onClick={() => patchQuery({ section: "settlements" })}
                className={cn("h-7 px-3 text-xs rounded", section === "settlements" ? "bg-surface text-brand font-medium shadow-sm" : "text-muted-foreground")}>结算单</button>
            </div>
            <span className="text-[11px] text-muted-foreground">口径 {basisLabel(f.basis as RevenueBasis)}{f.quick === "year" ? " · 1 月 1 日至昨日" : ""}</span>
          </div>
          {section === "settlements" ? (
            <>
              {settleLive.error && bills.length ? <StaleNote message={settleLive.error.message} onRetry={settleLive.retry} /> : null}
              <SettlementsPanel
                unit={f.unit} live={liveOn} loading={liveOn && settleLive.loading && bills.length === 0} error={bills.length ? undefined : settleLive.error}
                bills={bills} busy={busy} notice={notice} paidDateDefault={liveOn ? shanghaiToday() : TODAY}
                now={liveOn ? "" : `${TODAY}T12:00:00+08:00`} onRetry={settleLive.retry} onChange={setLocalBills}
                onLiveCreate={(value) => write("/settlements", "POST", settlementBody(value), "已记为已签订")}
                onLivePaid={(id, paidDate) => write(`/settlements/${encodeURIComponent(id)}`, "PATCH", { settlement_status: "paid", paid_date: paidDate }, "已标为到账")}
                onLiveImport={(rows) => write("/settlements/import", "POST", { items: rows.map(settlementBody) }, "已导入")}
              />
            </>
          ) : (
            <>
              {overview && overview.gap_flags.length > 0 ? <GapList flags={overview.gap_flags} showSync={credRetry} /> : null}
              {overviewLive.error && overview ? <StaleNote message={overviewLive.error.message} onRetry={overviewLive.retry} /> : null}
              {liveOn && overviewLive.loading && !overview ? <Skeleton className="h-64" aria-busy="true" aria-label="分网络表加载中" />
                : liveOn && overviewLive.error && !overview ? (
                  isCredentialGap(overviewLive.error)
                    ? <CredentialGapBanner message={overviewLive.error.message} requestId={overviewLive.error.requestId} gapFlags={overviewLive.error.gapFlags} onRetry={overviewLive.retry} showSync={credRetry} />
                    : <ErrorState path={overviewLive.error.path} message={overviewLive.error.message} requestId={overviewLive.error.requestId} onRetry={overviewLive.retry} />
                ) : overview ? (
                  <>
                    <NetworkTable overview={overview} unit={f.unit} network={f.network} refreshing={overviewLive.refreshing} />
                    <MonthTable overview={overview} unit={f.unit} />
                  </>
                ) : null}
              <section className="flex flex-col gap-2" aria-busy={cardsLive.refreshing || undefined}>
                <h2 className="text-[13px] font-medium">短区间</h2>
                <p className="text-[11px] text-muted-foreground">点一张卡会离开本年，改看那一段。再点「本年」回到年度合计。</p>
                <CardStrip loading={liveOn && cardsLive.loading && !cards} error={cards ? undefined : cardsLive.error} cards={cards} from={f.from} to={f.to} unit={f.unit} onRetry={cardsLive.retry} />
                {cardsLive.error && cards ? <StaleNote message={cardsLive.error.message} onRetry={cardsLive.retry} /> : null}
              </section>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" onClick={() => patchQuery({ detail: detailOpen ? null : "1" })}>
                  {detailOpen ? "收起明细" : "明细下钻"}
                </Button>
                <span className="text-[11px] text-muted-foreground">产品 / 代码位日明细，默认不展开。总览仍是分网络合计。</span>
              </div>
              {detailOpen ? (
                <RevenueDetail
                  rows={detailRows} unit={f.unit} loading={liveOn && detailLive.loading && detailRows.length === 0}
                  refreshing={liveOn && detailLive.refreshing}
                  error={detailRows.length ? undefined : detailLive.error}
                  onRetry={detailLive.retry} gapFlags={detailLive.data?.gap_flags}
                  filteredOut={f.network === "kuaishou" || f.network === "gm_adx"}
                />
              ) : null}
              {detailOpen && detailLive.error && detailRows.length ? <StaleNote message={detailLive.error.message} onRetry={detailLive.retry} /> : null}
            </>
          )}
        </>}
      </div>
    </>
  );
}

function settlementBody(value: SettlementInput) {
  const body: Record<string, unknown> = {
    period: value.period,
    business_type: value.business_type,
    ad_network: value.ad_network,
    amount_fen: value.amount_fen,
    settlement_status: value.settlement_status,
    signed_date: value.signed_date,
    evidence_ref: value.evidence_ref,
  };
  if (value.paid_date) body.paid_date = value.paid_date;
  if (value.settlement_id) body.settlement_id = value.settlement_id;
  return body;
}

function GapList({ flags, showSync }: { flags: string[]; showSync?: boolean }) {
  const partial = flags.some((flag) => flag.startsWith("fallback_rt_income") || flag.startsWith("credential_missing") || flag === "gromore_fetch_failed" || flag.startsWith("network_unmapped"));
  return (
    <div role="status" className={cn("rounded-md px-3 py-2 text-xs", partial ? "bg-warning-bg text-warning" : "bg-info-bg text-info")}>
      <ul className="flex flex-col gap-1">
        {flags.map((flag) => <li key={flag}>{explainGap(flag)} <span className="mono">· {flag}</span></li>)}
      </ul>
      {hasCredentialGapFlag(flags) ? (
        <Link href={CREDENTIALS_HREF} className={cn(buttonVariants({ size: "sm", variant: "outline" }), "mt-2 h-8")}>去录入渠道凭证</Link>
      ) : null}
      {showSync ? <Banner tone="info">凭证已交给财务 API。总览要等服务端热加载后才会变。</Banner> : null}
    </div>
  );
}

function MonthTable({ overview, unit }: { overview: RevenueOverview; unit: Unit }) {
  if (!overview.by_month.length) return null;
  return (
    <Panel title="分月" extra={`${overview.from ?? "—"} ~ ${overview.to ?? "—"}`} flush>
      <div className="hidden md:block">
        <Table>
          <TableHeader><TableRow>
            <TableHead scope="col" className={TH}>月份</TableHead>
            <TableHead scope="col" className={cn(TH, "text-right")}>金额</TableHead>
            <TableHead scope="col" className={TH}>口径</TableHead>
            <TableHead scope="col" className={cn(TH, "text-right")}>与结算差额</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {overview.by_month.map((month) => (
              <TableRow key={month.period}>
                <TableCell className="num text-left">{month.period}</TableCell>
                <TableCell className="text-right"><Money fen={month.amount_fen} unit={unit} /></TableCell>
                <TableCell><BasisMark basis={month.basis} /></TableCell>
                <TableCell className="text-right"><Money fen={month.diff_fen} unit={unit} signed /></TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter><TableRow>
            <TableCell className={FOOT}>合计</TableCell>
            <TableCell className={cn(FOOT, "text-right")}><Money fen={overview.total_fen} unit={unit} /></TableCell>
            <TableCell className={FOOT} colSpan={2} />
          </TableRow></TableFooter>
        </Table>
      </div>
      <div className="md:hidden flex flex-col gap-2 p-3">
        {overview.by_month.map((month) => (
          <div key={month.period} className="rounded-lg border p-3 flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground num">{month.period}</span>
            <span className="font-semibold"><Money fen={month.amount_fen} unit={unit} /></span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function NetworkTable({ overview, unit, network, refreshing = false }: { overview: RevenueOverview; unit: Unit; network: string; refreshing?: boolean }) {
  const rows = overview.networks.filter((row) => network === "all" || row.ad_network === network);
  const showApi = rows.some((row) => row.api_amount_fen != null) || overview.api_total_fen != null;
  const missing = overview.gap_flags.some((flag) => flag.startsWith("settlement_missing"));
  const foot = network === "all"
    ? overview.total_fen
    : rows.some((row) => row.amount_fen == null) ? null : rows.reduce((sum, row) => sum + (row.amount_fen ?? 0), 0);
  const apiFoot = network === "all" ? overview.api_total_fen : null;
  return (
    <Panel title="分广告网络" extra={refreshing ? "更新中" : sourceText(overview.source)} flush>
      <div className="px-3 py-2 flex items-end justify-between gap-3 border-b" aria-busy={refreshing || undefined}>
        <div>
          <div className="text-[11px] text-muted-foreground">合计 · {overview.from ?? "—"} ~ {overview.to ?? "—"}</div>
          <div className="text-xl font-semibold num leading-tight">{formatFen(overview.total_fen, unit)}</div>
        </div>
        {network !== "all" ? <p className="text-[11px] text-muted-foreground text-right">表格已按网络筛选。合计仍是该区间总额。</p> : <p className="text-[11px] text-muted-foreground text-right">GroMore 预估按网络相加。日明细不在这张表里。</p>}
      </div>
      {rows.length === 0 ? (
        <div className="p-3">
          <Empty
            title={missing ? "没有结算单" : "这个区间没有收入"}
            reason={missing ? "按结算口径，这个月没有已签订的单。金额留空，不是 0。可切到预估。" : "日期内没有预估，或来源没有返回网络。"}
          />
        </div>
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <TableHeader><TableRow>
                <TableHead scope="col" className={TH}>广告网络</TableHead>
                <TableHead scope="col" className={cn(TH, "text-right")}>金额</TableHead>
                {showApi ? <TableHead scope="col" className={cn(TH, "text-right")}>API 收益</TableHead> : null}
                <TableHead scope="col" className={TH}>口径</TableHead>
                <TableHead scope="col" className={TH}>结算状态</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={`${row.ad_network ?? "total"}-${row.basis}-${row.settlement_status ?? "none"}`}>
                    <TableCell>{networkLabel(row.ad_network)}</TableCell>
                    <TableCell className="text-right"><Money fen={row.amount_fen} unit={unit} /></TableCell>
                    {showApi ? <TableCell className="text-right"><Money fen={row.api_amount_fen} unit={unit} /></TableCell> : null}
                    <TableCell><BasisMark basis={row.basis} /></TableCell>
                    <TableCell>{row.settlement_status ? <StatusChip s={row.settlement_status} /> : <span className="text-xs text-muted-foreground">无结算单</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter><TableRow>
                <TableCell className={FOOT}>合计</TableCell>
                <TableCell className={cn(FOOT, "text-right")}><Money fen={foot} unit={unit} /></TableCell>
                {showApi ? <TableCell className={cn(FOOT, "text-right")}><Money fen={apiFoot} unit={unit} /></TableCell> : null}
                <TableCell className={FOOT} colSpan={2} />
              </TableRow></TableFooter>
            </Table>
          </div>
          <div className="md:hidden flex flex-col gap-2 p-3">
            {rows.map((row) => (
              <div key={`${row.ad_network ?? "total"}-m`} className="rounded-lg border p-3 grid grid-cols-[1fr_auto] gap-1">
                <span className="text-xs text-muted-foreground">{networkLabel(row.ad_network)}</span>
                <BasisMark basis={row.basis} />
                <span className="font-semibold"><Money fen={row.amount_fen} unit={unit} /></span>
                {row.settlement_status ? <StatusChip s={row.settlement_status} /> : <span className="text-xs text-muted-foreground">无结算单</span>}
              </div>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}
