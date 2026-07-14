// Create-Mod auto-balance — pure stat-redistribution hill-climb
// (spec 2026-07-14-createmod-balance §2). The sim is INJECTED as
// `evaluate(roster, ctx) → { rows, flags: {charId: 'strong'|'weak'}, spread }`
// so this core is unit-tested with scripted landscapes and zero real games.
//
// Identity constraint: a character's HIGHEST stat is never modified — moves
// shift exactly 1 point between the OTHER five stats, keeping the per-character
// sum invariant and every stat within [MIN_STAT, MAX_STAT]. The optimizer never
// hardcodes which stats are "good": candidates are enumerated mechanically and
// ranked purely by the injected evaluation (lexicographic: fewer flags, then
// smaller spread).

export const STAT_KEYS = ['capital', 'luck', 'negotiation', 'charisma', 'tech', 'stamina'];
export const MIN_STAT = 1;
export const MAX_STAT = 10;

export function statSum(stats) {
  return STAT_KEYS.reduce((a, k) => a + (stats[k] || 0), 0);
}

// Highest stat key; deterministic tie-break by STAT_KEYS order.
export function topStatOf(stats) {
  let best = STAT_KEYS[0];
  for (const k of STAT_KEYS) if ((stats[k] || 0) > (stats[best] || 0)) best = k;
  return best;
}

// All legal single-point moves for the FLAGGED characters.
// WEAK char: we try raising each non-top stat (taking from another non-top);
// STRONG char: same mechanical move set — lowering a contributing stat is just
// the from-side of a move; direction semantics are identical, the evaluation
// decides what helps. Deterministic order: roster order, then STAT_KEYS order.
export function enumerateCandidates(roster, flags) {
  const out = [];
  for (const c of roster) {
    if (!flags[c.id]) continue;
    const top = topStatOf(c.stats);
    for (const from of STAT_KEYS) {
      if (from === top) continue;
      if ((c.stats[from] || 0) - 1 < MIN_STAT) continue;
      for (const to of STAT_KEYS) {
        if (to === top || to === from) continue;
        if ((c.stats[to] || 0) + 1 > MAX_STAT) continue;
        out.push({ charId: c.id, from, to });
      }
    }
  }
  return out;
}

// Apply a move immutably (fresh roster array, fresh char + stats objects).
export function applyMove(roster, move) {
  return roster.map(c => {
    if (c.id !== move.charId) return c;
    const stats = Object.assign({}, c.stats);
    stats[move.from] -= 1;
    stats[move.to] += 1;
    return Object.assign({}, c, { stats });
  });
}

function flagCount(flags) {
  return Object.keys(flags).length;
}

// result A strictly better than B? Lexicographic: fewer flags, then smaller spread.
function better(a, b) {
  if (flagCount(a.flags) !== flagCount(b.flags)) return flagCount(a.flags) < flagCount(b.flags);
  return a.spread < b.spread - 1e-12;
}

// Hill-climb until flags clear, no candidate improves (stall), or budgets cap.
// Returns { roster, appliedMoves, flagsCleared, stalled, cappedByEvals,
//           cappedByIterations, evals, finalResult }.
export function runAutoBalance(opts) {
  const { roster: initial, evaluate, maxIterations = 8, maxEvals = 80, seed = '1' } = opts;
  let roster = initial;
  let evals = 0;
  const appliedMoves = [];

  const evalRoster = (r, tag) => {
    evals += 1;
    return evaluate(r, { seed: `${seed}:${tag}`, evalIndex: evals });
  };

  let current = evalRoster(roster, 'base');
  let cappedByEvals = false;
  let cappedByIterations = false;
  let stalled = false;

  for (let iter = 0; iter < maxIterations; iter++) {
    if (flagCount(current.flags) === 0) break;
    if (evals >= maxEvals) { cappedByEvals = true; break; }

    const candidates = enumerateCandidates(roster, current.flags);
    let best = null;
    for (let j = 0; j < candidates.length; j++) {
      if (evals >= maxEvals) { cappedByEvals = true; break; }
      const cand = candidates[j];
      const moved = applyMove(roster, cand);
      const result = evalRoster(moved, `iter${iter}:cand${j}`);
      if (better(result, current) && (!best || better(result, best.result))) {
        best = { cand, moved, result };
      }
    }
    if (!best) {
      if (!cappedByEvals) stalled = true;
      break;
    }
    const delta = best.result.spread - current.spread;
    appliedMoves.push(Object.assign({}, best.cand, {
      delta,
      flagsBefore: flagCount(current.flags),
      flagsAfter: flagCount(best.result.flags),
    }));
    roster = best.moved;
    current = best.result;
    if (iter === maxIterations - 1 && flagCount(current.flags) > 0) cappedByIterations = true;
  }

  return {
    roster,
    appliedMoves,
    flagsCleared: flagCount(current.flags) === 0,
    stalled,
    cappedByEvals,
    cappedByIterations,
    evals,
    finalResult: current,
  };
}
