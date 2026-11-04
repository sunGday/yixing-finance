"use client";

import { useRef, useSyncExternalStore } from "react";
import { parseFilters, type Filters, type SP } from "./filters";
import { applyQueryPatch } from "./query-patch";

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const SERVER_SEARCH = "";
function getServerSearch() {
  return SERVER_SEARCH;
}
function getClientSearch() {
  return window.location.search;
}

const nativeReplaceState = typeof History === "undefined" ? undefined : History.prototype.replaceState;

function installHistoryPatch() {
  if (typeof window === "undefined") return;
  const w = window as Window & { __yxHistory?: boolean };
  if (w.__yxHistory) return;
  w.__yxHistory = true;
  // 不包一层 history.pushState。Next 15 会把外部 pushState/replaceState 当成路由恢复，
  // 从而挂上 app/loading 的整页骨架。筛选只改地址栏，走原型上的原生 replaceState。
  window.addEventListener("popstate", emit);
}
installHistoryPatch();

/** Link 换了路径之后，把地址栏同步进筛选 store。 */
export function notifyLocation() {
  emit();
}

function toSP(search: string): SP {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const o: SP = {};
  q.forEach((v, k) => {
    o[k] = v;
  });
  return o;
}

export function useFilters(defaults?: Partial<Filters>): Filters {
  const search = useSyncExternalStore(subscribe, getClientSearch, getServerSearch);
  return parseFilters(toSP(search), defaults);
}

export function useQueryString() {
  return useSyncExternalStore(subscribe, getClientSearch, getServerSearch);
}

/**
 * 改 query，不走 Next 路由。replaceState 留在当前历史记录上，
 * 避免每次点击都压一条记录，返回时被 App Router 整页刷新。
 */
export function patchQuery(patch: Record<string, string | null>) {
  if (typeof window === "undefined") return;
  const next = applyQueryPatch(window.location.href, patch);
  if (!next || !nativeReplaceState) return;
  nativeReplaceState.call(window.history, window.history.state, "", next);
  emit();
}

/**
 * 日期已经变了、数据还是上一请求的时候，列表仍按上一份数据的区间筛。
 * 网络、状态、单位走当前筛选，点击立刻生效，不必等接口。
 */
export function useHeldRange(data: unknown, from: string, to: string, enabled: boolean) {
  const ref = useRef({ data, from, to });
  if (!enabled) return { from, to };
  if (data !== ref.current.data) ref.current = { data, from, to };
  return { from: ref.current.from, to: ref.current.to };
}

const KEEP = ["quick", "from", "to", "subs", "unit", "mock", "basis", "section", "detail"];

export function keptHref(path: string, search: string) {
  const cur = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const n = new URLSearchParams();
  for (const k of KEEP) {
    const v = cur.get(k);
    if (v) n.set(k, v);
  }
  const s = n.toString();
  return s ? `${path}?${s}` : path;
}

/** 下钻时写明 quick，避免对账页默认「近7日」改掉概览区间。 */
export function hrefFor(path: string, f: Filters, extra: Record<string, string> = {}) {
  const n = new URLSearchParams();
  if (f.quick === "custom") {
    n.set("quick", "custom");
    n.set("from", f.from);
    n.set("to", f.to);
  } else if (f.quick) n.set("quick", f.quick);
  if (f.subs.length) n.set("subs", f.subs.join(","));
  if (f.unit === "fen") n.set("unit", "fen");
  if (f.basis && f.basis !== "auto") n.set("basis", f.basis);
  if (f.mock) n.set("mock", f.mock);
  for (const [k, v] of Object.entries(extra)) {
    if (v) n.set(k, v);
    else n.delete(k);
  }
  const s = n.toString();
  return s ? `${path}?${s}` : path;
}
