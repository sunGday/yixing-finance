"use client";

import Link from "next/link";
import { useRef } from "react";
import { FilterBar } from "@/components/fin/filter-bar";
import { ErrorState, StaleNote, StatusChip } from "@/components/fin/bits";
import { Banner, Kpi, Money, PageHeader, Panel } from "@/components/fin/ui";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { agencyTotal, normalizeRechargeSummary, rechargeSummaryRequest, type RechargeSummary } from "@/lib/agency-recharge";
import { overviewDefaults, type Filters } from "@/lib/filters";
import { formatFen } from "@/lib/format";
import { loadOverviewModel } from "@/lib/fx/overview";
import { clipMonth, incomeBasis, normalizeLiveCosts, profitAndLoss, sliceCostWindow, type CostWindow } from "@/lib/pnl";
import { explainGap, networkLabel, normalizeOverview, overviewRequest, type RevenueOverview } from "@/lib/revenue-overview";
import { wantsLive } from "@/lib/source";
import { hrefFor, useFilters } from "@/lib/url-state";
import { useLiveValue, type LiveError } from "@/lib/use-live";
import { cn } from "@/lib/utils";

const TH = "text-xs text-muted-foreground bg-sunken";
const linkCls = "block h-full rounded-lg focus-visible:outline-2 focus-visible:outline-brand";

type Trio = {
  overview: RevenueOverview | null;
  costs: CostWindow | null;
  summary: RechargeSummary | null;
};

function sameRange(
  a: { from: string | null; to: string | null } | null | undefined,
  b: { from: string | null; to: string | null } | null | undefined,
) {
  return !!a && !!b && !!a.from && !!a.to && !!b.from && !!b.to && a.from === b.from && a.to === b.to;
}

/** 收入和消耗都换成新区间之后才一起换。一边先到，仍显示上一对。 */
function useStableTrio(overview?: RevenueOverview, costs?: CostWindow, summary?: RechargeSummary): Trio {
  const held = useRef<Trio | null>(null);
  if (overview && costs && sameRange(overview, costs)) {
    const summaryAligned = summary && sameRange(summary, overview)
      ? summary
      : held.current?.summary && sameRange(held.current.summary, overview) ? held.current.summary : null;
    held.current = { overview, costs, summary: summaryAligned };
    return held.current;
  }
  if (held.current) return held.current;
  return { overview: overview ?? null, costs: costs ?? null, summary: summary ?? null };
}

export function OverviewView() {
  const f = useFilters(overviewDefaults);
  const liveOn = wantsLive(f.mock);
  const model = loadOverviewModel(f);
  const ovReq = overviewRequest(f.from, f.to, f.basis);
  const costParams = { start_date: f.from, end_date: f.to };
  const sumReq = rechargeSummaryRequest(f.from, f.to);
  const overviewLive = useLiveValue(liveOn, ovReq.path, ovReq.params, normalizeOverview);
  const costLive = useLiveValue(liveOn, "/costs", costParams, (raw) => normalizeLiveCosts(raw, f.from, f.to));
  const summaryLive = useLiveValue(liveOn, sumReq.path, sumReq.params, (raw) => normalizeRechargeSummary(raw, f.from, f.to));
  const liveTrio = useStableTrio(overviewLive.data, costLive.data, summaryLive.data);
  const trio = liveOn ? liveTrio : { overview: model.overview, costs: model.costs, summary: model.summary };
  const refreshing = overviewLive.refreshing || costLive.refreshing || summaryLive.refreshing;
  const loading = liveOn && !trio.overview && !trio.costs && (overviewLive.loading || costLive.loading);
  const firstError = overviewLive.error ?? costLive.error ?? summaryLive.error;

  return (
    <>
      <FilterBar fields={["basis"]} subOwners={[]} defaults={overviewDefaults} />
      <div className="px-3 md:px-4 py-3 flex flex-col gap-3">
        {f.mock === "error" ? <ErrorState path="/revenues/overview" message="mock 故障注入" requestId="req-mock-error" /> : (
          <>
            <PageHeader
              title="概览" unit={f.unit} from={f.from} to={f.to}
              badge={f.quick === "year" ? "本年" : "只读"}
              status={refreshing ? "更新中" : null}
            />
            <p className="text-xs text-muted-foreground">
              收入 − 消耗 = 盈亏
              {f.quick === "year" ? " · 本年看到昨天" : ""}
              {trio.overview ? ` · 口径 ${incomeBasis(trio.overview.by_month, trio.overview.basis)}` : ""}
            </p>
            {overviewLive.error && trio.overview ? <StaleNote message={overviewLive.error.message} onRetry={overviewLive.retry} /> : null}
            {costLive.error && trio.costs ? <StaleNote message={costLive.error.message} onRetry={costLive.retry} /> : null}
            {summaryLive.error && trio.summary ? <StaleNote message={summaryLive.error.message} onRetry={summaryLive.retry} /> : null}
            {loading ? <HeroSkeleton /> : !trio.overview && !trio.costs && firstError ? (
              <ErrorState path={firstError.path} message={firstError.message} requestId={firstError.requestId} onRetry={() => { overviewLive.retry(); costLive.retry(); summaryLive.retry(); }} />
            ) : (
              <Body f={f} trio={trio} overviewError={overviewLive.error} costError={costLive.error} onRetryOverview={overviewLive.retry} onRetryCost={costLive.retry} />
            )}
          </>
        )}
      </div>
    </>
  );
}

function HeroSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2" aria-busy="true" aria-label="盈亏加载中">
      {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[104px]" />)}
    </div>
  );
}

function Body({ f, trio, overviewError, costError, onRetryOverview, onRetryCost }: {
  f: Filters;
  trio: Trio;
  overviewError?: LiveError;
  costError?: LiveError;
  onRetryOverview: () => void;
  onRetryCost: () => void;
}) {
  const u = f.unit;
  const { overview, costs, summary } = trio;
  const pnl = profitAndLoss(overview, costs);
  const basis = overview ? incomeBasis(overview.by_month, overview.basis) : "—";
  const recharge = summary ? agencyTotal(summary) : null;
  const aligned = sameRange(overview, costs);
  const partial = aligned && costs && costs.total_fen == null && costs.partial_fen != null;
  return (
    <>
      {overview && overview.gap_flags.length > 0 ? (
        <Banner tone={overview.gap_flags.every((flag) => flag.startsWith("today_excluded")) ? "info" : "warning"}>
          {overview.gap_flags.map(explainGap).join(" · ")}
        </Banner>
      ) : null}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2" aria-label="盈亏">
        {overview ? (
          <Link href={hrefFor("/revenues", f)} className={linkCls}>
            <Kpi size="lg" label={`收入 · ${basis}`} value={formatFen(overview.total_fen, u)} hint={`${overview.from ?? "—"} ~ ${overview.to ?? "—"} · 点进收入`} />
          </Link>
        ) : overviewError ? <ErrorState path={overviewError.path} message={overviewError.message} requestId={overviewError.requestId} onRetry={onRetryOverview} /> : <Skeleton className="h-[104px]" />}
        {costs ? (
          <Kpi size="lg" label="消耗" value={formatFen(costs.total_fen, u)} hint={costs.total_fen == null ? (costs.gap ?? "消耗没有数") : `${costs.from} ~ ${costs.to}`} />
        ) : costError ? <ErrorState path={costError.path} message={costError.message} requestId={costError.requestId} onRetry={onRetryCost} /> : <Skeleton className="h-[104px]" />}
        <Kpi size="lg" label="盈亏" value={formatFen(pnl.fen, u, true)} tone={pnl.tone} hint={pnl.text} />
      </div>
      {partial && costs ? <Banner tone="warning">已返回消耗 {formatFen(costs.partial_fen, u)}。{costs.gap}，没有算进盈亏。</Banner> : null}
      <div className="max-w-sm">
        <Link href={hrefFor("/recharges", f, { fund: "recharge" })} className={linkCls}>
          <Kpi size="sm" label="代理商充值" value={formatFen(recharge, u)} hint={summary ? `${summary.from} ~ ${summary.to} · 一代→二代` : "总账还没到"} />
        </Link>
      </div>
      {overview ? (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-2">
          <div className="lg:col-span-3">
            <MonthTable overview={overview} costs={aligned ? costs : null} unit={u} />
          </div>
          <div className="lg:col-span-2">
            <Panel title="分网络" extra={basis} flush>
              {overview.networks.length === 0 ? <p className="p-3 text-xs text-muted-foreground">这个区间没有分网络金额。</p> : (
                <ul className="divide-y">
                  {overview.networks.map((row) => (
                    <li key={`${row.ad_network ?? "total"}-${row.basis}`} className="flex items-center justify-between gap-2 px-3 py-2">
                      <span className="text-sm">{networkLabel(row.ad_network)} <StatusChip s={row.basis === "estimate" ? "estimated" : "settled"} /></span>
                      <Money fen={row.amount_fen} unit={u} />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      ) : null}
    </>
  );
}

function MonthTable({ overview, costs, unit }: { overview: RevenueOverview; costs: CostWindow | null; unit: Filters["unit"] }) {
  const months = overview.by_month.filter((month) => month.amount_fen !== 0);
  if (!months.length) return null;
  return (
    <Panel title="分月" extra={`${overview.from ?? "—"} ~ ${overview.to ?? "—"} · 只列有金额的月份`} flush>
      <Table>
        <TableHeader><TableRow>
          {["月份", "收入", "口径", "消耗", "盈亏"].map((h, i) => (
            <TableHead key={h} scope="col" className={cn(TH, i !== 0 && i !== 2 && "text-right")}>{h}</TableHead>
          ))}
        </TableRow></TableHeader>
        <TableBody>
          {months.map((month) => {
            const clip = costs ? clipMonth(month.period, costs.from, costs.to) : null;
            const monthCost = clip && costs ? sliceCostWindow(costs, clip[0], clip[1]) : null;
            const monthPnl = profitAndLoss(
              { total_fen: month.amount_fen, from: clip?.[0] ?? null, to: clip?.[1] ?? null },
              monthCost,
            );
            return (
              <TableRow key={month.period}>
                <TableCell className="num text-left">{month.period}</TableCell>
                <TableCell className="text-right"><Money fen={month.amount_fen} unit={unit} /></TableCell>
                <TableCell>{month.basis === "estimate" ? "预估" : "结算"}</TableCell>
                <TableCell className="text-right"><Money fen={monthCost?.total_fen} unit={unit} /></TableCell>
                <TableCell className="text-right"><Money fen={monthPnl.fen} unit={unit} signed tone={monthPnl.fen != null && monthPnl.fen < 0} /></TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Panel>
  );
}
