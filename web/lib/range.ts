const addDays = (d: string, n: number) => {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

/** today 默认由调用方传入。收入「本年」截止到昨天，预估不含今天。 */
export function quickRange(q: string, today: string): [string, string] {
  const yest = addDays(today, -1);
  if (q === "7d") return [addDays(today, -7), yest];
  if (q === "week") { const w = new Date(today + "T00:00:00Z").getUTCDay() || 7; return [addDays(today, 1 - w), today]; }
  if (q === "month") return [today.slice(0, 8) + "01", today];
  if (q === "year") {
    const start = `${today.slice(0, 4)}-01-01`;
    return [start, yest < start ? start : yest];
  }
  return [yest, yest];
}
