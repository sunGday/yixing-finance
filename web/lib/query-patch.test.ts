import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyQueryPatch } from "./query-patch.ts";

describe("applyQueryPatch", () => {
  it("updates one param and leaves the path", () => {
    const next = applyQueryPatch("http://localhost/revenues/?quick=yesterday", { quick: "year" });
    assert.equal(next, "/revenues/?quick=year");
  });

  it("returns null when the patch is a no-op", () => {
    assert.equal(applyQueryPatch("http://localhost/revenues/?basis=estimate", { basis: "estimate" }), null);
  });

  it("deletes a param when the value is null", () => {
    assert.equal(applyQueryPatch("http://localhost/revenues/?detail=1", { detail: null }), "/revenues/");
  });
});
