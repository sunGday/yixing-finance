"use client";

import Link from "next/link";
import { FilterBar } from "@/components/fin/filter-bar";
import { ErrorState, StaleNote, StatusChip } from "@/components/fin/bits";
import { Banner, Kpi, Money, PageHeader, Panel } from "@/components/fin/ui";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { agencyTotal, normalizeRechargeSummary, rechargeSummaryRequest, type RechargeSummary } from "@/lib/agency-recharge";
import { overviewDefaults, type Filters } from "@/lib/filters";
import { formatFen } from "@/lib/format";
import { loadOverviewModel } from "@/lib/fx/overview";
import { clipMonth, forRequestedRange, incomeBasis, normalizeLiveCosts, profitAndLoss, shownCost, sliceCostWindow, type CostWindow } from "@/lib/pnl";
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
  const trio: Trio = {
    overview: forRequestedRange(liveOn ? overviewLive.data : model.overview, f.from, f.to) ?? null,
    costs: forRequestedRange(liveOn ? costLive.data : model.costs, f.from, f.to) ?? null,
    summary: forRequestedRange(liveOn ? summaryLive.data : model.summary, f.from, f.to) ?? null,
  };
  const refreshing = overviewLive.refreshing || costLive.refreshing || summaryLive.refreshing;
  const pending = liveOn && (overviewLive.loading || overviewLive.refreshing || costLive.loading || costLive.refreshing);
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
            {!trio.overview && !trio.costs && pending ? <HeroSkeleton /> : !trio.overview && !trio.costs && firstError ? (
              <ErrorState path={firstError.path} message={firstError.message} requestId={firstError.requestId} onRetry={() => { overviewLive.retry(); costLive.retry(); summaryLive.retry(); }} />
            ) : (
              <Body f={f} trio={trio} pending={pending} overviewError={overviewLive.error} costError={costLive.error} onRetryOverview={overviewLive.retry} onRetryCost={costLive.retry} />
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

function Body({ f, trio, pending, overviewError, costError, onRetryOverview, onRetryCost }: {
  f: Filters;
  trio: Trio;
  pending: boolean;
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
  const costShown = costs ? shownCost(costs) : null;
  const fetchFailed = overview?.gap_flags.includes("gromore_fetch_failed");
  return (
    <>
      {fetchFailed ? <Banner tone="warning">收入拉取失败</Banner> : null}
      {overview && overview.gap_flags.some((flag) => flag !== "gromore_fetch_failed") ? (
        <Banner tone={overview.gap_flags.every((flag) => flag.startsWith("today_excluded")) ? "info" : "warning"}>
          {overview.gap_flags.filter((flag) => flag !== "gromore_fetch_failed").map(explainGap).join(" · ")}
        </Banner>
      ) : null}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2" aria-label="盈亏">
        {overview ? (
          <Link href={hrefFor("/revenues", f)} className={linkCls}>
            <Kpi size="lg" label={`收入 · ${basis}`} value={formatFen(overview.total_fen, u)} hint={`${overview.from ?? "—"} ~ ${overview.to ?? "—"} · 点进收入`} />
          </Link>
        ) : overviewError && !pending ? <ErrorState path={overviewError.path} message={overviewError.message} requestId={overviewError.requestId} onRetry={onRetryOverview} /> : <Skeleton className="h-[104px]" aria-busy="true" aria-label="收入更新中" />}
        {costs && costShown ? (
          <Kpi size="lg" label={costShown.partial ? "消耗 · 部分" : "消耗"} value={formatFen(costShown.fen, u)} hint={costShown.partial ? `覆盖 ${costs.covered}/${costs.expected} 天` : `${costs.from} ~ ${costs.to}`} />
        ) : costError && !pending ? <ErrorState path={costError.path} message={costError.message} requestId={costError.requestId} onRetry={onRetryCost} /> : <Skeleton className="h-[104px]" aria-busy="true" aria-label="消耗更新中" />}
        <Kpi size="lg" label="盈亏" value={formatFen(pnl.fen, u, true)} tone={pnl.tone} hint={pnl.text} />
      </div>
      {costShown?.partial && costs ? <Banner tone="warning">消耗覆盖 {costs.covered}/{costs.expected} 天{pnl.fen != null ? "。盈亏只用已覆盖整天的月份：这些月的收入 − 这些月的消耗" : ""}。</Banner> : null}
      <div className="max-w-sm">
        <Link href={hrefFor("/recharges", f, { fund: "recharge" })} className={linkCls}>
          <Kpi size="sm" label="代理商充值" value={formatFen(recharge, u)} hint={summary ? `${summary.from} ~ ${summary.to} · 一代→二代` : "总账还没到"} />
        </Link>
      </div>
      {overview ? (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-2">
          <div className="lg:col-span-3">
            <MonthTable overview={overview} costs={costs} unit={u} />
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
            const monthShown = monthCost ? shownCost(monthCost) : null;
            const monthPnl = profitAndLoss(
              { total_fen: month.amount_fen, from: clip?.[0] ?? null, to: clip?.[1] ?? null },
              monthCost,
            );
            return (
              <TableRow key={month.period}>
                <TableCell className="num text-left">{month.period}</TableCell>
                <TableCell className="text-right"><Money fen={month.amount_fen} unit={unit} /></TableCell>
                <TableCell>{month.basis === "estimate" ? "预估" : "结算"}</TableCell>
                <TableCell className="text-right"><Money fen={monthShown?.fen ?? null} unit={unit} />{monthShown?.partial ? <span className="ml-1 text-[11px] text-muted-foreground">部分</span> : null}</TableCell>
                <TableCell className="text-right"><Money fen={monthPnl.fen} unit={unit} signed tone={monthPnl.fen != null && monthPnl.fen < 0} /></TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Panel>
  );
}
