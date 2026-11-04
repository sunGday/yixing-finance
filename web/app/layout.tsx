import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Suspense } from "react";
import "./globals.css";
import { AppShell } from "@/components/fin/shell";

export const metadata: Metadata = { title: "翊行财务 · 只读", description: "翊行二代户充值、收入、对账（只读）" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased">
        <Script id="yx-theme" strategy="beforeInteractive">{`(function(){try{if(localStorage.getItem("yx-theme")==="dark")document.documentElement.classList.add("dark")}catch(e){}})()`}</Script>
        <Suspense fallback={null}><AppShell>{children}</AppShell></Suspense>
      </body>
    </html>
  );
}
