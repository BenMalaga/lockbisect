// Parsing and diffing for npm package-lock.json (v2/v3).
//
// lockbisect's search variables are the packages whose resolved version changed
// between the known-good and known-bad lockfiles. To test "package X at its bad
// version, everything else good", we reinstall the GOOD lockfile but force X to
// its bad version — pinning direct dependencies in the manifest's dependency
// fields and transitive ones via npm `overrides`, then letting `npm install`
// reconcile a consistent tree. (npm rejects an `overrides` entry that collides
// with a direct dependency, so the two paths are not interchangeable.) This
// makes every hybrid installable by construction — no hand-spliced lockfile can
// go internally inconsistent — which is what keeps the search at O(log n).

export function parseLockfile(text, label = "lockfile") {
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`Could not parse ${label} as JSON: ${e.message}`);
  }
  if (json.lockfileVersion == null) {
    throw new Error(`${label} has no lockfileVersion field — is this a package-lock.json?`);
  }
  if (!json.packages || typeof json.packages !== "object") {
    throw new Error(
      `${label} is lockfileVersion ${json.lockfileVersion} with no "packages" map. lockbisect needs lockfileVersion 2 or 3 (npm 7+). Run \`npm install\` with a modern npm to upgrade it.`,
    );
  }
  return json;
}

export function nameFromKey(key) {
  const idx = key.lastIndexOf("node_modules/");
  return idx === -1 ? key : key.slice(idx + "node_modules/".length);
}

function resolvableNode(key, entry) {
  return key !== "" && entry && typeof entry === "object" && entry.version && !entry.link;
}

// The bisect variables: packages present in BOTH lockfiles whose resolved
// version changed. Added/removed packages are excluded on purpose — they are
// consequences of a *changed* parent (a package only appears or vanishes because
// some parent's dependency set changed, and that parent is itself in this list),
// so they ride along when their parent is selected. Collapsed by package name,
// taking the shallowest path's bad version as the override target.
export function changedNames(good, bad) {
  const gp = good.packages || {};
  const bp = bad.packages || {};
  const byName = new Map();

  for (const key of new Set([...Object.keys(gp), ...Object.keys(bp)])) {
    const g = gp[key];
    const b = bp[key];
    if (!resolvableNode(key, g) || !resolvableNode(key, b)) continue;
    if (g.version === b.version && (g.resolved || "") === (b.resolved || "")) continue;

    const name = nameFromKey(key);
    const prev = byName.get(name);
    if (!prev || key.length < prev.key.length) {
      byName.set(name, { name, goodVersion: g.version, badVersion: b.version, key });
    }
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function describeName(c) {
  return `${c.name} ${c.goodVersion} → ${c.badVersion}`;
}
