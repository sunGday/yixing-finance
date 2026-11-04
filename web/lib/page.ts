import { LoadError } from "./errors";

/** 统一错误捕获：返回 {data} 或 {error} */
export async function safe<T>(fn: () => Promise<T>): Promise<{ data: T; error?: undefined } | { data?: undefined; error: { path: string; message: string; requestId?: string } }> {
  try { return { data: await fn() }; }
  catch (e) {
    if (e instanceof LoadError) return { error: { path: e.path, message: e.message, requestId: e.request_id } };
    return { error: { path: "(unknown)", message: String(e) } };
  }
}
