import { cn } from "@/lib/utils";
import { formatFen, unitLabel, type Unit } from "@/lib/format";
import { sourceLabel } from "@/lib/source";

export function Money({ fen, unit, signed, tone }: { fen: number | null | undefined; unit: Unit; signed?: boolean; tone?: boolean }) {
  return <span className={cn("num", tone && fen != null && fen !== 0 && "text-danger font-medium")}>{formatFen(fen, unit, signed)}</span>;
}

export function PageHeader({ title, unit, from, to, mock, mixed }: { title: string; unit: Unit; from: string; to: string; mock?: string; mixed?: boolean }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">
          单位 {unitLabel(unit)} · {from} ~ {to} · {sourceLabel(mock, mixed)}
        </p>
      </div>
      <span className="shrink-0 rounded border bg-sunken px-2 py-0.5 text-[11px] text-muted-foreground">只读</span>
    </div>
  );
}

export function Kpi({ label, value, hint, tone, size = "md", className }: {
  label: string; value: React.ReactNode; hint?: string; tone?: "danger" | "warning"; size?: "lg" | "md" | "sm"; className?: string;
}) {
  return (
    <div className={cn(
      "rounded-lg border bg-surface px-3 py-2.5 h-full",
      size === "lg" && "px-4 py-3",
      tone === "danger" && "border-danger/40 bg-danger-bg/40",
      tone === "warning" && "border-warning/40 bg-warning-bg/50",
      className,
    )}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn(
        "mt-0.5 font-semibold num text-left leading-tight",
        size === "lg" && "text-[28px] md:text-[32px]",
        size === "md" && "text-[22px]",
        size === "sm" && "text-[18px]",
        tone === "danger" && "text-danger",
      )}>{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-1 truncate">{hint}</div>}
    </div>
  );
}

export function Panel({ title, extra, children, flush = false }: { title: string; extra?: React.ReactNode; children: React.ReactNode; flush?: boolean }) {
  return (
    <section className="rounded-lg border bg-surface min-w-0">
      <header className="flex items-center justify-between gap-2 px-3 h-9 border-b bg-sunken/70">
        <h2 className="text-[13px] font-medium">{title}</h2>
        {extra && <div className="text-[11px] text-muted-foreground">{extra}</div>}
      </header>
      <div className={flush ? "" : "p-3"}>{children}</div>
    </section>
  );
}

export function Empty({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="rounded-lg border border-dashed bg-surface p-8 text-center">
      <div className="text-sm font-medium">{title}</div>
      <div className="text-xs text-muted-foreground mt-1">{reason}</div>
    </div>
  );
}

export function Banner({ tone, children }: { tone: "warning" | "info"; children: React.ReactNode }) {
  return <div className={cn("rounded-md px-3 py-2 text-xs", tone === "warning" ? "bg-warning-bg text-warning" : "bg-info-bg text-info")}>{children}</div>;
}

export function Responsive({ table, cards }: { table: React.ReactNode; cards: React.ReactNode }) {
  return (
    <>
      <div className="ledger hidden md:block rounded-lg border bg-surface">{table}</div>
      <div className="md:hidden flex flex-col gap-2">{cards}</div>
    </>
  );
}

export function DayBars({ series }: { series: { day: string; recharge: number; cost: number }[] }) {
  const max = Math.max(1, ...series.map((s) => Math.max(s.recharge, s.cost)));
  return (
    <figure>
      <figcaption className="sr-only">按日充值与消耗，单位与页眉一致</figcaption>
      <div className="flex items-end gap-1.5 h-28" role="img" aria-label="充值与消耗柱">
        {series.map((s) => (
          <div key={s.day} className="flex-1 min-w-0 flex flex-col items-center gap-1">
            <div className="flex items-end justify-center gap-0.5 h-24 w-full">
              <div className="w-2 rounded-sm bg-[#2563eb] dark:bg-[#60a5fa]" style={{ height: s.recharge > 0 ? `${Math.max(4, (s.recharge / max) * 100)}%` : "0%" }} title={`${s.day} 充值`} />
              <div className="w-2 rounded-sm bg-[#93c5fd]" style={{ height: s.cost > 0 ? `${Math.max(4, (s.cost / max) * 100)}%` : "0%" }} title={`${s.day} 消耗`} />
            </div>
            <span className="text-[10px] text-muted-foreground tabular-nums">{s.day.slice(5)}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-[#2563eb] dark:bg-[#60a5fa]" />充值</span>
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-[#93c5fd]" />消耗</span>
      </div>
    </figure>
  );
}

export function SplitBar({ aLabel, a, bLabel, b }: { aLabel: string; a: number; bLabel: string; b: number }) {
  const total = a + b;
  const ap = total > 0 ? (a / total) * 100 : 0;
  const bp = total > 0 ? (b / total) * 100 : 0;
  return (
    <div>
      <div className="h-2 rounded-full bg-sunken overflow-hidden flex" role="img" aria-label={`${aLabel} ${ap.toFixed(0)}%，${bLabel} ${bp.toFixed(0)}%`}>
        <div className="h-full bg-[#2563eb] dark:bg-[#60a5fa]" style={{ width: `${ap}%` }} />
        <div className="h-full bg-[#93c5fd]" style={{ width: `${bp}%` }} />
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
        <span>{aLabel} {total ? `${ap.toFixed(0)}%` : "—"}</span>
        <span>{bLabel} {total ? `${bp.toFixed(0)}%` : "—"}</span>
      </div>
    </div>
  );
}
