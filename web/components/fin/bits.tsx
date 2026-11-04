"use client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

const TONE: Record<string, string> = {
  matched: "success", posted: "success", settled: "success", paid: "success",
  partial: "warning", estimated: "warning",
  unmatched: "danger", reversed: "danger",
  raw: "muted",
};
const LBL: Record<string, string> = {
  matched: "已匹配", partial: "部分匹配", unmatched: "未匹配", raw: "原始", posted: "已过账", reversed: "已冲正",
  estimated: "预估", settled: "已结算", paid: "已到账",
};
/** 文字 + 色点，不只靠颜色 */
export function StatusChip({ s }: { s?: string | null }) {
  if (!s) return <span className="text-muted-foreground">—</span>;
  const t = TONE[s] ?? "muted";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs whitespace-nowrap",
      t === "success" && "bg-success-bg text-success", t === "warning" && "bg-warning-bg text-warning",
      t === "danger" && "bg-danger-bg text-danger", t === "muted" && "bg-sunken text-muted-foreground border")}>
      <span className="size-1.5 rounded-full bg-current" />{LBL[s] ?? s}
    </span>
  );
}
export function SourceTag({ s }: { s: string }) {
  return <span className="rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground">{s}</span>;
}
export function ErrorState({ path, message, requestId, onRetry }: { path: string; message: string; requestId?: string; onRetry?: () => void }) {
  const r = useRouter();
  return (
    <div role="alert" className="rounded-lg border border-danger/30 bg-danger-bg p-4 text-sm">
      <div className="font-medium text-danger">拉取 {path} 失败：{message}</div>
      {requestId && <div className="mono text-muted-foreground mt-1">request_id: {requestId}</div>}
      <div className="mt-1 text-muted-foreground">请稍后重试。</div>
      <Button size="sm" variant="outline" className="mt-3 h-10" onClick={() => (onRetry ? onRetry() : r.refresh())}>重新加载</Button>
    </div>
  );
}
