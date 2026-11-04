"use client";

import { useEffect, useRef, useState } from "react";
import { LoadError } from "./errors";
import { liveDrop, liveKey, livePhase, liveRead, liveWrite } from "./live-cache";

export type LiveError = { path: string; message: string; requestId?: string; code?: number; gapFlags?: string[] };
export type LiveJob = { key: string; path: string; params: Record<string, string | undefined> };
export type LiveState<T> = { loading: boolean; refreshing: boolean; data?: T; error?: LiveError };

function isAbort(e: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return true;
  return !!e && typeof e === "object" && (e as { name?: string }).name === "AbortError";
}

function toLiveError(e: unknown, path: string): LiveError {
  if (e instanceof LoadError) {
    return { path: e.path, message: e.message, requestId: e.request_id, code: e.code, gapFlags: e.gap_flags };
  }
  return { path, message: e instanceof Error ? e.message : String(e) };
}

/**
 * 并行拉一组列表。有缓存或上一份数据时不把界面清空。
 * 同一 key 的过期请求会被 abort，返回后直接丢掉。
 */
export function useLiveMap(enabled: boolean, jobs: LiveJob[]) {
  const key = enabled ? JSON.stringify(jobs) : "";
  const [tick, setTick] = useState(0);
  const forceRef = useRef(false);
  const dataRef = useRef<Record<string, unknown[]> | undefined>(undefined);
  const [state, setState] = useState<LiveState<Record<string, unknown[]>>>(() => ({ loading: enabled, refreshing: false }));

  if (state.data) dataRef.current = state.data;

  useEffect(() => {
    if (!enabled) {
      setState((prev) => ({ ...prev, loading: false, refreshing: false }));
      return;
    }
    const force = forceRef.current;
    forceRef.current = false;
    const snapshot = JSON.parse(key) as LiveJob[];
    if (force) for (const job of snapshot) liveDrop(liveKey(job.path, job.params));
    const cached = !force && snapshot.every((job) => liveRead(liveKey(job.path, job.params)) !== undefined);
    const phase = livePhase({ enabled, cached, hasData: dataRef.current !== undefined, force });
    const ac = new AbortController();
    let cancel = false;

    const apply = (pairs: (readonly [string, unknown[]])[]) => {
      const data = Object.fromEntries(pairs);
      dataRef.current = data;
      setState({ loading: false, refreshing: false, data });
    };

    if (!phase.fetch) {
      apply(snapshot.map((job) => [job.key, liveRead(liveKey(job.path, job.params)) as unknown[]] as const));
      return () => { cancel = true; ac.abort(); };
    }

    setState((prev) => ({
      loading: prev.data === undefined,
      refreshing: prev.data !== undefined,
      data: prev.data,
      error: undefined,
    }));
    const timer = setTimeout(() => {
      (async () => {
        try {
          const { apiList } = await import("./api-client");
          const pairs = await Promise.all(snapshot.map(async (job) => {
            const cacheKey = liveKey(job.path, job.params);
            if (!force) {
              const hit = liveRead(cacheKey);
              if (hit !== undefined) return [job.key, hit as unknown[]] as const;
            }
            const rows = await apiList<unknown>(job.path, job.params, ac.signal);
            liveWrite(cacheKey, rows);
            return [job.key, rows] as const;
          }));
          if (!cancel) apply(pairs);
        } catch (e) {
          if (cancel || isAbort(e, ac.signal)) return;
          const job = snapshot[0];
          setState((prev) => ({
            loading: false,
            refreshing: false,
            data: prev.data,
            error: toLiveError(e, job?.path ?? "(network)"),
          }));
        }
      })();
    }, phase.delayMs);

    return () => {
      cancel = true;
      ac.abort();
      clearTimeout(timer);
    };
  }, [enabled, key, tick]);

  return { ...state, retry: () => { forceRef.current = true; setTick((n) => n + 1); } };
}

function withQuery(path: string, params: Record<string, string | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

/**
 * 拉一个对象接口（总览 / 卡片 / 结算单）。
 * 筛选变了先留着上一份，角标「更新中」，新响应到达再换。
 */
export function useLiveValue<T>(
  enabled: boolean,
  path: string,
  params: Record<string, string | undefined>,
  map: (data: unknown) => T,
) {
  const key = enabled ? liveKey(path, params) : "";
  const mapRef = useRef(map);
  mapRef.current = map;
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const [tick, setTick] = useState(0);
  const forceRef = useRef(false);
  const dataRef = useRef<T | undefined>(undefined);
  const [state, setState] = useState<LiveState<T>>(() => ({ loading: enabled, refreshing: false }));

  if (state.data !== undefined) dataRef.current = state.data;

  useEffect(() => {
    if (!enabled) {
      setState((prev) => ({ ...prev, loading: false, refreshing: false }));
      return;
    }
    const force = forceRef.current;
    forceRef.current = false;
    if (force) liveDrop(key);
    const raw = !force ? liveRead(key) : undefined;
    const phase = livePhase({ enabled, cached: raw !== undefined, hasData: dataRef.current !== undefined, force });
    const ac = new AbortController();
    let cancel = false;
    const snapshot = { path, params: paramsRef.current };

    if (!phase.fetch && raw !== undefined) {
      try {
        const mapped = mapRef.current(raw);
        dataRef.current = mapped;
        setState({ loading: false, refreshing: false, data: mapped });
      } catch (e) {
        setState({ loading: false, refreshing: false, error: toLiveError(e, path) });
      }
      return () => { cancel = true; ac.abort(); };
    }

    setState((prev) => ({
      loading: prev.data === undefined,
      refreshing: prev.data !== undefined,
      data: prev.data,
      error: undefined,
    }));
    const timer = setTimeout(() => {
      (async () => {
        try {
          const { apiSend } = await import("./api-client");
          const data = await apiSend<unknown>(withQuery(snapshot.path, snapshot.params), { signal: ac.signal });
          if (cancel) return;
          liveWrite(key, data);
          const mapped = mapRef.current(data);
          dataRef.current = mapped;
          setState({ loading: false, refreshing: false, data: mapped });
        } catch (e) {
          if (cancel || isAbort(e, ac.signal)) return;
          setState((prev) => ({
            loading: false,
            refreshing: false,
            data: prev.data,
            error: toLiveError(e, snapshot.path),
          }));
        }
      })();
    }, phase.delayMs);

    return () => {
      cancel = true;
      ac.abort();
      clearTimeout(timer);
    };
  }, [enabled, key, path, tick]); // params are read from paramsRef; key already changes when they do

  return { ...state, retry: () => { forceRef.current = true; setTick((n) => n + 1); } };
}
