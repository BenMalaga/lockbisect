import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIRECT_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"];

// Builds the oracle ddmin calls. Each invocation reinstalls the GOOD lockfile
// with the selected subset of packages forced to their BAD versions, then runs
// the user's test command:
//   1. restore the good lockfile as the base,
//   2. force each selected name to bad — direct deps in their manifest field,
//      transitive deps via `overrides`,
//   3. `npm install` (npm reconciles a consistent tree — no infeasible hybrids),
//   4. run the test (exit 0 -> "pass", else "fail"); install failure -> "skip".
export function makeOracle({
  workdir,
  lockfileName,
  pkgJsonName = "package.json",
  goodLockText,
  badVersionByName,
  testCmd,
  npmCmd = "npm",
  ignoreScripts = false,
  onStep,
  installTimeout,
  testTimeout,
}) {
  const origPkgText = readFileSync(join(workdir, pkgJsonName), "utf8");
  const directFieldOf = (pkg, name) => DIRECT_FIELDS.find((f) => pkg[f] && name in pkg[f]);
  let step = 0;

  return async function oracle(subsetNames) {
    step += 1;

    writeFileSync(join(workdir, lockfileName), goodLockText);

    const pkg = JSON.parse(origPkgText);
    const overrides = { ...(pkg.overrides || {}) };
    for (const name of subsetNames) {
      const version = badVersionByName.get(name);
      const field = directFieldOf(pkg, name);
      if (field) pkg[field][name] = version;
      else overrides[name] = version;
    }
    if (Object.keys(overrides).length) pkg.overrides = overrides;
    writeFileSync(join(workdir, pkgJsonName), JSON.stringify(pkg, null, 2));

    const installArgs = ["install", "--no-audit", "--no-fund"];
    if (ignoreScripts) installArgs.push("--ignore-scripts");
    const install = spawnSync(npmCmd, installArgs, {
      cwd: workdir,
      encoding: "utf8",
      timeout: installTimeout,
      maxBuffer: 64 * 1024 * 1024,
      shell: process.platform === "win32",
    });

    if (install.status !== 0) {
      onStep?.({ step, appliedCount: subsetNames.length, result: "skip", reason: installReason(install) });
      return "skip";
    }

    const test = spawnSync(testCmd, {
      cwd: workdir,
      encoding: "utf8",
      timeout: testTimeout,
      maxBuffer: 64 * 1024 * 1024,
      shell: true,
    });

    if (test.error && test.error.code === "ETIMEDOUT") {
      onStep?.({ step, appliedCount: subsetNames.length, result: "skip", reason: "test command timed out" });
      return "skip";
    }

    const result = test.status === 0 ? "pass" : "fail";
    onStep?.({ step, appliedCount: subsetNames.length, result });
    return result;
  };
}

function installReason(install) {
  if (install.error && install.error.code === "ETIMEDOUT") return "npm install timed out";
  const err = (install.stderr || "").trim().split("\n").filter(Boolean).pop();
  return err ? `npm install failed: ${err.slice(0, 160)}` : "npm install failed";
}
