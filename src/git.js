import { execFileSync } from "node:child_process";

function git(args, opts = {}) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
}

export function isGitRef(repoDir, ref) {
  try {
    git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd: repoDir, stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

export function resolveRef(repoDir, ref) {
  return git(["rev-parse", `${ref}^{commit}`], { cwd: repoDir }).trim();
}

// Read a file's contents at a given git ref. Returns null if the file did not
// exist at that ref.
export function readFileAtRef(repoDir, ref, relPath) {
  try {
    return git(["show", `${ref}:${relPath}`], { cwd: repoDir, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

export function repoRoot(dir) {
  return git(["rev-parse", "--show-toplevel"], { cwd: dir }).trim();
}

// Create a detached worktree at `ref` in `dest`. Returns a cleanup function.
export function addWorktree(repoDir, ref, dest) {
  git(["worktree", "add", "--detach", "--force", dest, ref], { cwd: repoDir, stdio: ["ignore", "ignore", "pipe"] });
  return () => {
    try {
      git(["worktree", "remove", "--force", dest], { cwd: repoDir, stdio: "ignore" });
    } catch {
      // best effort; the temp dir is cleaned separately
    }
  };
}
