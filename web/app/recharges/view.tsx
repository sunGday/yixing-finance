"use client";

import { FilterBar } from "@/components/fin/filter-bar";
import { ErrorState, SourceTag, StaleNote, StatusChip } from "@/components/fin/bits";
import { DayBars, Empty, Kpi, Money, PageHeader, Panel, Responsive } from "@/components/fin/ui";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  LIST_PAGE_CAP, agencyTotal, counterparty, listTotal, normalizeRechargeSummary,
  parentInListRequest, parentMonths, parentSeries, rechargeSummaryRequest, visibleParentRows,
} from "@/lib/agency-recharge";
import { forRequestedRange } from "@/lib/pnl";
import { loadParentBundle, loadRechargeBundle } from "@/lib/fx/recharges";
import type { Filters } from "@/lib/filters";
import { formatFen } from "@/lib/format";
import { sum } from "@/lib/select";
import { wantsLive } from "@/lib/source";
import { CHANNEL, LABEL, type Recharge, type SubOwner } from "@/lib/types";
import { useFilters, useHeldRange } from "@/lib/url-state";
import { useLiveMap, useLiveValue } from "@/lib/use-live";
import { cn } from "@/lib/utils";

const TH = "text-xs text-muted-foreground bg-sunken";
const FOOT = "sticky bottom-0 bg-sunken font-medium";
const defaults = { fund: "recharge" as const };

function nameOf(subs: SubOwner[], id: string) {
  return subs.find((s) => s.sub_owner_id === id)?.sub_owner_name;
}

function clock(value: string) {
  return value.slice(5, 16).replace("T", " ");
}

export function RechargesView() {
  const f = useFilters(defaults);
  const fx = loadRechargeBundle(f);
  const liveOn = wantsLive(f.mock);
  const showAgency = f.fund === "recharge" || f.fund === "all";
  const sumReq = rechargeSummaryRequest(f.from, f.to);
  const listReq = parentInListRequest(f.from, f.to);
  const summaryLive = useLiveValue(liveOn && showAgency, sumReq.path, sumReq.params, (raw) => normalizeRechargeSummary(raw, f.from, f.to));
  const listLive = useLiveMap(liveOn && showAgency, [{ key: "rc", path: listReq.path, params: listReq.params }]);
  const held = useHeldRange(listLive.data, f.from, f.to, liveOn && showAgency);
  const fixture = loadParentBundle(f);
  const raw = listLive.data?.rc as Recharge[] | undefined;
  const listReady = !liveOn || (held.from === f.from && held.to === f.to);
  const rows = liveOn ? (listReady && raw ? visibleParentRows(raw, f.from, f.to, f.q) : undefined) : fixture.rows;
  const summary = forRequestedRange(liveOn ? summaryLive.data : fixture.summary, f.from, f.to);
  const fields = f.fund === "cost" || f.fund === "snapshot" ? (["subs", "fund", "q"] as const) : (["fund", "q"] as const);

  return (
    <>
      <FilterBar fields={[...fields]} subOwners={fx.subs} defaults={defaults} mixed={liveOn && (f.fund === "cost" || f.fund === "snapshot")} />
      <div className="px-3 md:px-4 py-3 flex flex-col gap-3">
        {f.mock === "error" ? <ErrorState path="/recharges/summary" message="mock 故障注入" requestId="req-mock-error" />
          : showAgency ? (
            <Agency
              f={f} heldFrom={held.from} heldTo={held.to} summary={summary} rows={rows}
              summaryError={summaryLive.error} listError={listLive.error}
              summaryLoading={liveOn && summaryLive.loading} listLoading={liveOn && listLive.loading}
              refreshing={summaryLive.refreshing || listLive.refreshing}
              onRetrySummary={summaryLive.retry} onRetryList={listLive.retry}
            />
          )           : f.fund === "cost" ? <Costs fx={fx} f={f} liveOn={liveOn} />
          : <Snapshots fx={fx} f={f} liveOn={liveOn} />}
      </div>
    </>
  );
}

function Agency({ f, heldFrom, heldTo, summary, rows, summaryError, listError, summaryLoading, listLoading, refreshing, onRetrySummary, onRetryList }: {
  f: Filters;
  heldFrom: string;
  heldTo: string;
  summary?: ReturnType<typeof normalizeRechargeSummary>;
  rows?: Recharge[];
  summaryError?: { path: string; message: string; requestId?: string };
  listError?: { path: string; message: string; requestId?: string };
  summaryLoading: boolean;
  listLoading: boolean;
  refreshing: boolean;
  onRetrySummary: () => void;
  onRetryList: () => void;
}) {
  const u = f.unit;
  const truncated = (rows?.length ?? 0) >= LIST_PAGE_CAP;
  const total = summary ? agencyTotal(summary) : rows ? listTotal(rows, truncated) : null;
  const fromSummary = !!summary && agencyTotal(summary) != null;
  const series = summary ? parentSeries(summary) : null;
  const months = summary ? parentMonths(summary.items) : [];
  const waiting = !summary && !rows && (summaryLoading || listLoading || refreshing);
  const failed = !summary && !rows && (summaryError || listError);
  return (
    <>
      <PageHeader title="充值流水" unit={u} from={f.from} to={f.to} badge={f.quick === "year" ? "本年" : "只读"} status={refreshing ? "更新中" : null} />
      {summaryError && summary ? <StaleNote message={summaryError.message} onRetry={onRetrySummary} /> : null}
      {listError && rows ? <StaleNote message={listError.message} onRetry={onRetryList} /> : null}
      {f.fund === "all" ? <p className="text-xs text-muted-foreground">资金类型「全部」只显示代理商充值。消耗与余额快照请切换资金类型。</p> : null}
      {waiting ? <Skeleton className="h-64" aria-busy="true" aria-label="充值加载中" /> : failed && summaryError ? <ErrorState {...summaryError} onRetry={onRetrySummary} />
        : failed && listError ? <ErrorState {...listError} onRetry={onRetryList} /> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {summaryLoading && !summary && total == null ? <Skeleton className="h-[92px]" /> : (
              <Kpi size="lg" label="总共充了多少钱" value={formatFen(total, u)} hint={fromSummary ? "一代→二代入账" : total == null ? "总账没有数" : "总账失败，合计是当前列表"} />
            )}
            <Kpi label="笔数" value={summary ? `${summary.count}` : rows ? `${rows.length}` : "—"} hint={summary ? `${summary.from} ~ ${summary.to}` : "当前列表"} />
            <Kpi label="有数天数" value={summary ? `${summary.items.length}` : "—"} hint="总账里有金额的日期" />
          </div>
          <p className="text-xs text-muted-foreground">子户划出不在这张表。合计是代理商充值，口径 omni_parent_in。</p>
          {summary && summary.gap_flags.includes("recharge_source_empty") ? <Empty title="充值源是空的" reason="接口没有一代→二代入账，合计留空。" /> : null}
          {series ? (
            <Panel title="按日" extra={`${summary?.from ?? heldFrom} ~ ${summary?.to ?? heldTo}`}>
              <DayBars series={series} cost={false} />
            </Panel>
          ) : months.length ? (
            <Panel title="分月" extra="只列有入账的月份" flush>
              <Table>
                <TableHeader><TableRow>
                  <TableHead scope="col" className={TH}>月份</TableHead>
                  <TableHead scope="col" className={cn(TH, "text-right")}>金额</TableHead>
                  <TableHead scope="col" className={cn(TH, "text-right")}>笔数</TableHead>
                </TableRow></TableHeader>
                <TableBody>{months.map((month) => (
                  <TableRow key={month.period}>
                    <TableCell className="num text-left">{month.period}</TableCell>
                    <TableCell className="text-right"><Money fen={month.amount_fen} unit={u} /></TableCell>
                    <TableCell className="text-right num">{month.count}</TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            </Panel>
          ) : null}
          {listLoading && !rows ? <Skeleton className="h-40" aria-busy="true" aria-label="代理商充值流水加载中" />
            : listError && !rows ? <ErrorState {...listError} onRetry={onRetryList} />
            : rows && rows.length === 0 ? <Empty title="所选范围没有代理商充值" reason="一代→二代入账是空的。子户划出不在这张表。" />
            : rows ? <Ledger rows={rows} unit={u} total={f.q ? listTotal(rows, truncated) : (fromSummary ? total : listTotal(rows, truncated))} truncated={truncated} filtered={!!f.q} /> : null}
        </>
      )}
    </>
  );
}

function Ledger({ rows, unit, total, truncated, filtered }: { rows: Recharge[]; unit: Filters["unit"]; total: number | null; truncated: boolean; filtered: boolean }) {
  const active = rows.filter((row) => row.status !== "reversed");
  return (
    <Panel title="代理商充值流水" extra={filtered ? "关键词只筛表" : truncated ? `只显示前 ${LIST_PAGE_CAP} 笔，合计以总账为准` : "一代→二代"} flush>
      <Responsive
        table={<Table>
          <TableHeader><TableRow>
            {["充值时间", "业务日", "流水号", "金额", "对端", "渠道", "状态"].map((h, i) => (
              <TableHead key={h} scope="col" className={cn(TH, i === 3 && "text-right")}>{h}</TableHead>
            ))}
          </TableRow></TableHeader>
          <TableBody>{rows.map((row) => (
            <TableRow key={row.txn_id} className={cn(row.status === "reversed" && "line-through text-muted-foreground")}>
              <TableCell className="num text-left">{clock(row.txn_time)}</TableCell>
              <TableCell className="num text-left">{row.biz_date.slice(5)}</TableCell>
              <TableCell><span className="mono">{row.txn_id}</span>{row.txn_id.startsWith("MANUAL-") && <span className="ml-1"><SourceTag s="人工" /></span>}</TableCell>
              <TableCell className="text-right"><Money fen={row.direction === "debit" ? -row.amount_fen : row.amount_fen} unit={unit} /></TableCell>
              <TableCell>{counterparty(row)} <span className="mono text-muted-foreground">{row.to_owner_id}</span></TableCell>
              <TableCell>{row.channel ? CHANNEL[row.channel] ?? row.channel : "—"}</TableCell>
              <TableCell><StatusChip s={row.status} /></TableCell>
            </TableRow>
          ))}</TableBody>
          <TableFooter><TableRow>
            <TableCell colSpan={3} className={FOOT}>{filtered ? `当前列表 ${active.length} 笔` : `总账 · 表内 ${active.length} 笔`}</TableCell>
            <TableCell className={cn(FOOT, "text-right")}><Money fen={total} unit={unit} /></TableCell>
            <TableCell colSpan={3} className={FOOT} />
          </TableRow></TableFooter>
        </Table>}
        cards={<>
          {rows.map((row) => (
            <details key={row.txn_id} className={cn("rounded-lg border bg-surface p-3", row.status === "reversed" && "opacity-70")}>
              <summary className="grid grid-cols-[1fr_auto] gap-1 cursor-pointer">
                <span className="text-xs text-muted-foreground num text-left">{clock(row.txn_time)}</span>
                <StatusChip s={row.status} />
                <span className="text-sm">{counterparty(row)}</span>
                <span className={cn("text-base font-semibold", row.status === "reversed" && "line-through")}><Money fen={row.direction === "debit" ? -row.amount_fen : row.amount_fen} unit={unit} /></span>
              </summary>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted-foreground">流水号</dt><dd className="mono">{row.txn_id}</dd>
                <dt className="text-muted-foreground">对端</dt><dd className="mono">{row.to_owner_id}</dd>
                <dt className="text-muted-foreground">渠道</dt><dd>{row.channel ? CHANNEL[row.channel] ?? row.channel : "—"} · {LABEL.direction[row.direction]}</dd>
              </dl>
            </details>
          ))}
          <div className="sticky bottom-16 rounded-lg border bg-sunken p-3 flex justify-between text-sm font-medium"><span>{filtered ? "当前列表" : "总账"}</span><Money fen={total} unit={unit} /></div>
        </>}
      />
    </Panel>
  );
}

function Costs({ fx, f, liveOn }: { fx: ReturnType<typeof loadRechargeBundle>; f: Filters; liveOn: boolean }) {
  const { cs, subs } = fx;
  const unit = f.unit;
  return (
    <>
      <PageHeader title="消耗" unit={unit} from={f.from} to={f.to} badge="样例" />
      {liveOn ? <p className="text-xs text-muted-foreground">这张子户消耗表仍是样例。区间盈亏看概览。</p> : null}
      {cs.length === 0 ? <Empty title="所选范围无消耗" reason="样例只含 2026-11-02~03" /> : (
        <Responsive
          table={<Table>
            <TableHeader><TableRow>{["归属日", "子户", "消耗", "现金消耗", "赠款消耗", "接口"].map((h, i) => <TableHead key={h} scope="col" className={cn(TH, i >= 2 && i <= 4 && "text-right")}>{h}</TableHead>)}</TableRow></TableHeader>
            <TableBody>{cs.map((r, i) => (
              <TableRow key={`${r.owner_id}-${r.stat_date}-${i}`}>
                <TableCell className="num text-left">{r.stat_date}</TableCell>
                <TableCell>{nameOf(subs, r.owner_id) ?? "—"} <span className="mono text-muted-foreground">{r.owner_id}</span></TableCell>
                <TableCell className="text-right"><Money fen={r.cost_fen} unit={unit} /></TableCell>
                <TableCell className="text-right"><Money fen={r.cash_cost_fen} unit={unit} /></TableCell>
                <TableCell className="text-right"><Money fen={r.grant_cost_fen} unit={unit} /></TableCell>
                <TableCell className="mono text-muted-foreground">{r.source_api ?? "—"}</TableCell>
              </TableRow>
            ))}</TableBody>
            <TableFooter><TableRow>
              <TableCell colSpan={2} className={FOOT}>合计 · {cs.length} 行</TableCell>
              <TableCell className={cn(FOOT, "text-right")}><Money fen={sum(cs, (r) => r.cost_fen)} unit={unit} /></TableCell>
              <TableCell colSpan={3} className={FOOT} />
            </TableRow></TableFooter>
          </Table>}
          cards={cs.map((r, i) => (
            <div key={i} className="rounded-lg border bg-surface p-3 flex justify-between text-sm">
              <span>{r.stat_date} <span className="text-muted-foreground">{nameOf(subs, r.owner_id) ?? r.owner_id}</span></span>
              <span className="font-semibold"><Money fen={r.cost_fen} unit={unit} /></span>
            </div>
          ))}
        />
      )}
    </>
  );
}

function Snapshots({ fx, f, liveOn }: { fx: ReturnType<typeof loadRechargeBundle>; f: Filters; liveOn: boolean }) {
  const { sn, subs } = fx;
  const unit = f.unit;
  return (
    <>
      <PageHeader title="余额快照" unit={unit} from={f.from} to={f.to} badge="样例" />
      {liveOn ? <p className="text-xs text-muted-foreground">余额快照仍是样例。</p> : null}
      {sn.length === 0 ? <Empty title="所选范围无余额快照" reason="样例只含 2026-11-03" /> : (
        <Responsive
          table={<Table>
            <TableHeader><TableRow>{["快照时间", "子户", "总余额", "现金余额", "当日消耗"].map((h, i) => <TableHead key={h} scope="col" className={cn(TH, i >= 2 && "text-right")}>{h}</TableHead>)}</TableRow></TableHeader>
            <TableBody>{sn.map((r, i) => (
              <TableRow key={`${r.owner_id}-${r.snapshot_time}-${i}`}>
                <TableCell className="num text-left">{r.snapshot_time.slice(0, 16).replace("T", " ")}</TableCell>
                <TableCell>{nameOf(subs, r.owner_id) ?? "—"} <span className="mono text-muted-foreground">{r.owner_id}</span></TableCell>
                <TableCell className="text-right"><Money fen={r.total_balance_fen} unit={unit} /></TableCell>
                <TableCell className="text-right"><Money fen={r.cash_bal_fen} unit={unit} /></TableCell>
                <TableCell className="text-right"><Money fen={r.today_total_cost_fen} unit={unit} /></TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>}
          cards={sn.map((r, i) => (
            <div key={i} className="rounded-lg border bg-surface p-3 flex justify-between text-sm">
              <span>{nameOf(subs, r.owner_id) ?? r.owner_id}</span>
              <span className="font-semibold"><Money fen={r.total_balance_fen} unit={unit} /></span>
            </div>
          ))}
        />
      )}
    </>
  );
}
