import { test } from "node:test";
import assert from "node:assert/strict";
import { ddmin } from "../src/ddmin.js";

// Oracle: a subset "fails" if it contains all of `needed`.
function oracleFor(needed) {
  return async (subset) => (needed.every((x) => subset.includes(x)) ? "fail" : "pass");
}

test("isolates a single culprit out of many", async () => {
  const items = Array.from({ length: 32 }, (_, i) => `pkg${i}`);
  const { culprits, tests } = await ddmin(items, oracleFor(["pkg17"]));
  assert.deepEqual(culprits, ["pkg17"]);
  // Should be far cheaper than the 32-install linear sweep.
  assert.ok(tests < 16, `expected < 16 tests, got ${tests}`);
});

test("isolates two interacting culprits (1-minimal failing set)", async () => {
  const items = Array.from({ length: 16 }, (_, i) => `pkg${i}`);
  const { culprits } = await ddmin(items, oracleFor(["pkg3", "pkg11"]));
  assert.equal(culprits.length, 2);
  assert.ok(culprits.includes("pkg3") && culprits.includes("pkg11"));
});

test("treats skip as unresolved and still finds the culprit", async () => {
  const items = Array.from({ length: 16 }, (_, i) => `pkg${i}`);
  // Some midpoints are infeasible; the real culprit is pkg9.
  const oracle = async (subset) => {
    if (subset.length === 3) return "skip"; // arbitrary infeasible shape
    return subset.includes("pkg9") ? "fail" : "pass";
  };
  const { culprits } = await ddmin(items, oracle);
  assert.ok(culprits.includes("pkg9"));
});

test("single-element input returns it unchanged", async () => {
  const { culprits } = await ddmin(["only"], oracleFor(["only"]));
  assert.deepEqual(culprits, ["only"]);
});

test("caches repeated subsets (no redundant oracle calls)", async () => {
  const items = Array.from({ length: 8 }, (_, i) => `pkg${i}`);
  let calls = 0;
  const oracle = async (subset) => {
    calls++;
    return subset.includes("pkg5") ? "fail" : "pass";
  };
  const { tests } = await ddmin(items, oracle);
  assert.equal(calls, tests, "tests reported should equal distinct oracle calls");
});
