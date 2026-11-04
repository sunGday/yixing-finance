"use client";

import { useEffect, useState } from "react";
import { LoadError } from "./errors";

export type LiveError = { path: string; message: string; requestId?: string };
export type LiveJob = { key: string; path: string; params: Record<string, string | undefined> };

/**
 * 并行拉一组列表。api-client 动态导入，fixtures 默认路径不下载这段。
 * 依赖用 JSON key，避免 jobs 数组每次新建触发重复请求。
 */
export function useLiveMap(enabled: boolean, jobs: LiveJob[]) {
  const key = enabled ? JSON.stringify(jobs) : "";
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<{ loading: boolean; data?: Record<string, unknown[]>; error?: LiveError }>({
    loading: enabled,
  });

  useEffect(() => {
    if (!enabled) {
      setState({ loading: false });
      return;
    }
    let cancel = false;
    setState({ loading: true });
    const snapshot = JSON.parse(key) as LiveJob[];
    (async () => {
      try {
        const { apiList } = await import("./api-client");
        const pairs = await Promise.all(
          snapshot.map(async (j) => [j.key, await apiList<unknown>(j.path, j.params)] as const),
        );
        if (!cancel) setState({ loading: false, data: Object.fromEntries(pairs) });
      } catch (e) {
        if (cancel) return;
        if (e instanceof LoadError) {
          setState({ loading: false, error: { path: e.path, message: e.message, requestId: e.request_id } });
        } else {
          setState({ loading: false, error: { path: "(network)", message: String(e) } });
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, [enabled, key, tick]);

  return { ...state, retry: () => setTick((n) => n + 1) };
}
