import type { NextConfig } from "next";

/**
 * GitHub Pages：`npm run build:pages` 设 STATIC_EXPORT=1 → output: 'export'。
 * 该模式清空 NEXT_PUBLIC_FINANCE_API_BASE，页面只用 fixtures。
 *
 * next dev：rewrite /api/v1 → FINANCE_API_INTERNAL_BASE（本机 open-dev）。
 * production（next build / next start）：不注册 rewrite。流量进
 * app/api/v1/[...path]/route.ts，由服务端注入 Authorization。
 * rewrite 不能加 Bearer，生产不能靠它。
 */
if ((process.env.NEXT_PUBLIC_FIN_API_TOKEN ?? "").trim()) {
  throw new Error(
    "NEXT_PUBLIC_FIN_API_TOKEN is forbidden. Put the secret in server-only FIN_API_TOKEN. The browser calls /api/v1; the Route Handler adds Authorization.",
  );
}

const MARIO = (process.env.FINANCE_API_INTERNAL_BASE || "http://127.0.0.1:8787/api/v1").replace(/\/+$/, "");
const staticExport = process.env.STATIC_EXPORT === "1";
const productionServer = !staticExport && process.env.NODE_ENV === "production";

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
  // Pages links keep a trailing slash. Skip the redirect so /api/v1/* hits the BFF
  // on the first request (browser fetches do not include a trailing slash).
  skipTrailingSlashRedirect: true,
  env: {
    NEXT_PUBLIC_FINANCE_API_BASE: process.env.NEXT_PUBLIC_FINANCE_API_BASE ?? "",
    NEXT_PUBLIC_FINANCE_MODE: process.env.NEXT_PUBLIC_FINANCE_MODE ?? "fixtures",
  },
  ...(base ? { basePath: base } : {}),
  ...(staticExport
    ? { output: "export" as const }
    : productionServer
      ? {}
      : {
          async rewrites() {
            return [{ source: "/api/v1/:path*", destination: `${MARIO}/:path*` }];
          },
        }),
};

export default nextConfig;
