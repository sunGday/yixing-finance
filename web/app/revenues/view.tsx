"use client";

import { useEffect, useState } from "react";
import { FilterBar } from "@/components/fin/filter-bar";
import { ErrorState, StatusChip } from "@/components/fin/bits";
import { CredentialGapBanner } from "@/components/fin/credential-gap";
import { PageSkeleton } from "@/components/fin/page-skeleton";
import { Banner, Empty, Kpi, Money, PageHeader, Responsive, SplitBar } from "@/components/fin/ui";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { loadRevenueBundle } from "@/lib/fx/revenues";
import { formatFen } from "@/lib/format";
import { clearRevenueCredRetry, isCredentialGap, takeRevenueCredRetry } from "@/lib/credentials";
import { selectRevenues, sum } from "@/lib/select";
import { wantsLive } from "@/lib/source";
import { LABEL, type Revenue } from "@/lib/types";
import { useFilters } from "@/lib/url-state";
import { useLiveMap } from "@/lib/use-live";
import { cn } from "@/lib/utils";

const TH = "text-xs text-muted-foreground bg-sunken";
const FOOT = "sticky bottom-0 bg-sunken font-medium";

export function RevenuesView() {
  const f = useFilters();
  const fx = loadRevenueBundle(f);
  const liveOn = wantsLive(f.mock);
  const live = useLiveMap(liveOn, [{
    key: "rv",
    path: "/revenues",
    params: { start_date: f.from, end_date: f.to, ad_network: f.network === "all" ? undefined : f.network },
  }]);
  const rv = liveOn && live.data ? selectRevenues(live.data.rv as Revenue[], f) : fx.rv;
  const u = f.unit;
  const net = sum(rv, (r) => r.amount_fen);
  const gross = rv.some((r) => r.gross_amount_fen != null) ? sum(rv, (r) => r.gross_amount_fen) : null;
  const fee = rv.some((r) => r.fee_fen != null) ? sum(rv, (r) => r.fee_fen) : null;
  const est = rv.filter((r) => r.settlement_status === "estimated").length;
  const settled = rv.filter((r) => r.settlement_status === "settled").length;
  const paid = rv.filter((r) => r.settlement_status === "paid").length;
  const pg = sum(rv.filter((r) => r.ad_network === "pangle"), (r) => r.amount_fen);
  const yl = sum(rv.filter((r) => r.ad_network === "ylh"), (r) => r.amount_fen);
  const [credRetry, setCredRetry] = useState(false);
  useEffect(() => { setCredRetry(takeRevenueCredRetry()); }, []);
  useEffect(() => {
    if (!credRetry || !live.data) return;
    clearRevenueCredRetry();
    setCredRetry(false);
  }, [credRetry, live.data]);
  const credentialGap = !!(liveOn && live.error && isCredentialGap(live.error));

  return (
    <>
      <FilterBar fields={["network"]} subOwners={fx.subs} />
      <div className="px-3 md:px-4 py-3 flex flex-col gap-3">
        {f.mock === "error" ? <ErrorState path="/revenues" message="mock 故障注入" requestId="req-mock-error" />
          : liveOn && live.loading ? <PageSkeleton />
          : credentialGap && live.error ? <CredentialGapBanner message={live.error.message} requestId={live.error.requestId} gapFlags={live.error.gapFlags} onRetry={live.retry} showSync={credRetry} />
          : liveOn && live.error ? <ErrorState path={live.error.path} message={live.error.message} requestId={live.error.requestId} onRetry={live.retry} />
          : <>
            <PageHeader title="收入流水" unit={u} from={f.from} to={f.to} />
            <Banner tone="info">默认含预估与结算。关账以结算为准。</Banner>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Kpi size="lg" label="净收入 · 主指标" value={formatFen(net, u)} hint={`${rv.length} 行`} />
              <Kpi label="毛收" value={formatFen(gross, u)} hint={gross == null ? "平台未提供" : "空值按 0 计入"} />
              <Kpi label="平台费" value={formatFen(fee, u)} />
              <Kpi label="预估未结算" value={`${est} 笔`} tone={est ? "warning" : undefined} hint={`已结算 ${settled} · 已到账 ${paid}`} />
            </div>
            <div className="rounded-lg border bg-surface p-3">
              <div className="text-[11px] text-muted-foreground mb-2">网络占比</div>
              <SplitBar aLabel="穿山甲" a={pg} bLabel="优量汇" b={yl} />
            </div>
            {rv.length === 0 ? <Empty title="所选范围无收入" reason="所选日期无收入，或该网络未接入" /> :
              <Responsive
                table={<Table>
                  <TableHeader><TableRow>
                    {["归属日", "网络", "收入 ID", "应用", "广告位", "净收入", "毛收", "平台费", "结算状态", "到账日", "批次"].map((h, i) => (
                      <TableHead key={h} scope="col" className={cn(TH, i >= 5 && i <= 7 && "text-right")}>{h}</TableHead>
                    ))}
                  </TableRow></TableHeader>
                  <TableBody>{rv.map((r) => (
                    <TableRow key={r.revenue_id}>
                      <TableCell className="num text-left">{r.stat_date}</TableCell>
                      <TableCell>{LABEL.network[r.ad_network]}</TableCell>
                      <TableCell className="mono">{r.revenue_id}</TableCell>
                      <TableCell className="mono">{r.app_id ?? "—"}</TableCell>
                      <TableCell className="mono">{r.placement_id ?? r.ad_unit_id ?? "—"}</TableCell>
                      <TableCell className="text-right"><Money fen={r.amount_fen} unit={u} /></TableCell>
                      <TableCell className="text-right"><Money fen={r.gross_amount_fen} unit={u} /></TableCell>
                      <TableCell className="text-right"><Money fen={r.fee_fen} unit={u} /></TableCell>
                      <TableCell><StatusChip s={r.settlement_status} /></TableCell>
                      <TableCell className="num text-left">{r.paid_date ?? "—"}</TableCell>
                      <TableCell className="mono text-muted-foreground">{r.evidence_ref ?? "—"}</TableCell>
                    </TableRow>
                  ))}</TableBody>
                  <TableFooter><TableRow>
                    <TableCell colSpan={5} className={FOOT}>合计 · {rv.length} 行</TableCell>
                    <TableCell className={cn(FOOT, "text-right")}><Money fen={net} unit={u} /></TableCell>
                    <TableCell className={cn(FOOT, "text-right")}><Money fen={gross} unit={u} /></TableCell>
                    <TableCell className={cn(FOOT, "text-right")}><Money fen={fee} unit={u} /></TableCell>
                    <TableCell colSpan={3} className={FOOT} />
                  </TableRow></TableFooter>
                </Table>}
                cards={<>
                  {rv.map((r) => (
                    <div key={r.revenue_id} className="rounded-lg border bg-surface p-3 grid grid-cols-[1fr_auto] gap-1">
                      <span className="text-xs text-muted-foreground">{r.stat_date} · {LABEL.network[r.ad_network]}</span>
                      <StatusChip s={r.settlement_status} />
                      <span className="mono text-xs">{r.app_id} / {r.placement_id ?? r.ad_unit_id}</span>
                      <span className="font-semibold"><Money fen={r.amount_fen} unit={u} /></span>
                    </div>
                  ))}
                  <div className="sticky bottom-16 rounded-lg border bg-sunken p-3 flex justify-between text-sm font-medium"><span>合计 {rv.length} 行</span><Money fen={net} unit={u} /></div>
                </>}
              />}
          </>}
      </div>
    </>
  );
}
