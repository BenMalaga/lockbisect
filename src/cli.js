import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { argv, cwd, exit, stdout, stderr } from "node:process";
import { createRequire } from "node:module";
import { addWorktree, isGitRef, readFileAtRef, repoRoot, resolveRef } from "./git.js";
import { parseLockfile, changedNames, describeName } from "./lockfile.js";
import { ddmin } from "./ddmin.js";
import { makeOracle } from "./runner.js";

const VERSION = createRequire(import.meta.url)("../package.json").version;
const isTTY = Boolean(stdout.isTTY);

const C = isTTY
  ? { reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m" }
  : { reset: "", bold: "", dim: "", red: "", green: "", yellow: "", cyan: "" };

function fail(msg) {
  stderr.write(`${C.red}lockbisect: ${msg}${C.reset}\n`);
  exit(2);
}

function parseArgs(args) {
  const opts = {
    good: null,
    bad: "HEAD",
    test: null,
    lockfile: "package-lock.json",
    npm: "npm",
    ignoreScripts: false,
    installTimeout: 600000,
    testTimeout: 600000,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const take = () => {
      const v = args[++i];
      if (v == null) fail(`${a} needs a value`);
      return v;
    };
    if (a === "--good" || a === "-g") opts.good = take();
    else if (a === "--bad" || a === "-b") opts.bad = take();
    else if (a === "--test" || a === "-t") opts.test = take();
    else if (a === "--lockfile" || a === "-l") opts.lockfile = take();
    else if (a === "--npm") opts.npm = take();
    else if (a === "--ignore-scripts") opts.ignoreScripts = true;
    else if (a === "--install-timeout") opts.installTimeout = Number(take()) * 1000;
    else if (a === "--test-timeout") opts.testTimeout = Number(take()) * 1000;
    else if (a === "-h" || a === "--help") opts.help = true;
    else if (a === "-v" || a === "--version") opts.version = true;
    else fail(`unknown option: ${a}`);
  }
  return opts;
}

function printHelp() {
  stdout.write(`lockbisect ${VERSION} — git bisect for the inside of a lockfile diff.

When a batch dependency update (a Dependabot/Renovate group, or a bulk
\`npm update\`) bumps dozens of packages in one commit and CI goes red,
lockbisect binary-searches the changed pins to name the exact culprit.

Usage:
  lockbisect --good <ref> --test "<command>" [options]

Required:
  -g, --good <ref>        Git ref whose lockfile is known to PASS (e.g. HEAD~1).
  -t, --test "<command>"  Command that exits 0 when healthy, non-zero when broken.

Options:
  -b, --bad <ref>         Git ref whose lockfile is known to FAIL. Default: HEAD.
  -l, --lockfile <path>   Lockfile path. Default: package-lock.json.
      --npm <bin>         npm binary to use. Default: npm.
      --ignore-scripts    Pass --ignore-scripts to npm install (faster, but skips
                          packages whose breakage is in a postinstall script).
      --install-timeout <s>  Per-step npm install timeout in seconds. Default: 600.
      --test-timeout <s>     Per-step test timeout in seconds. Default: 600.
  -h, --help              Show this help.
  -v, --version           Show version.

Example:
  # CI broke after a grouped Renovate bump on HEAD. Find which package did it:
  lockbisect --good HEAD~1 --test "npm test"

How it works:
  Reinstalls the good lockfile with a subset of the changed packages forced to
  their bad versions (direct deps pinned in package.json, transitive deps via
  npm overrides), runs your test, and binary-searches the subset that
  reproduces the failure — naming the culprit in O(log n) installs instead of n.
`);
}

export async function main() {
  const opts = parseArgs(argv.slice(2));
  if (opts.version) return void stdout.write(`lockbisect ${VERSION}\n`);
  if (opts.help) return void printHelp();
  if (!opts.good) fail("missing --good <ref>. See --help.");
  if (!opts.test) fail('missing --test "<command>". See --help.');

  let root;
  try {
    root = repoRoot(cwd());
  } catch {
    fail("not inside a git repository.");
  }

  if (!isGitRef(root, opts.good)) fail(`--good ref "${opts.good}" is not a valid commit.`);
  if (!isGitRef(root, opts.bad)) fail(`--bad ref "${opts.bad}" is not a valid commit.`);

  const goodText = readFileAtRef(root, opts.good, opts.lockfile);
  const badText = readFileAtRef(root, opts.bad, opts.lockfile);
  if (goodText == null) fail(`${opts.lockfile} does not exist at --good ref ${opts.good}.`);
  if (badText == null) fail(`${opts.lockfile} does not exist at --bad ref ${opts.bad}.`);

  let good, bad;
  try {
    good = parseLockfile(goodText, `${opts.lockfile} at ${opts.good}`);
    bad = parseLockfile(badText, `${opts.lockfile} at ${opts.bad}`);
  } catch (e) {
    fail(e.message);
  }

  const changes = changedNames(good, bad);
  if (changes.length === 0) {
    fail(`no resolved-version changes between ${opts.good} and ${opts.bad} in ${opts.lockfile}. Nothing to bisect.`);
  }

  const names = changes.map((c) => c.name);
  const changeByName = new Map(changes.map((c) => [c.name, c]));
  const badVersionByName = new Map(changes.map((c) => [c.name, c.badVersion]));

  stdout.write(`${C.bold}lockbisect${C.reset} ${C.dim}v${VERSION}${C.reset}\n`);
  stdout.write(`${C.dim}${shortRef(root, opts.good)} (good) → ${shortRef(root, opts.bad)} (bad) · ${opts.lockfile}${C.reset}\n`);
  stdout.write(`${changes.length} changed package${changes.length === 1 ? "" : "s"} to search:\n`);
  for (const c of changes.slice(0, 12)) stdout.write(`  ${C.dim}·${C.reset} ${describeName(c)}\n`);
  if (changes.length > 12) stdout.write(`  ${C.dim}… and ${changes.length - 12} more${C.reset}\n`);
  stdout.write("\n");

  // Isolate everything in a worktree at the BAD ref so the test command runs
  // against the broken commit's source while we swap node_modules underneath it.
  const tmp = mkdtempSync(join(tmpdir(), "lockbisect-"));
  const wt = join(tmp, "worktree");
  let removeWorktree = () => {};
  try {
    removeWorktree = addWorktree(root, opts.bad, wt);
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    fail(`could not create a git worktree at ${opts.bad}: ${String(e.message).split("\n")[0]}`);
  }
  if (!existsSync(join(wt, "package.json"))) {
    cleanup(removeWorktree, tmp);
    fail(`no package.json in the worktree at ${opts.bad}.`);
  }

  const rawOracle = makeOracle({
    workdir: wt,
    lockfileName: opts.lockfile,
    goodLockText: goodText,
    badVersionByName,
    testCmd: opts.test,
    npmCmd: opts.npm,
    ignoreScripts: opts.ignoreScripts,
    installTimeout: opts.installTimeout,
    testTimeout: opts.testTimeout,
    onStep: ({ step, appliedCount, result, reason }) => {
      const tag =
        result === "fail" ? `${C.red}fail${C.reset}` : result === "pass" ? `${C.green}pass${C.reset}` : `${C.yellow}skip${C.reset}`;
      const detail = reason ? ` ${C.dim}(${reason})${C.reset}` : "";
      stdout.write(`  ${C.dim}#${step}${C.reset} testing ${appliedCount}/${changes.length} bad-pinned → ${tag}${detail}\n`);
    },
  });

  // One memo shared across the endpoint checks and ddmin, keyed by the sorted
  // subset, so each distinct install runs once and the reported count is true.
  const memo = new Map();
  const oracle = async (subset) => {
    const k = [...subset].sort().join("\x00");
    if (memo.has(k)) return memo.get(k);
    const r = await rawOracle(subset);
    memo.set(k, r);
    return r;
  };

  stdout.write(`${C.cyan}Verifying endpoints…${C.reset}\n`);
  const badResult = await oracle(names);
  if (badResult !== "fail") {
    cleanup(removeWorktree, tmp);
    fail(
      badResult === "skip"
        ? `the full bad set does not install in the worktree — cannot bisect. Check that ${opts.lockfile} is consistent at ${opts.bad}.`
        : `your test command passes with every package at its bad version, so there is nothing to bisect. Does "${opts.test}" actually reproduce the failure on ${opts.bad}?`,
    );
  }
  const goodResult = await oracle([]);
  if (goodResult !== "pass") {
    cleanup(removeWorktree, tmp);
    fail(
      goodResult === "skip"
        ? `the good lockfile does not install against the source at ${opts.bad} (package.json likely changed too). lockbisect v1 targets dependency-only updates.`
        : `your test command also fails with the good lockfile, so the breakage is not in the dependency bump. Bisect your source with \`git bisect\` instead.`,
    );
  }

  stdout.write(`\n${C.cyan}Bisecting…${C.reset}\n`);
  const { culprits } = await ddmin(names, oracle);

  cleanup(removeWorktree, tmp);
  report(changes, culprits, changeByName, memo.size);
}

function shortRef(root, ref) {
  try {
    return `${ref}@${resolveRef(root, ref).slice(0, 7)}`;
  } catch {
    return ref;
  }
}

function cleanup(removeWorktree, tmp) {
  removeWorktree();
  rmSync(tmp, { recursive: true, force: true });
}

function report(changes, culprits, changeByName, installs) {
  stdout.write("\n");
  if (culprits.length === 0) {
    stdout.write(`${C.yellow}No minimal culprit isolated.${C.reset} The failure may depend on the install itself or on too many infeasible midpoints.\n`);
    return;
  }
  const label = culprits.length === 1 ? "Culprit" : `Culprits (${culprits.length} packages, breaking only in combination)`;
  stdout.write(`${C.bold}${C.green}✓ ${label}:${C.reset}\n`);
  for (const name of culprits) stdout.write(`  ${C.bold}${describeName(changeByName.get(name))}${C.reset}\n`);
  stdout.write(`${C.dim}Isolated in ${installs} install${installs === 1 ? "" : "s"} (a linear sweep would take ${changes.length}).${C.reset}\n\n`);

  const pins = culprits.map((name) => changeByName.get(name)).map((c) => `"${c.name}": "${c.goodVersion}"`);
  stdout.write(`${C.dim}Pin the good version${pins.length === 1 ? "" : "s"} to unblock CI (package.json "overrides"):${C.reset}\n`);
  stdout.write(`  ${C.cyan}"overrides": { ${pins.join(", ")} }${C.reset}\n`);
}
