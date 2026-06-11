# Contributing to lockbisect

Thanks for helping. lockbisect is small, zero-dependency, and well-tested — please
keep it that way.

## The most valuable contribution: a real broken lockfile pair

If lockbisect mis-identified a culprit, picked a slow path, or choked on your
lockfile, the gold-standard bug report is **a reproducer**: a good
`package-lock.json` and a bad one (or a link to the two commits) plus the test
command. These become regression fixtures and are the fastest way to a fix.

## Development

```bash
git clone https://github.com/BenMalaga/lockbisect
cd lockbisect
node --test            # unit tests (no network, no installs)
node bin/lockbisect.js --help
```

There are no build steps and no dependencies. The code is ES modules, Node ≥ 18.

### Layout

| File | Responsibility |
| --- | --- |
| `src/lockfile.js` | Parse `package-lock.json`; compute the changed-package set. |
| `src/ddmin.js` | Delta-debugging search (pure, no I/O — heavily unit-tested). |
| `src/runner.js` | Synthesize a hybrid install and run the test command. |
| `src/git.js` | Read files at refs; create/destroy the isolated worktree. |
| `src/cli.js` | Argument parsing, orchestration, reporting. |

Keep `ddmin.js` pure and `runner.js` the only module that shells out to npm — that
separation is what makes the search logic testable without network access.

## Most-wanted features

1. **pnpm** (`pnpm-lock.yaml`) and **yarn** (`yarn.lock`) support. Nothing good
   exists for these either — same algorithm, different lockfile parser and hybrid
   mechanism. This is the highest-impact addition.
2. **A GitHub Action** that runs lockbisect automatically when a Dependabot/Renovate
   PR turns CI red and comments the culprit.
3. **Speed**: warm-cache reuse between installs, parallel midpoint evaluation.

Open an issue to claim one before starting a large PR. MIT licensed; by
contributing you agree your work ships under the same license.
