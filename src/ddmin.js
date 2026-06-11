// Delta Debugging (ddmin), after Zeller & Hildebrand, "Simplifying and
// Isolating Failure-Inducing Input" (2002), adapted for a three-valued oracle.
//
// Why ddmin instead of a plain binary search: a grouped dependency bump can
// have a *single* culprit (the common case — ddmin degenerates to ~log2(n)
// tests there) OR two packages that only break in combination. Naive bisection
// silently gives a wrong answer on the interaction case; ddmin finds a
// 1-minimal failing subset in both.
//
// The oracle returns:
//   "fail" — applying this subset reproduces the failure (what we hunt for)
//   "pass" — the failure does not reproduce
//   "skip" — the midpoint is infeasible (e.g. the spliced lockfile won't
//            install). Treated as "unresolved": it never lets us narrow, so we
//            fall through to a finer partition, exactly like `git bisect skip`.

export async function ddmin(items, oracle) {
  const cache = new Map();
  const key = (subset) => subset.join("\x00");

  async function test(subset) {
    const k = key(subset);
    if (cache.has(k)) return cache.get(k);
    const result = await oracle(subset);
    cache.set(k, result);
    return result;
  }

  let circumstances = [...items];
  let n = 2;

  while (circumstances.length >= 2) {
    const chunks = partition(circumstances, n);
    let reduced = false;

    // 1) Try each complement (drop one chunk). This is the narrowing step that
    //    makes the single-culprit case ~logarithmic.
    for (const chunk of chunks) {
      const complement = circumstances.filter((x) => !chunk.includes(x));
      if (complement.length === 0) continue;
      if ((await test(complement)) === "fail") {
        circumstances = complement;
        n = Math.max(n - 1, 2);
        reduced = true;
        break;
      }
    }
    if (reduced) continue;

    // 2) Try each chunk alone. Catches the case where the failure lives wholly
    //    inside one chunk and the complement masks it.
    for (const chunk of chunks) {
      if (chunk.length === circumstances.length) continue;
      if ((await test(chunk)) === "fail") {
        circumstances = chunk;
        n = 2;
        reduced = true;
        break;
      }
    }
    if (reduced) continue;

    // 3) Increase granularity, or stop when we can't subdivide further.
    if (n >= circumstances.length) break;
    n = Math.min(circumstances.length, n * 2);
  }

  return { culprits: circumstances, tests: cache.size, cache };
}

function partition(arr, n) {
  const size = Math.ceil(arr.length / n);
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
