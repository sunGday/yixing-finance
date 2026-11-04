import type { NextConfig } from "next";

/**
 * GitHub Pages：`npm run build:pages` 设 STATIC_EXPORT=1 → output: 'export'。
 * 该模式清空 NEXT_PUBLIC_FINANCE_API_BASE，页面只用 fixtures。
 * next dev / next start：未另外指定时默认 /api/v1，并由 rewrite 转到 mario :8787。
 */
const MARIO = (process.env.FINANCE_API_INTERNAL_BASE || "http://127.0.0.1:8787/api/v1").replace(/\/+$/, "");
const staticExport = process.env.STATIC_EXPORT === "1";

if (staticExport) {
  process.env.NEXT_PUBLIC_FINANCE_API_BASE = "";
  process.env.NEXT_PUBLIC_FINANCE_MODE = "fixtures";
} else {
  if (!(process.env.NEXT_PUBLIC_FINANCE_API_BASE ?? "").trim()) {
    process.env.NEXT_PUBLIC_FINANCE_API_BASE = "/api/v1";
  }
  process.env.NEXT_PUBLIC_FINANCE_MODE = "live";
}

const base = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/$/, "");

const nextConfig: NextConfig = {
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_FINANCE_API_BASE: process.env.NEXT_PUBLIC_FINANCE_API_BASE ?? "",
    NEXT_PUBLIC_FINANCE_MODE: process.env.NEXT_PUBLIC_FINANCE_MODE ?? "fixtures",
  },
  ...(base ? { basePath: base } : {}),
  ...(staticExport
    ? { output: "export" }
    : {
        async rewrites() {
          return [{ source: "/api/v1/:path*", destination: `${MARIO}/:path*` }];
        },
      }),
};

export default nextConfig;
