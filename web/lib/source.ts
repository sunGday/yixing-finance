/** 未设置 NEXT_PUBLIC_FINANCE_API_BASE，或 ?mock=1 / ?mock=error → fixtures。Pages 构建不注入 BASE。 */
export function wantsLive(mock?: string) {
  if (mock === "1" || mock === "error") return false;
  return (process.env.NEXT_PUBLIC_FINANCE_API_BASE ?? "").trim().length > 0;
}

export function sourceLabel(mock: string | undefined, mixed = false) {
  if (mock === "error") return "mock 故障";
  if (!wantsLive(mock)) return "fixtures";
  return mixed ? "API + fixtures（消耗/快照无路径）" : "mario /api/v1";
}
