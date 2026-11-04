"use client";

import { useSyncExternalStore } from "react";
import { parseFilters, type Filters, type SP } from "./filters";

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

function installHistoryPatch() {
  if (typeof window === "undefined") return;
  const w = window as Window & { __yxHistory?: boolean };
  if (w.__yxHistory) return;
  w.__yxHistory = true;
  const wrap = (orig: typeof history.pushState) =>
    function (this: History, ...args: Parameters<typeof history.pushState>) {
      const ret = orig.apply(this, args);
      emit();
      return ret;
    };
  history.pushState = wrap(history.pushState);
  history.replaceState = wrap(history.replaceState);
  window.addEventListener("popstate", emit);
}
installHistoryPatch();

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

/** 改 query，不走服务端。静态页与 dev 共用。 */
export function patchQuery(patch: Record<string, string | null>) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(patch)) {
    if (v == null || v === "") url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (next === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
  window.history.pushState(window.history.state, "", next);
}

const KEEP = ["quick", "from", "to", "subs", "unit", "mock"];

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
  if (f.mock) n.set("mock", f.mock);
  for (const [k, v] of Object.entries(extra)) {
    if (v) n.set(k, v);
    else n.delete(k);
  }
  const s = n.toString();
  return s ? `${path}?${s}` : path;
}
