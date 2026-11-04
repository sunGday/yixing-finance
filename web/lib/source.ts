/**
 * Pages（NEXT_PUBLIC_FINANCE_MODE=fixtures）只用样例。
 * next dev / next start 默认 MODE=live，浏览器请求 /api/v1（rewrite → 127.0.0.1:8787）。
 * ?mock=1 强制样例，?mock=error 强制错误态。
 */
export function wantsLive(mock?: string) {
  if (mock === "1" || mock === "error") return false;
  if (process.env.NEXT_PUBLIC_FINANCE_MODE === "fixtures") return false;
  if (process.env.NEXT_PUBLIC_FINANCE_MODE === "live") return true;
  return (process.env.NEXT_PUBLIC_FINANCE_API_BASE ?? "").trim().length > 0;
}

/** 筛选条角标。短中文。 */
export function sourceLabel(mock: string | undefined, mixed = false) {
  if (mock === "error") return "故障演示";
  if (!wantsLive(mock)) return "演示 fixtures";
  return mixed ? "真数据 · 消耗/快照样例" : "真数据";
}

export function sourceTitle(mock: string | undefined, mixed = false) {
  if (mock === "error") return "数据来源：?mock=error，不请求接口";
  if (!wantsLive(mock)) return "数据来源：fixtures 演示。GitHub Pages 与 ?mock=1 走这条路径，到不了 8787";
  if (mixed) return "数据来源：充值/收入/对账走 /api/v1 → 127.0.0.1:8787。消耗与余额快照接口是空 stub，这两块仍用样例";
  return "数据来源：真数据，浏览器 /api/v1 → 127.0.0.1:8787";
}
