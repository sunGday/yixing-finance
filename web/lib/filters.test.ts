import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { quickRange } from "./range.ts";

describe("year range", () => {
  it("uses this year through yesterday, not a single day", () => {
    assert.deepEqual(quickRange("year", "2026-11-04"), ["2026-01-01", "2026-11-03"]);
    assert.deepEqual(quickRange("yesterday", "2026-11-04"), ["2026-11-03", "2026-11-03"]);
    assert.deepEqual(quickRange("year", "2026-01-01"), ["2026-01-01", "2026-01-01"]);
  });

  it("keeps the revenue page default on the year estimate", () => {
    const src = readFileSync(new URL("./filters.ts", import.meta.url), "utf8");
    assert.match(src, /quick:\s*"year"/);
    assert.match(src, /basis:\s*"estimate"/);
  });
});
