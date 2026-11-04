"use client";

import { useEffect, useRef, useState } from "react";
import { LoadError } from "./errors";

export type LiveError = { path: string; message: string; requestId?: string; code?: number; gapFlags?: string[] };
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
          setState({
            loading: false,
            error: { path: e.path, message: e.message, requestId: e.request_id, code: e.code, gapFlags: e.gap_flags },
          });
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

function withQuery(path: string, params: Record<string, string | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

/**
 * 拉一个对象接口（总览 / 卡片 / 结算单）。与列表分开，卡片慢不会挡住别的请求。
 * api-client 仍是动态导入。
 */
export function useLiveValue<T>(
  enabled: boolean,
  path: string,
  params: Record<string, string | undefined>,
  map: (data: unknown) => T,
) {
  const key = enabled ? JSON.stringify({ path, params }) : "";
  const mapRef = useRef(map);
  mapRef.current = map;
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<{ loading: boolean; data?: T; error?: LiveError }>({ loading: enabled });

  useEffect(() => {
    if (!enabled) {
      setState({ loading: false });
      return;
    }
    let cancel = false;
    setState({ loading: true });
    const snapshot = JSON.parse(key) as { path: string; params: Record<string, string | undefined> };
    (async () => {
      try {
        const { apiSend } = await import("./api-client");
        const data = await apiSend<unknown>(withQuery(snapshot.path, snapshot.params));
        const mapped = mapRef.current(data);
        if (!cancel) setState({ loading: false, data: mapped });
      } catch (e) {
        if (cancel) return;
        if (e instanceof LoadError) {
          setState({
            loading: false,
            error: { path: e.path, message: e.message, requestId: e.request_id, code: e.code, gapFlags: e.gap_flags },
          });
        } else {
          setState({ loading: false, error: { path: snapshot.path, message: e instanceof Error ? e.message : String(e) } });
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, [enabled, key, tick]);

  return { ...state, retry: () => setTick((n) => n + 1) };
}
