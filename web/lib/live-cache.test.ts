import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { liveDropPrefix, liveKey, livePhase, liveRead, liveWrite } from "./live-cache.ts";

describe("live cache", () => {
  it("keeps a fresh value and drops it after ttl", () => {
    const key = liveKey("/revenues/overview", { from: "2026-01-01", to: "2026-11-03", basis: "estimate" });
    liveWrite(key, { total_fen: 1 }, 1_000);
    assert.deepEqual(liveRead(key, 1_000 + 59_000), { total_fen: 1 });
    assert.equal(liveRead(key, 1_000 + 60_001), undefined);
  });

  it("drops a path prefix without touching other paths", () => {
    liveWrite(liveKey("/revenues/overview", { basis: "estimate" }), { ok: 1 }, 1);
    liveWrite("/settlements", [], 1);
    liveDropPrefix("/revenues");
    assert.equal(liveRead(liveKey("/revenues/overview", { basis: "estimate" }), 1), undefined);
    assert.deepEqual(liveRead("/settlements", 1), []);
  });

  it("does not refetch a cached key, and does not blank when data is already on screen", () => {
    assert.deepEqual(livePhase({ enabled: true, cached: true, hasData: true, force: false }), {
      loading: false, refreshing: false, fetch: false, delayMs: 0,
    });
    assert.deepEqual(livePhase({ enabled: true, cached: false, hasData: true, force: false }), {
      loading: false, refreshing: true, fetch: true, delayMs: 100,
    });
    assert.deepEqual(livePhase({ enabled: true, cached: false, hasData: false, force: false }).loading, true);
  });
});
