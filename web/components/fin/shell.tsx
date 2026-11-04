"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Coins, LayoutDashboard, Scale, Wallet } from "lucide-react";
import { AGENCY_OWNER_ID } from "@/lib/types";
import { keptHref, useQueryString } from "@/lib/url-state";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme";

const NAV = [
  { href: "/", label: "概览", short: "概览", icon: LayoutDashboard },
  { href: "/recharges", label: "充值流水", short: "充值", icon: Wallet },
  { href: "/revenues", label: "收入流水", short: "收入", icon: Coins },
  { href: "/reconcile", label: "对账汇总", short: "对账", icon: Scale },
];

function norm(p: string) {
  if (p.length > 1 && p.endsWith("/")) return p.slice(0, -1);
  return p || "/";
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = norm(usePathname() || "/");
  const search = useQueryString();
  const active = (href: string) => path === href;
  return (
    <div className="min-h-dvh md:flex">
      <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded focus:bg-surface focus:px-3 focus:py-2">跳到内容</a>
      <aside className="yx-side hidden md:flex w-56 shrink-0 flex-col sticky top-0 h-dvh border-r border-white/10">
        <div className="flex items-center gap-2 px-3 py-4 border-b border-white/10">
          <span className="grid size-8 place-items-center rounded-md bg-brand text-sm font-semibold text-white" aria-hidden>翊</span>
          <span>
            <span className="block text-sm font-semibold leading-tight">翊行财务</span>
            <span className="block text-[11px] text-white/55">只读台账</span>
          </span>
        </div>
        <div className="px-3 pt-3 pb-1 text-[11px] tracking-wide text-white/40">账本</div>
        <nav className="px-2 flex flex-col gap-0.5" aria-label="主导航">
          {NAV.map(({ href, label, icon: I }) => (
            <Link key={href} href={keptHref(href, search)} aria-current={active(href) ? "page" : undefined}
              className={cn("flex items-center gap-2 rounded-md px-2.5 h-9 text-sm text-white/75 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                active(href) && "bg-brand/20 text-white font-medium shadow-[inset_2px_0_0_#60a5fa]")}>
              <I className="size-4 shrink-0" />{label}
            </Link>
          ))}
          <span className="flex items-center px-2.5 h-9 text-sm text-white/35">报表（二期）</span>
        </nav>
        <div className="mt-auto p-3 border-t border-white/10 flex flex-col gap-2">
          <div className="text-[11px] leading-relaxed text-white/50">
            代理商锁定<br />
            <span className="mono text-white/80">{AGENCY_OWNER_ID}</span>
          </div>
          <ThemeToggle className="h-8 rounded-md border border-white/15 px-2 text-xs text-white/80 hover:bg-white/5" />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <main id="content" className="flex-1 min-w-0 pb-[calc(3.75rem+env(safe-area-inset-bottom))] md:pb-0">{children}</main>
      </div>
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 grid grid-cols-4 border-t bg-surface/95 backdrop-blur pb-[env(safe-area-inset-bottom)]" aria-label="主导航">
        {NAV.map(({ href, short, icon: I }) => (
          <Link key={href} href={keptHref(href, search)} aria-current={active(href) ? "page" : undefined}
            className={cn("flex flex-col items-center justify-center h-14 text-[11px] gap-0.5", active(href) ? "text-brand font-medium" : "text-muted-foreground")}>
            <I className="size-5" />{short}
          </Link>
        ))}
      </nav>
    </div>
  );
}
