"use client";

import { ErrorState, StatusChip } from "@/components/fin/bits";
import { Empty, Money, Responsive } from "@/components/fin/ui";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { explainGap } from "@/lib/revenue-overview";
import { sum } from "@/lib/select";
import { LABEL, type Revenue } from "@/lib/types";
import type { Unit } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LiveError } from "@/lib/use-live";

const TH = "text-xs text-muted-foreground bg-sunken";
const FOOT = "sticky bottom-0 bg-sunken font-medium";

export function RevenueDetail({
  rows, unit, loading, refreshing, error, onRetry, gapFlags, filteredOut,
}: {
  rows: Revenue[];
  unit: Unit;
  loading?: boolean;
  refreshing?: boolean;
  error?: LiveError;
  onRetry?: () => void;
  gapFlags?: string[];
  filteredOut?: boolean;
}) {
  if (loading && rows.length === 0) return <div className="rounded-lg border bg-surface p-4 text-xs text-muted-foreground" aria-busy="true">明细加载中</div>;
  if (error && rows.length === 0) return <ErrorState path={error.path} message={error.message} requestId={error.requestId} onRetry={onRetry} />;
  const net = sum(rows, (row) => row.amount_fen);
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[13px] font-medium">产品 / 代码位明细{refreshing ? " · 更新中" : ""}</h2>
      {!!gapFlags?.length && (
        <ul className="rounded-md bg-warning-bg px-3 py-2 text-xs text-warning">
          {gapFlags.map((flag) => <li key={flag}>{explainGap(flag)} <span className="mono">{flag}</span></li>)}
        </ul>
      )}
      {filteredOut ? <p className="text-xs text-muted-foreground">明细接口只有穿山甲和优量汇的产品行。当前网络没有下钻行。</p> : null}
      {rows.length === 0 ? <Empty title="所选范围无明细" reason="日期内没有产品或代码位行" /> : (
        <Responsive
          table={<Table>
            <TableHeader><TableRow>
              {["归属日", "网络", "收入 ID", "应用", "广告位", "净收入", "毛收", "平台费", "结算状态", "到账日", "批次"].map((h, i) => (
                <TableHead key={h} scope="col" className={cn(TH, i >= 5 && i <= 7 && "text-right")}>{h}</TableHead>
              ))}
            </TableRow></TableHeader>
            <TableBody>{rows.map((row) => (
              <TableRow key={row.revenue_id}>
                <TableCell className="num text-left">{row.stat_date}</TableCell>
                <TableCell>{LABEL.network[row.ad_network] ?? row.ad_network}</TableCell>
                <TableCell className="mono">{row.revenue_id}</TableCell>
                <TableCell className="mono">{row.app_id ?? "—"}</TableCell>
                <TableCell className="mono">{row.placement_id ?? row.ad_unit_id ?? "—"}</TableCell>
                <TableCell className="text-right"><Money fen={row.amount_fen} unit={unit} /></TableCell>
                <TableCell className="text-right"><Money fen={row.gross_amount_fen} unit={unit} /></TableCell>
                <TableCell className="text-right"><Money fen={row.fee_fen} unit={unit} /></TableCell>
                <TableCell><StatusChip s={row.settlement_status} /></TableCell>
                <TableCell className="num text-left">{row.paid_date ?? "—"}</TableCell>
                <TableCell className="mono text-muted-foreground">{row.evidence_ref ?? "—"}</TableCell>
              </TableRow>
            ))}</TableBody>
            <TableFooter><TableRow>
              <TableCell colSpan={5} className={FOOT}>合计 · {rows.length} 行</TableCell>
              <TableCell className={cn(FOOT, "text-right")}><Money fen={net} unit={unit} /></TableCell>
              <TableCell colSpan={5} className={FOOT} />
            </TableRow></TableFooter>
          </Table>}
          cards={<>
            {rows.map((row) => (
              <div key={row.revenue_id} className="rounded-lg border bg-surface p-3 grid grid-cols-[1fr_auto] gap-1">
                <span className="text-xs text-muted-foreground">{row.stat_date} · {LABEL.network[row.ad_network] ?? row.ad_network}</span>
                <StatusChip s={row.settlement_status} />
                <span className="mono text-xs">{row.app_id} / {row.placement_id ?? row.ad_unit_id}</span>
                <span className="font-semibold"><Money fen={row.amount_fen} unit={unit} /></span>
              </div>
            ))}
          </>}
        />
      )}
    </section>
  );
}
