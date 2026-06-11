import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLockfile, changedNames, describeName, nameFromKey } from "../src/lockfile.js";

const good = {
  lockfileVersion: 3,
  packages: {
    "": { name: "root", version: "1.0.0" },
    "node_modules/a": { version: "1.0.0", resolved: "https://r/a-1.0.0.tgz" },
    "node_modules/b": { version: "2.0.0", resolved: "https://r/b-2.0.0.tgz" },
    "node_modules/c": { version: "3.0.0", resolved: "https://r/c-3.0.0.tgz" },
    "node_modules/keep": { version: "9.9.9", resolved: "https://r/keep-9.9.9.tgz" },
    "node_modules/link": { link: true, resolved: "../local" },
  },
};

const bad = {
  lockfileVersion: 3,
  packages: {
    "": { name: "root", version: "1.0.0" },
    "node_modules/a": { version: "1.1.0", resolved: "https://r/a-1.1.0.tgz" }, // changed
    "node_modules/b": { version: "2.0.0", resolved: "https://r/b-2.0.0.tgz" }, // unchanged
    // c removed
    "node_modules/d": { version: "4.0.0", resolved: "https://r/d-4.0.0.tgz" }, // added
    "node_modules/keep": { version: "9.9.9", resolved: "https://r/keep-9.9.9.tgz" },
    "node_modules/link": { link: true, resolved: "../local" },
  },
};

test("changedNames returns only packages present in both with a changed version", () => {
  const changes = changedNames(good, bad);
  assert.equal(changes.length, 1, "only `a` qualifies (b unchanged, c removed, d added)");
  assert.equal(changes[0].name, "a");
  assert.equal(changes[0].goodVersion, "1.0.0");
  assert.equal(changes[0].badVersion, "1.1.0");
});

test("changedNames ignores the root and workspace links", () => {
  const changes = changedNames(good, bad);
  assert.ok(!changes.some((c) => c.name === "" || c.name === "link"));
});

test("changedNames collapses by name, keeping the shallowest path's bad version", () => {
  const g = {
    lockfileVersion: 3,
    packages: {
      "": { name: "root" },
      "node_modules/dup": { version: "1.0.0" },
      "node_modules/parent/node_modules/dup": { version: "1.0.0" },
    },
  };
  const b = {
    lockfileVersion: 3,
    packages: {
      "": { name: "root" },
      "node_modules/dup": { version: "2.0.0" }, // shallow → this bad version wins
      "node_modules/parent/node_modules/dup": { version: "2.5.0" },
    },
  };
  const changes = changedNames(g, b);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].name, "dup");
  assert.equal(changes[0].badVersion, "2.0.0");
});

test("changedNames detects a change in resolved tarball even at the same version", () => {
  const g = { lockfileVersion: 3, packages: { "": {}, "node_modules/x": { version: "1.0.0", resolved: "https://a/x.tgz" } } };
  const b = { lockfileVersion: 3, packages: { "": {}, "node_modules/x": { version: "1.0.0", resolved: "https://b/x.tgz" } } };
  assert.equal(changedNames(g, b).length, 1);
});

test("parseLockfile rejects a lockfile with no packages map", () => {
  assert.throws(() => parseLockfile(JSON.stringify({ lockfileVersion: 1 }), "old"), /lockfileVersion 2 or 3/);
});

test("parseLockfile rejects non-JSON", () => {
  assert.throws(() => parseLockfile("{not json", "x"), /Could not parse/);
});

test("describeName renders a readable transition", () => {
  assert.equal(describeName({ name: "chalk", goodVersion: "5.0.0", badVersion: "5.6.2" }), "chalk 5.0.0 → 5.6.2");
});

test("nameFromKey extracts the package name from nested paths", () => {
  assert.equal(nameFromKey("node_modules/foo"), "foo");
  assert.equal(nameFromKey("node_modules/a/node_modules/b"), "b");
  assert.equal(nameFromKey("node_modules/@scope/pkg"), "@scope/pkg");
});
