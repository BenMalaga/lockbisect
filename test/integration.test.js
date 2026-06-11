// End-to-end test: builds a throwaway git repo with a "good" commit (passing)
// and a "bad" commit where a batch `npm update` bumped several packages, with
// exactly one hidden culprit, then asserts lockbisect names it.
//
// Requires git, npm, and network access to install real packages. Skips itself
// (rather than failing) when offline or when npm is unavailable, so `node --test`
// stays green in sandboxes — run it explicitly in CI where the network is up.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "lockbisect.js");

function networkAndNpm() {
  try {
    execFileSync("npm", ["view", "chalk@5.0.0", "version"], { stdio: "ignore", timeout: 30000 });
    return true;
  } catch {
    return false;
  }
}

test("isolates the hidden culprit in a real batch-update repo", { timeout: 600000, skip: networkAndNpm() ? false : "npm/network unavailable" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "lockbisect-it-"));
  const run = (cmd, args) => execFileSync(cmd, args, { cwd: dir, stdio: "ignore", timeout: 300000 });
  try {
    run("git", ["init", "-q"]);
    run("git", ["config", "user.email", "t@t.co"]);
    run("git", ["config", "user.name", "t"]);
    run("npm", ["init", "-y"]);
    // Old versions of small packages; chalk is the planted culprit.
    run("npm", ["i", "--save-exact", "--no-audit", "--no-fund", "chalk@5.0.0", "slash@5.0.0", "yocto-queue@1.0.0", "emoji-regex@10.0.0"]);
    // Loosen to caret so both old and new resolve under the same range.
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    for (const k of Object.keys(pkg.dependencies)) pkg.dependencies[k] = "^" + pkg.dependencies[k];
    writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2));
    run("npm", ["install", "--no-audit", "--no-fund"]);
    writeFileSync(
      join(dir, "check.js"),
      'const fs=require("node:fs");process.exit(JSON.parse(fs.readFileSync("node_modules/chalk/package.json","utf8")).version==="5.0.0"?0:1);',
    );
    run("git", ["add", "-A"]);
    run("git", ["commit", "-qm", "good"]);
    run("npm", ["update", "--no-audit", "--no-fund"]);
    run("git", ["add", "-A"]);
    run("git", ["commit", "-qm", "bad"]);

    const result = spawnSync("node", [BIN, "--good", "HEAD~1", "--test", "node check.js", "--ignore-scripts"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 580000,
    });

    assert.equal(result.status, 0, `lockbisect should exit 0\n${result.stdout}\n${result.stderr}`);
    // Inspect only the culprit section (everything after the "✓ Culprit" line),
    // not the full changed-packages list above it.
    const culpritSection = result.stdout.split(/✓ Culprit/)[1] || "";
    assert.ok(culpritSection, "a culprit must be reported");
    assert.match(culpritSection, /chalk 5\.0\.0/, "chalk must be named as the culprit");
    assert.doesNotMatch(culpritSection, /\bslash\b/, "innocent packages must not be in the culprit section");
    assert.doesNotMatch(culpritSection, /\byocto-queue\b/, "innocent packages must not be in the culprit section");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
