import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  "content-encoding",
]);

/** Runtime read. Direct `process.env.NAME` can be inlined at `next build`. */
function readEnv(name: string): string {
  return (process.env[name] ?? "").trim();
}

function internalBase(): string {
  const raw = readEnv("FINANCE_API_INTERNAL_BASE") || "http://127.0.0.1:8787/api/v1";
  return raw.replace(/\/+$/, "");
}

function targetUrl(parts: string[], search: string): string {
  const suffix = parts.filter((part) => part.length > 0).map((part) => encodeURIComponent(part)).join("/");
  return `${internalBase()}/${suffix}${search}`;
}

function jsonError(status: number, code: number, msg: string) {
  return NextResponse.json({ code, msg, request_id: "bff", data: null }, { status });
}

async function proxy(req: NextRequest, parts: string[]) {
  if (readEnv("NEXT_PUBLIC_FIN_API_TOKEN")) {
    return jsonError(500, 50001, "NEXT_PUBLIC_FIN_API_TOKEN is forbidden");
  }

  const token = readEnv("FIN_API_TOKEN");
  if (token && /[\r\n]/.test(token)) {
    return jsonError(500, 50001, "FIN_API_TOKEN is invalid");
  }

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP.has(lower) || lower === "authorization" || lower === "cookie") return;
    headers.set(key, value);
  });
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const method = req.method.toUpperCase();
  const url = targetUrl(parts, new URL(req.url).search);
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : await req.arrayBuffer(),
      cache: "no-store",
      redirect: "manual",
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return jsonError(502, 50201, `finance api unreachable: ${detail}`);
  }

  const out = new Headers();
  upstream.headers.forEach((value, key) => {
    if (HOP.has(key.toLowerCase())) return;
    out.set(key, value);
  });
  return new NextResponse(upstream.body, { status: upstream.status, headers: out });
}

type Ctx = { params: Promise<{ path: string[] }> };

async function handle(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(req, path ?? []);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
