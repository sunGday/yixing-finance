// mario 10C 客户端。包络 {code,msg,request_id,data}；列表 data={items,page,page_size,total}。
// 浏览器：NEXT_PUBLIC_FINANCE_API_BASE=/api/v1。生产由 Route Handler 转发并注入 Bearer。
// Pages 静态导出不设置该变量，页面走 fixtures，且本模块仅在 live 模式动态导入。
// 本文件不读 FIN_API_TOKEN，也不读 NEXT_PUBLIC_FIN_API_TOKEN（禁止把密钥打进浏览器包）。
import { LoadError } from "./errors";

function strip(s: string) { return s.replace(/\/+$/, ""); }

/** 解析后的请求前缀（无尾斜杠） */
export function resolveApiBase(): string {
  const pub = strip(process.env.NEXT_PUBLIC_FINANCE_API_BASE ?? "");
  if (typeof window === "undefined") {
    const internal = strip(process.env.FINANCE_API_INTERNAL_BASE ?? "");
    if (internal) return internal;
    if (pub.startsWith("http")) return pub;
    // 相对 /api/v1，且没有 internal base：SSR 打本机 mario。浏览器走同源，由 BFF 转发。
    if (pub.startsWith("/")) return `http://127.0.0.1:8787${pub}`;
    return "http://127.0.0.1:8787/api/v1";
  }
  return pub || "/api/v1";
}

export const API_BASE = resolveApiBase();

type Envelope<T> = { code?: number; msg?: string; request_id?: string; data?: T };

function gapFlagsOf(data: unknown): string[] | undefined {
  if (!data || typeof data !== "object") return undefined;
  const raw = (data as { gap_flags?: unknown }).gap_flags;
  if (!Array.isArray(raw)) return undefined;
  const flags = raw.filter((item): item is string => typeof item === "string");
  return flags.length ? flags : undefined;
}

function fail(path: string, res: Response, body: Envelope<unknown>): never {
  const code = typeof body.code === "number" ? body.code : undefined;
  throw new LoadError(
    path,
    `code=${code ?? res.status} ${body.msg ?? ""}`.trim(),
    typeof body.request_id === "string" ? body.request_id : undefined,
    code,
    gapFlagsOf(body.data),
  );
}

export async function apiList<T>(path: string, params: Record<string, string | undefined>): Promise<T[]> {
  const base = resolveApiBase();
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  qs.set("page_size", "500");
  let res: Response;
  try {
    res = await fetch(`${base}${path}?${qs}`, { cache: "no-store" });
  } catch (e) {
    throw new LoadError(path, `网络错误：${String(e)}`);
  }
  let body: Envelope<{ items: T[] } | T[]>;
  try { body = await res.json(); } catch { throw new LoadError(path, `HTTP ${res.status}：非 JSON 响应`, undefined, res.status); }
  if (!res.ok || body.code !== 0) fail(path, res, body);
  const d = body.data;
  return Array.isArray(d) ? d : d?.items ?? [];
}

/** Envelope call for non-list routes. Does not log the body. */
export async function apiSend<T>(path: string, init?: { method?: string; body?: unknown; cache?: RequestCache }): Promise<T> {
  const base = resolveApiBase();
  const method = (init?.method ?? "GET").toUpperCase();
  const headers = new Headers();
  headers.set("cache-control", "no-store");
  if (init?.body !== undefined) headers.set("content-type", "application/json");
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      cache: "no-store",
      headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch (e) {
    throw new LoadError(path, `网络错误：${String(e)}`);
  }
  if (res.status === 204) return undefined as T;
  let body: Envelope<T>;
  try { body = await res.json(); } catch { throw new LoadError(path, `HTTP ${res.status}：非 JSON 响应`, undefined, res.status); }
  if (!res.ok || body.code !== 0) fail(path, res, body);
  return body.data as T;
}
