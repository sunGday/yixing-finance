export type Unit = "yuan" | "fen";
/** 分 → 元字符串（2 位小数，千分位）；null → 「—」，不伪造 0 */
export function fenToYuan(fen: number | null | undefined): string {
  if (fen == null) return "—";
  const sign = fen < 0 ? "−" : "";
  return sign + (Math.abs(fen) / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function formatFen(fen: number | null | undefined, unit: Unit = "yuan", signed = false): string {
  if (fen == null) return "—";
  const s = unit === "fen" ? (fen < 0 ? "−" : "") + Math.abs(fen).toLocaleString("zh-CN") : fenToYuan(fen);
  return signed && fen > 0 ? "+" + s : s;
}
export const unitLabel = (u: Unit) => (u === "fen" ? "分" : "元");
