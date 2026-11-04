/** 浏览器内存缓存。只存接口 data，不存密钥。刷新页即丢。 */
export const LIVE_TTL_MS = 60_000;
export const LIVE_DEBOUNCE_MS = 100;

type Entry = { at: number; data: unknown };
const mem = new Map<string, Entry>();
const MAX = 48;

export function liveKey(path: string, params: Record<string, string | undefined>): string {
  const parts = Object.keys(params)
    .filter((k) => params[k] && k !== "page_size")
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k] as string)}`);
  return parts.length ? `${path}?${parts.join("&")}` : path;
}

export function liveRead(key: string, now = Date.now(), ttl = LIVE_TTL_MS): unknown | undefined {
  const hit = mem.get(key);
  if (!hit) return undefined;
  if (now - hit.at > ttl) {
    mem.delete(key);
    return undefined;
  }
  return hit.data;
}

export function liveWrite(key: string, data: unknown, now = Date.now()) {
  mem.set(key, { at: now, data });
  if (mem.size <= MAX) return;
  let oldestKey = key;
  let oldestAt = now;
  for (const [k, entry] of mem) {
    if (entry.at < oldestAt) {
      oldestAt = entry.at;
      oldestKey = k;
    }
  }
  mem.delete(oldestKey);
}

function matches(key: string, prefix: string) {
  return key === prefix || key.startsWith(`${prefix}?`) || key.startsWith(`${prefix}/`);
}

export function liveDrop(key: string) {
  mem.delete(key);
}

export function liveDropPrefix(prefix: string) {
  for (const key of [...mem.keys()]) if (matches(key, prefix)) mem.delete(key);
}

export function livePhase(input: { enabled: boolean; cached: boolean; hasData: boolean; force: boolean }): {
  loading: boolean; refreshing: boolean; fetch: boolean; delayMs: number;
} {
  if (!input.enabled) return { loading: false, refreshing: false, fetch: false, delayMs: 0 };
  if (input.cached && !input.force) return { loading: false, refreshing: false, fetch: false, delayMs: 0 };
  if (input.force) return { loading: !input.hasData, refreshing: input.hasData, fetch: true, delayMs: 0 };
  return {
    loading: !input.hasData,
    refreshing: input.hasData,
    fetch: true,
    delayMs: input.hasData ? LIVE_DEBOUNCE_MS : 0,
  };
}
