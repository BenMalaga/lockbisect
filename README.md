<div align="center">

# lockbisect

### `git bisect` for the inside of a lockfile diff.

A grouped dependency update bumped a pile of packages in one commit and CI went
red. **`git bisect` is useless**: it was *one commit*. lockbisect finds the exact
culprit package anyway.

[![npm](https://img.shields.io/npm/v/lockbisect?color=cb3837&label=npm)](https://www.npmjs.com/package/lockbisect)
[![CI](https://github.com/BenMalaga/lockbisect/actions/workflows/test.yml/badge.svg)](https://github.com/BenMalaga/lockbisect/actions)
![node](https://img.shields.io/badge/node-%E2%89%A518-339933)
![deps](https://img.shields.io/badge/dependencies-0-success)
![license](https://img.shields.io/badge/license-MIT-yellow)

</div>

---

Dependabot, Renovate, and `npm update` all do the same brutal thing: they change
**dozens of packages in a single commit**. When that commit breaks your build,
`git bisect` can only narrow it down to... that one commit. You're left to find
the culprit by hand: splitting the `package-lock.json` diff into synthetic
commits, or reverting packages one at a time. It's an afternoon of work for a
question a machine can answer in a handful of installs.

lockbisect is that machine. Point it at the last-good and first-bad commits plus
your test command, and it **binary-searches the changed packages** (reinstalling
the good lockfile with subsets forced to their bad versions) until it names the
one that broke you.

```bash
npx lockbisect --good HEAD~1 --test "npm test"
```

```
lockbisect v0.1.0
HEAD~1@d70a7ba (good) → HEAD@a45b670 (bad) · package-lock.json
11 changed packages to search:
  · ansi-regex 6.0.0 → 6.1.0
  · ansi-styles 6.0.0 → 6.2.1
  · chalk 5.0.0 → 5.3.0
  … and 8 more

Verifying endpoints…
  #1 testing 11/11 bad-pinned → fail
  #2 testing 0/11 bad-pinned → pass

Bisecting…
  #3 testing 5/11 bad-pinned → pass
  #4 testing 6/11 bad-pinned → fail
  #5 testing 3/11 bad-pinned → pass
  #6 testing 3/11 bad-pinned → fail
  #7 testing 1/11 bad-pinned → fail

✓ Culprit:
  chalk 5.0.0 → 5.3.0
Isolated in 7 installs (a linear sweep would take 11).

Pin the good version to unblock CI (package.json "overrides"):
  "overrides": { "chalk": "5.0.0" }
```

*(Real run. The win grows with the number of changed packages: the search is
logarithmic, a manual sweep is linear, and either way it's unattended instead of
an afternoon of splitting lockfile hunks by hand.)*

## Install

```bash
npx lockbisect --good <ref> --test "<command>"     # no install needed
# or
npm install -g lockbisect
```

Zero dependencies. Node ≥ 18. npm lockfiles (`lockfileVersion` 2 or 3).

## Usage

You need three things: a commit where the build was **green**, a commit where it's
**red**, and a command that tells the two apart.

```bash
# The most common case: CI broke on HEAD after a grouped bump.
lockbisect --good HEAD~1 --test "npm test"

# Be specific about what "broken" means — any command, any exit code.
lockbisect --good v2.3.0 --bad v2.3.1 --test "npm run build && node smoke.js"

# A monorepo package, a custom lockfile path, a yarn-style test:
lockbisect --good HEAD~1 --lockfile packages/api/package-lock.json --test "npm -w api test"
```

| Flag | |
| --- | --- |
| `-g, --good <ref>` | Git ref whose lockfile **passes** (required). |
| `-t, --test "<cmd>"` | Command that exits 0 when healthy, non-zero when broken (required). |
| `-b, --bad <ref>` | Git ref whose lockfile **fails**. Default: `HEAD`. |
| `-l, --lockfile <path>` | Lockfile to search. Default: `package-lock.json`. |
| `--ignore-scripts` | Faster installs; skips postinstall-script breakage. |
| `--install-timeout <s>` / `--test-timeout <s>` | Per-step caps. Default: 600s. |

The exit code is `0` when a culprit is found, `2` on a usage or setup error.

## How it works

The packages whose **resolved version changed** between the good and bad
lockfiles are the search space. lockbisect runs a [delta-debugging][ddmin] search
over them. To test "is the culprit in *this* subset?", it:

1. restores the **good** lockfile as the base,
2. forces the subset to their **bad** versions: direct dependencies pinned in
   `package.json`, transitive ones via npm [`overrides`][overrides],
3. runs `npm install` (npm reconciles a fully consistent tree, so there is no
   such thing as an un-installable midpoint), then runs your test.

Because every hybrid installs cleanly, the search is **O(log n)** in the number of
changed packages, not O(n). It even handles the nasty case where two packages
only break *in combination*: delta debugging returns the minimal breaking set,
not a single wrong answer.

Everything happens in a throwaway `git worktree` at the bad commit. **Your working
tree, lockfile, and `node_modules` are never touched.**

## Why nothing else does this

| Tool | What it does | Why it's not this |
| --- | --- | --- |
| `git bisect` | Bisects **commits** | A grouped bump is one commit: zero resolution. |
| `npm-check-updates --doctor` | Re-tests upgrades **one by one** | O(n), forward-only, **direct deps only**: can't see the transitive bump that broke you, and can't start from the commit you already have. |
| `npm-bisect` | Bisects by registry **publish date** | Unmaintained ~7 years; date ≠ your lockfile. |
| `pnpm-update-bisect` | Bisects an update **set** | Dormant prototype, pnpm-only, forward-direction. |
| single-package version bisectors | Drill **one** package's versions | Require you to **already know which package** broke. |

lockbisect is the only tool that takes a **retrospective lockfile diff** as its
search space. Both [Dependabot][dependabot-issue] and [Renovate][renovate-issue]
have years-old open feature requests for exactly this, with "ungroup it and retest
by hand" as the official answer. This is the automation.

## Scope (v1)

- **npm** `package-lock.json` (v2/v3). pnpm and yarn are on the roadmap. Nothing
  good exists there either.
- Best on **dependency-only commits** (Dependabot, Renovate, `npm update`) where
  the breakage is in a bumped package. If a commit also rewrote `package.json`
  ranges *and* source code, bisect the source with `git bisect` first.
- If a midpoint genuinely can't install, it's **skipped** (like `git bisect skip`)
  and the search continues.

## Contributing

Bug reports with a real broken lockfile pair are gold: they become test
fixtures. pnpm/yarn support and a GitHub Action are the most-wanted additions.
See [CONTRIBUTING.md](CONTRIBUTING.md). MIT licensed.

[ddmin]: https://www.st.cs.uni-saarland.de/papers/tse2002/
[overrides]: https://docs.npmjs.com/cli/v10/configuring-npm/package-json#overrides
[dependabot-issue]: https://github.com/dependabot/dependabot-core/issues/8450
[renovate-issue]: https://github.com/renovatebot/renovate/issues/13959
