"use client";

import Link from "next/link";
import { FilterBar } from "@/components/fin/filter-bar";
import { ErrorState, StatusChip } from "@/components/fin/bits";
import { PageSkeleton } from "@/components/fin/page-skeleton";
import { Banner, DayBars, Kpi, Money, PageHeader, Panel, SplitBar } from "@/components/fin/ui";
import { loadOverview } from "@/lib/fx/overview";
import type { Filters } from "@/lib/filters";
import { formatFen } from "@/lib/format";
import { chartDays, normalizeRecharges, rangeParams, selectRecharges, selectRecon, selectRevenues, sum } from "@/lib/select";
import { wantsLive } from "@/lib/source";
import type { Recharge, ReconRow, Revenue, SubOwner } from "@/lib/types";
import { LABEL } from "@/lib/types";
import { hrefFor, useFilters } from "@/lib/url-state";
import { useLiveMap } from "@/lib/use-live";

const linkCls = "block h-full rounded-lg focus-visible:outline-2 focus-visible:outline-brand";

function latestBal(rows: { owner_id: string; snapshot_time: string; total_balance_fen: number }[], id: string) {
  const hit = rows.filter((r) => r.owner_id === id).sort((a, b) => (a.snapshot_time < b.snapshot_time ? 1 : -1))[0];
  return hit?.total_balance_fen ?? null;
}

export function OverviewView() {
  const f = useFilters();
  const fx = loadOverview(f);
  const liveOn = wantsLive(f.mock);
  const live = useLiveMap(liveOn, [
    { key: "rc", path: "/recharges", params: { ...rangeParams(f), keyword: f.q || undefined } },
    { key: "rv", path: "/revenues", params: { start_date: f.from, end_date: f.to, ad_network: f.network === "all" ? undefined : f.network } },
    { key: "re", path: "/reconcile/summaries", params: rangeParams(f) },
  ]);

  return (
    <>
      <FilterBar fields={["subs", "network"]} subOwners={fx.subs} />
      <Body f={f} fx={fx} liveOn={liveOn} live={live} />
    </>
  );
}

function Body({ f, fx, liveOn, live }: {
  f: Filters;
  fx: ReturnType<typeof loadOverview>;
  liveOn: boolean;
  live: ReturnType<typeof useLiveMap>;
}) {
  if (f.mock === "error") return <div className="p-4"><ErrorState path="/recharges" message="mock 故障注入" requestId="req-mock-error" /></div>;
  if (liveOn && live.loading) return <PageSkeleton />;
  if (liveOn && live.error) return <div className="p-4"><ErrorState {...live.error} onRetry={live.retry} /></div>;

  const data = liveOn && live.data ? {
    ...fx,
    rc: selectRecharges(normalizeRecharges(live.data.rc as Recharge[]), f),
    rv: selectRevenues(live.data.rv as Revenue[], f),
    re: selectRecon(live.data.re as ReconRow[], { ...f, status: "all" }),
  } : fx;

  const { rc, cs, sn, rv, re, subs } = data;
  const credit = sum(rc.filter((r) => r.direction === "credit" && r.status !== "reversed"), (r) => r.amount_fen);
  const cost = sum(cs, (r) => r.cost_fen);
  const bal = sn.length ? sum(sn, (r) => r.total_balance_fen) : null;
  const pg = sum(rv.filter((r) => r.ad_network === "pangle"), (r) => r.amount_fen);
  const yl = sum(rv.filter((r) => r.ad_network === "ylh"), (r) => r.amount_fen);
  const delta = sum(re.filter((r) => r.tab !== "cross_source"), (r) => r.delta_fen);
  const unm = re.filter((r) => r.status === "unmatched");
  const part = re.filter((r) => r.status === "partial").length;
  const days = chartDays(f.from, f.to);
  const widened = !liveOn && days[0] < f.from;
  const chartSrc = widened ? loadOverview({ ...f, from: days[0], to: f.to }) : data;
  const series = days.map((day) => ({
    day,
    recharge: sum(chartSrc.rc.filter((r) => r.biz_date === day && r.direction === "credit" && r.status !== "reversed"), (r) => r.amount_fen),
    cost: sum(chartSrc.cs.filter((r) => r.stat_date === day), (r) => r.cost_fen),
  }));
  const u = f.unit;

  return (
    <div className="px-3 md:px-4 py-3 flex flex-col gap-3">
      <PageHeader title="概览" unit={u} from={f.from} to={f.to} mock={f.mock} mixed />
      {part > 0 && <Banner tone="warning">部分匹配 {part} 条（缺快照或结算未出），合计可能不完整。</Banner>}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
        <Link href={hrefFor("/recharges", f, { fund: "recharge" })} className={linkCls}>
          <Kpi size="lg" label="充值合计 · 主指标" value={formatFen(credit, u)} hint={`${rc.filter((r) => r.status !== "reversed").length} 笔有效 · 点进流水`} />
        </Link>
        <Link href={hrefFor("/recharges", f, { fund: "cost" })} className={linkCls}><Kpi label="消耗合计" value={formatFen(cost, u)} hint="Omni 消耗" /></Link>
        <Link href={hrefFor("/revenues", f)} className={linkCls}><Kpi label="收入合计" value={formatFen(pg + yl, u)} hint={`穿山甲 ${formatFen(pg, u)} · 优量汇 ${formatFen(yl, u)}`} /></Link>
        <Link href={hrefFor("/recharges", f, { fund: "snapshot" })} className={linkCls}><Kpi label="期末余额" value={formatFen(bal, u)} hint={bal == null ? "无快照" : `${sn.length} 条快照`} /></Link>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Link href={hrefFor("/reconcile", f, { status: "all" })} className={linkCls}><Kpi size="sm" label="日差额" value={formatFen(delta, u, true)} tone={delta !== 0 ? "danger" : undefined} hint="不含跨源观察" /></Link>
        <Link href={hrefFor("/reconcile", f, { status: "unmatched" })} className={linkCls}><Kpi size="sm" label="未匹配" value={`${unm.length} 笔`} tone={unm.length ? "danger" : undefined} hint="点进对账" /></Link>
        <Link href={hrefFor("/reconcile", f, { status: "partial" })} className={linkCls}><Kpi size="sm" label="部分匹配" value={`${part} 笔`} tone={part ? "warning" : undefined} /></Link>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-2">
        <div className="lg:col-span-3">
          <Panel title="按日充值 / 消耗" extra={widened ? "近 7 日，止于区间末日" : days.length >= 62 && days[days.length - 1] < f.to ? "仅绘制前 62 日" : "所选区间"}>
            {series.length === 0 ? <p className="text-xs text-muted-foreground">区间无效</p> : <DayBars series={series} />}
          </Panel>
        </div>
        <div className="lg:col-span-2">
          <Panel title="收入构成" extra="净收入">
            <SplitBar aLabel="穿山甲" a={pg} bLabel="优量汇" b={yl} />
            <p className="mt-3 text-[11px] text-muted-foreground">穿山甲 {formatFen(pg, u)} · 优量汇 {formatFen(yl, u)}</p>
          </Panel>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-2">
        <div className="lg:col-span-3">
          <Panel title="子户" extra="余额取区间内最晚快照" flush>
            <OwnerTable subs={subs} rc={rc} cs={cs} sn={sn} unit={u} />
          </Panel>
        </div>
        <div className="lg:col-span-2">
          <Panel title="未匹配队列" extra={`${unm.length} 笔`} flush>
            {unm.length === 0 ? <p className="p-3 text-xs text-success">所选范围无未匹配。</p> : (
              <ul className="divide-y">
                {unm.slice(0, 5).map((row) => (
                  <li key={row.recon_id}>
                    <Link href={hrefFor("/reconcile", f, { status: "unmatched", tab: row.tab })} className="flex items-center gap-2 px-3 py-2 hover:bg-sunken focus-visible:outline-2 focus-visible:outline-brand">
                      <StatusChip s={row.status} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs truncate">{row.note || row.scope}</span>
                        <span className="mono text-muted-foreground">{row.biz_date} · {LABEL.tab[row.tab]}</span>
                      </span>
                      <Money fen={row.delta_fen} unit={u} signed tone />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
      <details className="rounded-lg border bg-surface px-3 py-2 text-sm">
        <summary className="cursor-pointer h-8 flex items-center">毛利草稿 <span className="ml-2 rounded bg-info-bg text-info px-1.5 py-0.5 text-[11px]">非关账口径</span></summary>
        <div className="mt-1 num text-left text-lg">{formatFen(pg + yl - cost, u, true)}</div>
        <p className="text-[11px] text-muted-foreground">Σ收入 − Σ Omni 消耗。仅观察，不参与关账。</p>
      </details>
    </div>
  );
}

function OwnerTable({ subs, rc, cs, sn, unit }: { subs: SubOwner[]; rc: Recharge[]; cs: { owner_id: string; cost_fen: number }[]; sn: { owner_id: string; snapshot_time: string; total_balance_fen: number }[]; unit: Filters["unit"] }) {
  return (
    <table className="w-full text-sm">
      <thead><tr className="text-[11px] text-muted-foreground">{["子户", "充值", "消耗", "期末余额"].map((h, i) => <th key={h} scope="col" className={i ? "text-right font-medium px-3 py-1.5" : "text-left font-medium px-3 py-1.5"}>{h}</th>)}</tr></thead>
      <tbody>
        {subs.map((s) => {
          const credit = sum(rc.filter((r) => r.to_owner_id === s.sub_owner_id && r.direction === "credit" && r.status !== "reversed"), (r) => r.amount_fen);
          const cost = sum(cs.filter((r) => r.owner_id === s.sub_owner_id), (r) => r.cost_fen);
          return (
            <tr key={s.sub_owner_id} className="border-t">
              <td className="px-3 py-1.5"><span className="text-[13px]">{s.sub_owner_name}</span> <span className="mono text-muted-foreground">{s.sub_owner_id}</span></td>
              <td className="px-3 py-1.5"><Money fen={credit} unit={unit} /></td>
              <td className="px-3 py-1.5"><Money fen={cost} unit={unit} /></td>
              <td className="px-3 py-1.5"><Money fen={latestBal(sn, s.sub_owner_id)} unit={unit} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
