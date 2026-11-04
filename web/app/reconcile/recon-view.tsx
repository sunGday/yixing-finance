"use client";

import { useState } from "react";
import { FilterBar } from "@/components/fin/filter-bar";
import { ErrorState, StaleNote, StatusChip } from "@/components/fin/bits";
import { PageSkeleton } from "@/components/fin/page-skeleton";
import { Kpi, PageHeader } from "@/components/fin/ui";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { loadReconBundle } from "@/lib/fx/recon";
import type { Filters } from "@/lib/filters";
import { formatFen, type Unit } from "@/lib/format";
import { rangeParams, selectRecon } from "@/lib/select";
import { wantsLive } from "@/lib/source";
import { LABEL, type ReconRow, type ReconTab, type SubOwner } from "@/lib/types";
import { patchQuery, useFilters, useHeldRange, useQueryString } from "@/lib/url-state";
import { useLiveMap } from "@/lib/use-live";
import { cn } from "@/lib/utils";

const TABS = Object.keys(LABEL.tab) as ReconTab[];
const defaults = { status: "unmatched" as const, quick: "7d" };

const M = ({ fen, unit, signed, tone }: { fen: number | null; unit: Unit; signed?: boolean; tone?: boolean }) =>
  <span className={cn("num", tone && fen != null && fen !== 0 && "text-danger font-medium")}>{formatFen(fen, unit, signed)}</span>;

function scopeText(scope: string, subs: SubOwner[]) {
  if (scope.startsWith("owner:")) {
    const id = scope.slice(6);
    const name = subs.find((s) => s.sub_owner_id === id)?.sub_owner_name;
    return name ? `${name} · ${id}` : scope;
  }
  if (scope.startsWith("agency:")) return `代理商 · ${scope.slice(7)}`;
  if (scope.startsWith("network:")) {
    const id = scope.slice(8);
    return id === "pangle" || id === "ylh" ? LABEL.network[id] : scope;
  }
  return scope;
}

export function ReconcileView() {
  const f = useFilters(defaults);
  const search = useQueryString();
  const tab = (new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("tab") as ReconTab) || "fund_equation";
  const fx = loadReconBundle(f);
  const liveOn = wantsLive(f.mock);
  const live = useLiveMap(liveOn, [{ key: "re", path: "/reconcile/summaries", params: rangeParams(f) }]);
  const held = useHeldRange(live.data, f.from, f.to, liveOn);
  const ff = { ...f, from: held.from, to: held.to };
  const bundle = liveOn && live.data
    ? { subs: fx.subs, all: selectRecon(live.data.re as ReconRow[], { ...ff, status: "all" }), rows: selectRecon(live.data.re as ReconRow[], ff) }
    : fx;

  return (
    <>
      <FilterBar fields={["subs", "status", "q"]} subOwners={fx.subs} defaults={defaults} />
      <div className="px-3 md:px-4 py-3 flex flex-col gap-3">
        {f.mock === "error" ? <ErrorState path="/reconcile/summaries" message="mock 故障注入" requestId="req-mock-error" />
          : liveOn && live.loading && !live.data ? <PageSkeleton />
          : liveOn && live.error && !live.data ? <ErrorState {...live.error} onRetry={live.retry} />
          : <>
            {live.error && live.data ? <StaleNote message={live.error.message} onRetry={live.retry} /> : null}
            <Queue f={f} tab={tab} rows={bundle.rows} all={bundle.all} subs={bundle.subs} refreshing={live.refreshing} />
          </>}
      </div>
    </>
  );
}

function Queue({ f, tab, rows, all, subs, refreshing = false }: { f: Filters; tab: ReconTab; rows: ReconRow[]; all: ReconRow[]; subs: SubOwner[]; refreshing?: boolean }) {
  const [open, setOpen] = useState<ReconRow | null>(null);
  const list = rows.filter((x) => x.tab === tab);
  const scoped = all.filter((x) => x.tab === tab);
  const unm = scoped.filter((x) => x.status === "unmatched").length;
  const part = scoped.filter((x) => x.status === "partial").length;
  const absDelta = scoped.reduce((s, x) => s + Math.abs(x.delta_fen ?? 0), 0);
  const rate = scoped.length ? Math.round((scoped.filter((x) => x.status === "matched").length / scoped.length) * 100) : null;
  const unit = f.unit;
  const setTab = (t: string) => patchQuery({ tab: t });
  const showAll = () => patchQuery({ status: "all" });

  return (
    <>
      <PageHeader title="对账汇总" unit={unit} from={f.from} to={f.to} status={refreshing ? "更新中" : null} />
      <div role="tablist" aria-label="对账分区" className="flex gap-1 overflow-x-auto border-b">
        {TABS.map((t) => {
          const n = all.filter((x) => x.tab === t && x.status === "unmatched").length;
          return (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={cn("h-9 px-3 text-sm whitespace-nowrap border-b-2 -mb-px focus-visible:outline-2 focus-visible:outline-brand",
                tab === t ? "border-brand text-brand font-medium" : "border-transparent text-muted-foreground")}>
              {LABEL.tab[t]}{n > 0 && <span className="ml-1 rounded-full bg-danger-bg text-danger px-1.5 text-xs">{n}</span>}
            </button>
          );
        })}
      </div>
      {tab === "cross_source" && <div className="rounded-md bg-info-bg text-info px-3 py-2 text-xs">仅观察 · 非关账。不强平。</div>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Kpi size="sm" label="未匹配" value={`${unm} 笔`} tone={unm ? "danger" : undefined} />
        <Kpi size="sm" label="部分匹配" value={`${part} 笔`} tone={part ? "warning" : undefined} />
        <Kpi size="lg" label="差额合计 Σ|delta|" value={formatFen(absDelta, unit)} tone={absDelta ? "danger" : undefined} />
        <Kpi size="sm" label="匹配率" value={rate == null ? "—" : `${rate}%`} />
      </div>
      {list.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-surface p-8 text-center text-sm">
          {scoped.length > 0 ? <>
            本分区在「{f.status === "all" ? "全部" : LABEL.recon[f.status]}」下无记录
            {f.status !== "all" && scoped.every((x) => x.status === "matched") ? "，全部已匹配。" : "。"}
            {f.status !== "all" && <button type="button" onClick={showAll} className="ml-2 text-brand underline h-10">查看全部状态</button>}
          </> : <span className="text-muted-foreground">该分区暂无对账结果。</span>}
        </div>
      ) : (
        <>
          <div className="ledger hidden md:block rounded-lg border bg-surface">
            <Table>
              <TableHeader><TableRow>
                {["对账 ID", "业务日", "范围", "左侧", "右侧", "差额", "状态", "说明", "证据"].map((h, i) => (
                  <TableHead key={h} scope="col" className={cn("text-xs text-muted-foreground bg-sunken", i >= 3 && i <= 5 && "text-right")}>{h}</TableHead>
                ))}
              </TableRow></TableHeader>
              <TableBody>{list.map((x) => (
                <TableRow key={x.recon_id} tabIndex={0} onClick={() => setOpen(x)} onKeyDown={(e) => { if (e.key === "Enter") setOpen(x); }}
                  className={cn("cursor-pointer focus-visible:outline-2 focus-visible:outline-brand",
                    x.status === "unmatched" && "bg-danger-bg/50 shadow-[inset_3px_0_0_var(--danger)]",
                    x.status === "partial" && "shadow-[inset_3px_0_0_var(--warning)]",
                    x.status === "matched" && "shadow-[inset_3px_0_0_var(--success)]")}>
                  <TableCell className="mono">{x.recon_id}</TableCell>
                  <TableCell className="num text-left">{x.biz_date}</TableCell>
                  <TableCell className="max-w-48 truncate" title={x.scope}>{scopeText(x.scope, subs)}</TableCell>
                  <TableCell className="text-right"><M fen={x.left_fen} unit={unit} /></TableCell>
                  <TableCell className="text-right"><M fen={x.right_fen} unit={unit} /></TableCell>
                  <TableCell className="text-right"><M fen={x.delta_fen} unit={unit} signed tone /></TableCell>
                  <TableCell><StatusChip s={x.status} /></TableCell>
                  <TableCell className="max-w-64 truncate">{x.note ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{x.evidence_paths.length || "—"}</TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          </div>
          <div className="md:hidden flex flex-col gap-2">{list.map((x) => (
            <button key={x.recon_id} type="button" onClick={() => setOpen(x)} className={cn("text-left rounded-lg border bg-surface p-3 grid grid-cols-[1fr_auto] gap-1", x.status === "unmatched" && "border-danger/40")}>
              <span className="text-xs text-muted-foreground">{x.biz_date} · {scopeText(x.scope, subs)}</span>
              <StatusChip s={x.status} />
              <span className="text-xs truncate">{x.note}</span>
              <span className="font-semibold"><M fen={x.delta_fen} unit={unit} signed tone /></span>
            </button>
          ))}</div>
        </>
      )}
      <Sheet open={!!open} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          {open && <>
            <SheetHeader>
              <SheetTitle className="mono text-left">{open.recon_id}</SheetTitle>
              <SheetDescription>{open.biz_date} · {LABEL.tab[open.tab]} · {scopeText(open.scope, subs)}</SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-6 flex flex-col gap-4 text-sm">
              <div className="flex items-center gap-2 flex-wrap"><StatusChip s={open.status} />{open.note && <span>{open.note}</span>}</div>
              {open.status === "partial" && <div className="rounded-md bg-warning-bg text-warning px-3 py-2 text-xs">部分匹配：一侧数据缺失，未轧平。差额不进关账。</div>}
              {!!open.gap_flags?.length && <div className="text-xs text-muted-foreground">gap_flags <span className="mono">{open.gap_flags.join(", ")}</span></div>}
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                <dt className="text-muted-foreground">左侧</dt><dd className="text-right"><M fen={open.left_fen} unit={unit} /></dd>
                <dt className="text-muted-foreground">右侧</dt><dd className="text-right"><M fen={open.right_fen} unit={unit} /></dd>
                <dt className="text-muted-foreground">差额</dt><dd className="text-right"><M fen={open.delta_fen} unit={unit} signed tone /></dd>
              </dl>
              <section>
                <h3 className="text-xs text-muted-foreground mb-1">构成</h3>
                {open.components?.length ? (
                  <ul className="divide-y rounded-md border">
                    {open.components.map((c, i) => (
                      <li key={i} className="flex justify-between gap-3 px-3 py-2">
                        <span>{c.label} <span className="mono text-muted-foreground">{c.ref}</span></span>
                        <M fen={c.amount_fen} unit={unit} signed />
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-xs text-muted-foreground">暂无构成明细</p>}
              </section>
              <section>
                <h3 className="text-xs text-muted-foreground mb-1">证据</h3>
                {open.evidence_paths.length ? open.evidence_paths.map((p) => <div key={p} className="mono break-all">{p}</div>) : <p className="text-xs text-muted-foreground">—</p>}
              </section>
              <p className="text-[11px] text-muted-foreground">只读。调整分录为二期。</p>
            </div>
          </>}
        </SheetContent>
      </Sheet>
    </>
  );
}
