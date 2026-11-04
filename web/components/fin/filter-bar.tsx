"use client";

import { useState } from "react";
import { Lock, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AGENCY_OWNER_ID, type SubOwner } from "@/lib/types";
import type { Filters } from "@/lib/filters";
import { patchQuery, useFilters } from "@/lib/url-state";
import { cn } from "@/lib/utils";
import { SourceChip } from "./ui";
import { ThemeToggle } from "./theme";

type Field = "fund" | "network" | "status" | "subs" | "q" | "basis";
const BASIS = [["auto", "自动"], ["estimate", "预估"], ["settlement", "结算"]] as const;

function BasisToggle({ value }: { value: Filters["basis"] }) {
  return (
    <div className="inline-flex rounded-md border bg-sunken p-0.5" role="group" aria-label="收入口径">
      {BASIS.map(([k, l]) => (
        <button key={k} type="button" onClick={() => patchQuery({ basis: k === "auto" ? null : k })}
          className={cn("h-7 px-2 text-xs rounded focus-visible:outline-2 focus-visible:outline-brand", value === k ? "bg-surface text-brand font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}>
          {l}
        </button>
      ))}
    </div>
  );
}
const QUICK = [["yesterday", "昨日"], ["7d", "近7日"], ["week", "本周"], ["month", "本月"]] as const;
const sel = "h-8 rounded-md border bg-surface px-2 text-xs focus-visible:outline-2 focus-visible:outline-brand";

export function FilterBar({ fields, subOwners, defaults = {}, mixed = false }: {
  fields: Field[]; subOwners: SubOwner[]; defaults?: Partial<Filters>; mixed?: boolean;
}) {
  const f = useFilters(defaults);
  const [open, setOpen] = useState(false);
  const subs = f.subs;
  const has = (field: Field) => fields.includes(field);
  const quickLabel = f.quick === "custom" ? `${f.from}~${f.to}` : QUICK.find((q) => q[0] === f.quick)?.[1] ?? "自定义";
  const chips = [quickLabel, subs.length ? `子户 ${subs.length}` : "全部子户"];

  const controls = (mobile: boolean) => (
    <div className={cn("flex gap-1.5", mobile ? "flex-col p-4 pt-0" : "flex-wrap items-center")}>
      <div className="inline-flex rounded-md border bg-sunken p-0.5" role="group" aria-label="快捷日期">
        {QUICK.map(([k, l]) => (
          <button key={k} type="button" onClick={() => patchQuery({ quick: k, from: null, to: null })}
            className={cn("h-7 px-2 text-xs rounded", f.quick === k ? "bg-surface text-brand font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            {l}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <span className="sr-only">开始日期</span>
        <input type="date" aria-label="开始日期" className={cn(sel, "w-[132px]")} value={f.from} onChange={(e) => patchQuery({ from: e.target.value, to: f.to, quick: "custom" })} />
        <span aria-hidden>~</span>
        <span className="sr-only">结束日期</span>
        <input type="date" aria-label="结束日期" className={cn(sel, "w-[132px]")} value={f.to} onChange={(e) => patchQuery({ to: e.target.value, from: f.from, quick: "custom" })} />
      </label>
      <span className="inline-flex items-center gap-1 h-8 rounded-md border bg-sunken px-2 text-[11px] text-muted-foreground" title="只读锁定">
        <Lock className="size-3" />翊行 <span className="mono">{AGENCY_OWNER_ID}</span>
      </span>
      {has("subs") && (
        <details className="relative">
          <summary className={cn(sel, "flex items-center cursor-pointer")}>子客户 {subs.length ? `· ${subs.length}` : "· 全部"}</summary>
          <div className={cn("z-40 mt-1 w-64 rounded-md border bg-surface p-2 shadow-md flex flex-col gap-0.5", !mobile && "absolute")}>
            <label className="flex items-center gap-2 text-sm h-8"><input type="checkbox" checked={subs.length === 0} onChange={() => patchQuery({ subs: null })} />全选</label>
            {subOwners.map((s) => (
              <label key={s.sub_owner_id} className="flex items-center gap-2 text-sm h-8">
                <input type="checkbox" checked={subs.includes(s.sub_owner_id)}
                  onChange={(e) => {
                    const n = e.target.checked ? [...subs, s.sub_owner_id] : subs.filter((x) => x !== s.sub_owner_id);
                    patchQuery({ subs: n.join(",") || null });
                  }} />
                <span className="truncate">{s.sub_owner_name}</span>
                <span className="mono text-muted-foreground">{s.sub_owner_id}</span>
              </label>
            ))}
            <span className="text-[11px] text-muted-foreground px-1">子户列表为 fixtures</span>
          </div>
        </details>
      )}
      {has("fund") && (
        <select aria-label="资金类型" className={sel} value={f.fund} onChange={(e) => patchQuery({ fund: e.target.value })}>
          <option value="recharge">资金：充值</option>
          <option value="cost">资金：消耗</option>
          <option value="snapshot">资金：余额快照</option>
          <option value="all">资金：全部</option>
        </select>
      )}
      {has("basis") && !mobile && <BasisToggle value={f.basis} />}
      {has("network") && (
        <select aria-label="收入网络" className={sel} value={f.network} onChange={(e) => patchQuery({ network: e.target.value === "all" ? null : e.target.value })}>
          <option value="all">网络：全部</option>
          <option value="pangle">穿山甲</option>
          <option value="ylh">优量汇</option>
          <option value="kuaishou">快手</option>
          <option value="gm_adx">gm_adx</option>
        </select>
      )}
      {has("status") && (
        <select aria-label="对账状态" className={sel} value={f.status} onChange={(e) => patchQuery({ status: e.target.value === "all" ? "all" : e.target.value })}>
          <option value="unmatched">状态：未匹配</option>
          <option value="partial">状态：部分匹配</option>
          <option value="matched">状态：已匹配</option>
          <option value="all">状态：全部</option>
        </select>
      )}
      <select aria-label="金额单位" className={sel} value={f.unit} onChange={(e) => patchQuery({ unit: e.target.value === "fen" ? "fen" : null })}>
        <option value="yuan">单位：元</option>
        <option value="fen">单位：分</option>
      </select>
      {has("q") && (
        <Input key={f.q} defaultValue={f.q} placeholder="子户名 / 流水号" aria-label="关键词"
          className="h-8 w-full md:w-40 bg-surface text-xs"
          onKeyDown={(e) => { if (e.key === "Enter") patchQuery({ q: (e.target as HTMLInputElement).value || null }); }}
          onBlur={(e) => { if (e.target.value !== f.q) patchQuery({ q: e.target.value || null }); }} />
      )}
    </div>
  );

  return (
    <div className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur px-3 md:px-4 py-1.5">
      <div className="hidden md:flex items-start gap-2">
        <div className="min-w-0 flex-1">{controls(false)}</div>
        <SourceChip mock={f.mock} mixed={mixed} />
      </div>
      <div className="md:hidden flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <Button variant="outline" className="h-9 shrink-0" onClick={() => setOpen(true)}><SlidersHorizontal className="size-4" />筛选</Button>
          <div className="flex gap-1 overflow-x-auto">
            {chips.map((c) => <span key={c} className="shrink-0 rounded-full border bg-surface px-2 py-1 text-[11px]">{c}</span>)}
          </div>
          <SourceChip mock={f.mock} mixed={mixed} className="ml-auto" />
          <ThemeToggle className="h-9 shrink-0 rounded-md border px-2 text-xs" />
        </div>
        {has("basis") && <BasisToggle value={f.basis} />}
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto">
          <SheetHeader><SheetTitle>筛选</SheetTitle></SheetHeader>
          {controls(true)}
        </SheetContent>
      </Sheet>
    </div>
  );
}
