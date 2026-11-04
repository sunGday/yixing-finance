"use client";

import { useState } from "react";
import { ErrorState, StatusChip } from "@/components/fin/bits";
import { Banner, Empty, Money } from "@/components/fin/ui";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Unit } from "@/lib/format";
import {
  BUSINESS_LABEL, createSettlement, importSettlements, markSettlementPaid, networkLabel, parseSettlementImport,
  validateSettlementInput, type Settlement, type SettlementInput,
} from "@/lib/revenue-overview";
import type { LiveError } from "@/lib/use-live";
import { cn } from "@/lib/utils";

const TH = "text-xs text-muted-foreground bg-sunken";
const sel = "h-8 rounded-md border bg-surface px-2 text-xs focus-visible:outline-2 focus-visible:outline-brand";

export function SettlementsPanel({
  unit, live, loading, error, bills, busy, notice, paidDateDefault, now, onRetry, onChange, onLiveCreate, onLivePaid, onLiveImport,
}: {
  unit: Unit;
  live: boolean;
  loading?: boolean;
  error?: LiveError;
  bills: Settlement[];
  busy?: boolean;
  notice?: string | null;
  paidDateDefault: string;
  now: string;
  onRetry?: () => void;
  onChange?: (next: Settlement[]) => void;
  onLiveCreate?: (value: SettlementInput) => Promise<boolean | void>;
  onLivePaid?: (id: string, paidDate: string) => Promise<boolean | void>;
  onLiveImport?: (rows: SettlementInput[]) => Promise<boolean | void>;
}) {
  const [period, setPeriod] = useState("2026-10");
  const [business, setBusiness] = useState<"sdk_ads" | "ad_coop">("sdk_ads");
  const [network, setNetwork] = useState("");
  const [amount, setAmount] = useState("");
  const [signed, setSigned] = useState("2026-11-02");
  const [evidence, setEvidence] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [paidDate, setPaidDate] = useState(paidDateDefault);
  const [importText, setImportText] = useState("");

  async function submitCreate() {
    const checked = validateSettlementInput({
      period, business_type: business, ad_network: network || null, amount_text: amount, unit,
      settlement_status: "settled", signed_date: signed, evidence_ref: evidence,
    });
    if (!checked.ok) { setFormError(checked.message); return; }
    setFormError(null);
    if (live) {
      const ok = await onLiveCreate?.(checked.value);
      if (ok === false) return;
      setAmount("");
      setEvidence("");
      return;
    }
    const next = createSettlement(bills, checked.value, now);
    if (!next.ok) { setFormError(next.message); return; }
    onChange?.(next.items);
    setAmount("");
    setEvidence("");
  }

  async function confirmPaid(id: string) {
    if (live) {
      const ok = await onLivePaid?.(id, paidDate);
      if (ok === false) return;
      setPending(null);
      return;
    }
    const next = markSettlementPaid(bills, id, paidDate, now);
    if (!next.ok) { setFormError(next.message); return; }
    onChange?.(next.items);
    setPending(null);
  }

  async function submitImport() {
    const parsed = parseSettlementImport(importText);
    if (!parsed.ok) { setFormError(parsed.message); return; }
    setFormError(null);
    if (live) {
      const ok = await onLiveImport?.(parsed.rows);
      if (ok === false) return;
      setImportText("");
      return;
    }
    const next = importSettlements(bills, parsed.rows, now);
    if (!next.ok) { setFormError(next.message); return; }
    onChange?.(next.items);
    setImportText("");
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-[13px] font-medium">结算单</h2>
        <p className="text-[11px] text-muted-foreground mt-0.5">已签订入账。已到账只核销收款。预估不写入。</p>
      </div>
      {!live && <Banner tone="info">演示数据，刷新后恢复。不会写入财务 API。</Banner>}
      {notice ? <Banner tone="info">{notice}</Banner> : null}
      {formError ? <Banner tone="warning">{formError}</Banner> : null}
      {error ? <ErrorState path={error.path} message={error.message} requestId={error.requestId} onRetry={onRetry} /> : null}
      {loading ? <div className="rounded-lg border bg-surface p-4 text-xs text-muted-foreground" aria-busy="true">结算单加载中</div>
        : bills.length === 0 ? <Empty title="没有结算单" reason="记一张已签订的单，或导入" />
        : <div className="rounded-lg border bg-surface overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              {["单号", "月份", "业务", "网络", "金额", "状态", "签订日", "到账日", "证据", "操作"].map((h, i) => (
                <TableHead key={h} scope="col" className={cn(TH, i === 4 && "text-right")}>{h}</TableHead>
              ))}
            </TableRow></TableHeader>
            <TableBody>
              {[...bills].sort((a, b) => b.period.localeCompare(a.period) || a.settlement_id.localeCompare(b.settlement_id)).map((bill) => (
                <TableRow key={bill.settlement_id}>
                  <TableCell className="mono text-xs">{bill.settlement_id}</TableCell>
                  <TableCell className="num">{bill.period}</TableCell>
                  <TableCell>{BUSINESS_LABEL[bill.business_type]}</TableCell>
                  <TableCell>{networkLabel(bill.ad_network)}</TableCell>
                  <TableCell className="text-right"><Money fen={bill.amount_fen} unit={unit} /></TableCell>
                  <TableCell><StatusChip s={bill.settlement_status} /></TableCell>
                  <TableCell className="num">{bill.signed_date}</TableCell>
                  <TableCell className="num">{bill.paid_date ?? "—"}</TableCell>
                  <TableCell className="mono text-xs text-muted-foreground">{bill.evidence_ref}</TableCell>
                  <TableCell>
                    {bill.settlement_status === "settled" && pending !== bill.settlement_id && (
                      <Button type="button" size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => { setPending(bill.settlement_id); setPaidDate(paidDateDefault); }}>标为已到账</Button>
                    )}
                    {pending === bill.settlement_id && (
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] text-muted-foreground">确认到账？只核销收款，不另记收入。</span>
                        <input type="date" aria-label="到账日" className={sel} value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
                        <div className="flex gap-1">
                          <Button type="button" size="sm" className="h-7" disabled={busy} onClick={() => confirmPaid(bill.settlement_id)}>确认到账</Button>
                          <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => setPending(null)}>取消</Button>
                        </div>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>}
      <form className="rounded-lg border bg-surface p-3 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void submitCreate(); }}>
        <h3 className="text-[13px] font-medium">记已签订</h3>
        <div className="flex flex-wrap gap-2">
          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">月份
            <input aria-label="结算月份" className={cn(sel, "w-[140px]")} placeholder="2026-10" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">业务
            <select aria-label="业务类型" className={sel} value={business} onChange={(e) => setBusiness(e.target.value === "ad_coop" ? "ad_coop" : "sdk_ads")}>
              <option value="sdk_ads">SDK广告</option>
              <option value="ad_coop">广告合作</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">网络
            <select aria-label="结算网络" className={sel} value={network} onChange={(e) => setNetwork(e.target.value)}>
              <option value="">月总额</option>
              <option value="pangle">穿山甲</option>
              <option value="ylh">优量汇</option>
              <option value="kuaishou">快手</option>
              <option value="gm_adx">gm_adx</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">金额（{unit === "fen" ? "分" : "元"}）
            <input aria-label="结算金额" inputMode="decimal" className={cn(sel, "w-[120px] text-right")} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">签订日
            <input type="date" aria-label="签订日" className={sel} value={signed} onChange={(e) => setSigned(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">证据
            <input aria-label="证据编号" className={cn(sel, "w-[180px]")} value={evidence} onChange={(e) => setEvidence(e.target.value)} />
          </label>
        </div>
        <div>
          <Button type="submit" size="sm" disabled={busy}>记为已签订</Button>
        </div>
      </form>
      <details className="rounded-lg border bg-surface p-3">
        <summary className="text-[13px] font-medium cursor-pointer">导入</summary>
        <p className="text-[11px] text-muted-foreground mt-2">JSON {`{"items":[...]}`} 或 CSV。金额用整数分。不能有预估。</p>
        <textarea aria-label="导入结算单" className="mt-2 w-full min-h-24 rounded-md border bg-surface p-2 text-xs font-mono" value={importText} onChange={(e) => setImportText(e.target.value)} />
        <Button type="button" size="sm" variant="outline" className="mt-2" disabled={busy} onClick={() => void submitImport()}>导入</Button>
      </details>
    </section>
  );
}
