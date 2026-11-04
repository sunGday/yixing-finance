import type { NextConfig } from "next";

/**
 * GitHub Pages：`npm run build:pages` 设置 STATIC_EXPORT=1，产出 `output: 'export'`。
 * 本地 `next dev` / `next build` 不导出，保留 /api/v1 rewrite → mario :8787。
 * Pages 构建不要设置 NEXT_PUBLIC_FINANCE_API_BASE，浏览器只读 fixtures。
 */
const MARIO = (process.env.FINANCE_API_INTERNAL_BASE || "http://127.0.0.1:8787/api/v1").replace(/\/+$/, "");
const staticExport = process.env.STATIC_EXPORT === "1";
const base = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/$/, "");

const nextConfig: NextConfig = {
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
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
