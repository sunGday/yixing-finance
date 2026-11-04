"use client";

import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Banner } from "@/components/fin/ui";
import { API_PERSIST_NOTE, CREDENTIALS_HREF } from "@/lib/credentials";
import { cn } from "@/lib/utils";

export function CredentialGapBanner({
  message,
  requestId,
  gapFlags,
  onRetry,
  showSync,
}: {
  message: string;
  requestId?: string;
  gapFlags?: string[];
  onRetry?: () => void;
  showSync?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div role="status" className="rounded-lg border border-warning/40 bg-warning-bg px-4 py-3 text-sm">
        <div className="font-medium">收入渠道凭证未配齐</div>
        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
          财务 API 返回凭证缺失。渠道和字段以 schema 为准，在凭证页提交后由 API 保存并热加载。
        </p>
        <div className="mono mt-2 text-[11px] text-muted-foreground">{message}</div>
        {gapFlags && gapFlags.length > 0 ? <div className="mono mt-1 text-[11px] text-muted-foreground">{gapFlags.join(" · ")}</div> : null}
        {requestId ? <div className="mono mt-1 text-[11px] text-muted-foreground">request_id: {requestId}</div> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href={CREDENTIALS_HREF} className={cn(buttonVariants({ size: "sm" }), "h-9")}>去录入渠道凭证</Link>
          <Button type="button" size="sm" variant="outline" className="h-9" onClick={onRetry}>重新加载</Button>
        </div>
      </div>
      {showSync ? <Banner tone="info">{API_PERSIST_NOTE}</Banner> : null}
    </div>
  );
}
