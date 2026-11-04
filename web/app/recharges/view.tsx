"use client";

import { FilterBar } from "@/components/fin/filter-bar";
import { ErrorState, SourceTag, StatusChip } from "@/components/fin/bits";
import { PageSkeleton } from "@/components/fin/page-skeleton";
import { DayBars, Empty, Kpi, Money, PageHeader, Panel, Responsive } from "@/components/fin/ui";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { loadRechargeBundle } from "@/lib/fx/recharges";
import type { Filters } from "@/lib/filters";
import { formatFen } from "@/lib/format";
import { chartDays, normalizeRecharges, rangeParams, selectRecharges, sum } from "@/lib/select";
import { wantsLive } from "@/lib/source";
import { CHANNEL, LABEL, type Recharge, type SubOwner } from "@/lib/types";
import { useFilters } from "@/lib/url-state";
import { useLiveMap } from "@/lib/use-live";
import { cn } from "@/lib/utils";

const TH = "text-xs text-muted-foreground bg-sunken";
const FOOT = "sticky bottom-0 bg-sunken font-medium";
const defaults = { fund: "recharge" as const };

function nameOf(subs: SubOwner[], id: string) {
  return subs.find((s) => s.sub_owner_id === id)?.sub_owner_name;
}

export function RechargesView() {
  const f = useFilters(defaults);
  const fx = loadRechargeBundle(f);
  const liveOn = wantsLive(f.mock);
  const live = useLiveMap(liveOn, [
    { key: "rc", path: "/recharges", params: { ...rangeParams(f), keyword: f.q || undefined } },
  ]);
  const fund = f.fund === "all" ? "recharge" : f.fund;
  return (
    <>
      <FilterBar fields={["subs", "fund", "q"]} subOwners={fx.subs} defaults={defaults} />
      <div className="px-3 md:px-4 py-3 flex flex-col gap-3">
        {f.mock === "error" ? <ErrorState path="/recharges" message="mock 故障注入" requestId="req-mock-error" />
          : liveOn && live.loading ? <PageSkeleton />
          : liveOn && live.error ? <ErrorState {...live.error} onRetry={live.retry} />
          : <Content f={f} fx={fx} fund={fund} liveOn={liveOn} rc={liveOn && live.data ? selectRecharges(normalizeRecharges(live.data.rc as Recharge[]), f) : fx.rc} />}
      </div>
    </>
  );
}

function Content({ f, fx, fund, rc, liveOn }: { f: Filters; fx: ReturnType<typeof loadRechargeBundle>; fund: Filters["fund"]; rc: Recharge[]; liveOn: boolean }) {
  const { cs, sn, subs } = fx;
  const u = f.unit;
  const liveRows = rc.filter((r) => r.status !== "reversed");
  const credit = sum(liveRows.filter((r) => r.direction === "credit"), (r) => r.amount_fen);
  const debit = sum(liveRows.filter((r) => r.direction === "debit"), (r) => r.amount_fen);
  const days = chartDays(f.from, f.to);
  const widened = !liveOn && days[0] < f.from;
  const chartFx = widened ? loadRechargeBundle({ ...f, from: days[0], to: f.to }) : { rc, cs };
  const series = days.map((day) => ({
    day,
    recharge: sum(chartFx.rc.filter((r) => r.biz_date === day && r.direction === "credit" && r.status !== "reversed"), (r) => r.amount_fen),
    cost: sum(chartFx.cs.filter((r) => r.stat_date === day), (r) => r.cost_fen),
  }));
  return (
    <>
      <PageHeader title="充值流水" unit={u} from={f.from} to={f.to} mock={f.mock} mixed />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Kpi size="lg" label="区间充值" value={formatFen(credit, u)} hint="不含已冲正" />
        <Kpi label="笔数" value={`${rc.length}`} hint={`有效 ${liveRows.length}`} />
        <Kpi label="扣回合计" value={formatFen(debit ? -debit : 0, u)} />
        <Kpi label="区间消耗" value={formatFen(sum(cs, (r) => r.cost_fen), u)} />
      </div>
      {f.fund === "all" && <p className="text-xs text-muted-foreground">资金类型「全部」：表为充值。消耗与余额快照请切换资金类型。</p>}
      {fund === "recharge" && (
        <Panel title="按日" extra={widened ? "近 7 日，止于区间末日 · 充值 vs 消耗" : "充值 vs 消耗"}>
          <DayBars series={series} />
        </Panel>
      )}
      {fund === "recharge" && (rc.length === 0 ? <Empty title="所选范围无充值流水" reason="所选日期无充值，或子户未同步（fixtures 仅含 2026-11-01~03）" /> :
        <Responsive
          table={<Table>
            <TableHeader><TableRow>
              {["充值时间", "业务日", "流水号", "入账子户", "金额", "方向", "渠道", "出资方", "充值后余额", "状态", "证据"].map((h, i) => (
                <TableHead key={h} scope="col" className={cn(TH, (i === 4 || i === 8) && "text-right")}>{h}</TableHead>
              ))}
            </TableRow></TableHeader>
            <TableBody>{rc.map((r) => (
              <TableRow key={r.txn_id} className={cn(r.status === "reversed" && "line-through text-muted-foreground")}>
                <TableCell className="num text-left">{r.txn_time.slice(5, 16).replace("T", " ")}</TableCell>
                <TableCell className="num text-left">{r.biz_date.slice(5)}</TableCell>
                <TableCell><span className="mono">{r.txn_id}</span>{r.txn_id.startsWith("MANUAL-") && <span className="ml-1"><SourceTag s="人工" /></span>}</TableCell>
                <TableCell>{r.sub_owner_name} <span className="mono text-muted-foreground">{r.to_owner_id}</span></TableCell>
                <TableCell className="text-right"><Money fen={r.direction === "debit" ? -r.amount_fen : r.amount_fen} unit={u} /></TableCell>
                <TableCell>{LABEL.direction[r.direction]}</TableCell>
                <TableCell>{r.channel ? CHANNEL[r.channel] ?? r.channel : "—"}</TableCell>
                <TableCell>{r.from_party ?? "—"}</TableCell>
                <TableCell className="text-right"><Money fen={r.balance_after_fen} unit={u} /></TableCell>
                <TableCell><StatusChip s={r.status} />{r.reversed_by && <div className="mono text-[11px]">冲正 {r.reversed_by}</div>}</TableCell>
                <TableCell className="mono text-muted-foreground">{r.request_id ?? r.evidence_path ?? "—"}</TableCell>
              </TableRow>
            ))}</TableBody>
            <TableFooter><TableRow>
              <TableCell colSpan={4} className={FOOT}>合计（不含已冲正）· {liveRows.length} 笔</TableCell>
              <TableCell className={cn(FOOT, "text-right")}><Money fen={credit - debit} unit={u} /></TableCell>
              <TableCell colSpan={6} className={FOOT} />
            </TableRow></TableFooter>
          </Table>}
          cards={<>
            {rc.map((r) => (
              <details key={r.txn_id} className={cn("rounded-lg border bg-surface p-3", r.status === "reversed" && "opacity-70")}>
                <summary className="grid grid-cols-[1fr_auto] gap-1 cursor-pointer">
                  <span className="text-xs text-muted-foreground num text-left">{r.txn_time.slice(5, 16).replace("T", " ")}</span>
                  <StatusChip s={r.status} />
                  <span className="text-sm">{r.sub_owner_name}</span>
                  <span className={cn("text-base font-semibold", r.status === "reversed" && "line-through")}><Money fen={r.direction === "debit" ? -r.amount_fen : r.amount_fen} unit={u} /></span>
                </summary>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">流水号</dt><dd className="mono">{r.txn_id}</dd>
                  <dt className="text-muted-foreground">子户</dt><dd className="mono">{r.to_owner_id}</dd>
                  <dt className="text-muted-foreground">方向/渠道</dt><dd>{LABEL.direction[r.direction]} · {r.channel ? CHANNEL[r.channel] ?? r.channel : "—"}</dd>
                  <dt className="text-muted-foreground">充值后余额</dt><dd><Money fen={r.balance_after_fen} unit={u} /></dd>
                  <dt className="text-muted-foreground">证据</dt><dd className="mono">{r.request_id ?? r.evidence_path ?? "—"}</dd>
                </dl>
              </details>
            ))}
            <div className="sticky bottom-16 rounded-lg border bg-sunken p-3 flex justify-between text-sm font-medium"><span>合计 {liveRows.length} 笔</span><Money fen={credit - debit} unit={u} /></div>
          </>}
        />)}
      {fund === "cost" && (cs.length === 0 ? <Empty title="所选范围无消耗" reason="所选日期无 Omni 消耗，或子户未同步" /> :
        <Responsive
          table={<Table>
            <TableHeader><TableRow>{["归属日", "子户", "消耗", "现金消耗", "赠款消耗", "接口"].map((h, i) => <TableHead key={h} scope="col" className={cn(TH, i >= 2 && i <= 4 && "text-right")}>{h}</TableHead>)}</TableRow></TableHeader>
            <TableBody>{cs.map((r, i) => (
              <TableRow key={`${r.owner_id}-${r.stat_date}-${i}`}>
                <TableCell className="num text-left">{r.stat_date}</TableCell>
                <TableCell>{nameOf(subs, r.owner_id) ?? "—"} <span className="mono text-muted-foreground">{r.owner_id}</span></TableCell>
                <TableCell className="text-right"><Money fen={r.cost_fen} unit={u} /></TableCell>
                <TableCell className="text-right"><Money fen={r.cash_cost_fen} unit={u} /></TableCell>
                <TableCell className="text-right"><Money fen={r.grant_cost_fen} unit={u} /></TableCell>
                <TableCell className="mono text-muted-foreground">{r.source_api ?? "—"}</TableCell>
              </TableRow>
            ))}</TableBody>
            <TableFooter><TableRow>
              <TableCell colSpan={2} className={FOOT}>合计 · {cs.length} 行</TableCell>
              <TableCell className={cn(FOOT, "text-right")}><Money fen={sum(cs, (r) => r.cost_fen)} unit={u} /></TableCell>
              <TableCell colSpan={3} className={FOOT} />
            </TableRow></TableFooter>
          </Table>}
          cards={cs.map((r, i) => (
            <div key={i} className="rounded-lg border bg-surface p-3 flex justify-between text-sm">
              <span>{r.stat_date} <span className="text-muted-foreground">{nameOf(subs, r.owner_id) ?? r.owner_id}</span></span>
              <span className="font-semibold"><Money fen={r.cost_fen} unit={u} /></span>
            </div>
          ))}
        />)}
      {fund === "snapshot" && (sn.length === 0 ? <Empty title="所选范围无余额快照" reason="Omni 余额快照未拉取（对账将标 partial）" /> :
        <Responsive
          table={<Table>
            <TableHeader><TableRow>{["快照时间", "子户", "总余额", "现金余额", "当日消耗"].map((h, i) => <TableHead key={h} scope="col" className={cn(TH, i >= 2 && "text-right")}>{h}</TableHead>)}</TableRow></TableHeader>
            <TableBody>{sn.map((r, i) => (
              <TableRow key={`${r.owner_id}-${r.snapshot_time}-${i}`}>
                <TableCell className="num text-left">{r.snapshot_time.slice(0, 16).replace("T", " ")}</TableCell>
                <TableCell>{nameOf(subs, r.owner_id) ?? "—"} <span className="mono text-muted-foreground">{r.owner_id}</span></TableCell>
                <TableCell className="text-right"><Money fen={r.total_balance_fen} unit={u} /></TableCell>
                <TableCell className="text-right"><Money fen={r.cash_bal_fen} unit={u} /></TableCell>
                <TableCell className="text-right"><Money fen={r.today_total_cost_fen} unit={u} /></TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>}
          cards={sn.map((r, i) => (
            <div key={i} className="rounded-lg border bg-surface p-3 flex justify-between text-sm">
              <span>{nameOf(subs, r.owner_id) ?? r.owner_id}</span>
              <span className="font-semibold"><Money fen={r.total_balance_fen} unit={u} /></span>
            </div>
          ))}
        />)}
    </>
  );
}
