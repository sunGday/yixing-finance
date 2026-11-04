/** 纯函数：把 query 补丁应用到绝对 URL。无变化返回 null。 */
export function applyQueryPatch(href: string, patch: Record<string, string | null>): string | null {
  const url = new URL(href);
  const before = `${url.pathname}${url.search}${url.hash}`;
  for (const [k, v] of Object.entries(patch)) {
    if (v == null || v === "") url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  const next = `${url.pathname}${url.search}${url.hash}`;
  return next === before ? null : next;
}
