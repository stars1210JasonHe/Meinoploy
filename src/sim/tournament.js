// Atlas Balance Sim — N-game tournament runner (plan D5).
//
// Runs a 1v1 pairing of two "contestants" across N games and reports each
// contestant's win% with a 95% normal-approx CI, plus a PASS/FAIL on the 60/40
// fairness gate. The pure aggregation/methodology helpers (seat rotation, CI,
// gate) are exported separately so they can be unit-tested without running games.
//
// A contestant is { label, charId, policy }. For the best-fit/worst-fit question
// the two contestants differ in charId (policy held constant). For the camper/
// tourer question they differ in policy.routeStrategy (charId held constant).
//
// METHODOLOGY (D5, non-negotiable fairness):
//   - Seat rotation: contestant A sits in seat 0 for the first half of games, seat
//     1 for the second half (and vice-versa for B), so first-player turn-order
//     advantage cannot confound win%.
//   - Per-game seed: `${baseSeed}:${gameIndex}` — fully reproducible, each game differs.
//   - Win attribution: map the winning SEAT back to the contestant that occupied it.

import { runMatch } from './match';

// 60/40 fairness gate: the dominant contestant's win% must be <= 60% (equivalently
// both >= 40%). Tunable via spec.gate.{maxWinPct} so a stricter/looser bar is config.
export const DEFAULT_GATE = { maxWinPct: 0.60 };

// Which seat (0 or 1) does contestant A occupy in game `i` of `n`? First half: seat
// 0; second half: seat 1. (B always takes the other seat.) Exposed for testing.
export function seatOfA(gameIndex, totalGames) {
  return gameIndex < Math.floor(totalGames / 2) ? 0 : 1;
}

// 95% normal-approximation CI half-width for a proportion p over n samples.
export function ci95(p, n) {
  if (n <= 0) return 0;
  return 1.96 * Math.sqrt((p * (1 - p)) / n);
}

// Aggregate a win tally into a table row per contestant. `wins` is a {label: count}
// map; `n` total decisive games (draws/null winners excluded from n). Returns
// [{ label, wins, winPct, ciLow, ciHigh }] sorted by winPct desc.
export function aggregate(wins, n, labels) {
  const rows = labels.map(label => {
    const w = wins[label] || 0;
    const p = n > 0 ? w / n : 0;
    const half = ci95(p, n);
    return {
      label,
      wins: w,
      winPct: p,
      ciLow: Math.max(0, p - half),
      ciHigh: Math.min(1, p + half),
    };
  });
  rows.sort((a, b) => b.winPct - a.winPct);
  return rows;
}

// Compute the PASS/FAIL gate from aggregated rows. PASS when the top contestant's
// win% <= gate.maxWinPct. `ciStraddles50` flags when the leader's CI includes 50%
// (verdict is on the point estimate, but a straddling CI means "not significant").
export function evaluateGate(rows, gate) {
  const g = Object.assign({}, DEFAULT_GATE, gate || {});
  if (rows.length === 0) return { pass: true, maxWinPct: 0, leader: null, ciStraddles50: true };
  const leader = rows[0];
  const pass = leader.winPct <= g.maxWinPct + 1e-9;
  const ciStraddles50 = leader.ciLow <= 0.5 && leader.ciHigh >= 0.5;
  return {
    pass,
    maxWinPct: leader.winPct,
    leader: leader.label,
    threshold: g.maxWinPct,
    ciStraddles50,
  };
}

// Run the full tournament.
//   spec = {
//     world,            // atlas world object or null (classic)
//     contestants: [A, B],   // each { label, charId, policy }
//     games,            // N games (even → clean seat split)
//     baseSeed,         // string; per-game seed = `${baseSeed}:${i}`
//     maxTurns,         // per-game turn cap
//     gate,             // optional { maxWinPct }
//   }
// Returns { table, gate, games, decisive, draws, seed, label }.
export function runTournament(spec) {
  const {
    world = null,
    contestants,
    games = 200,
    baseSeed = '1',
    maxTurns = 300,
    gate,
  } = spec;
  if (!contestants || contestants.length !== 2) {
    throw new Error('runTournament expects exactly 2 contestants (1v1 pairing)');
  }
  const [A, B] = contestants;
  const labels = [A.label, B.label];
  const wins = { [A.label]: 0, [B.label]: 0 };
  let draws = 0;

  for (let i = 0; i < games; i++) {
    const aSeat = seatOfA(i, games);
    const bSeat = aSeat === 0 ? 1 : 0;
    // Build per-seat char + policy arrays from the seat assignment.
    const charIds = [];
    const policies = [];
    charIds[aSeat] = A.charId; policies[aSeat] = A.policy || {};
    charIds[bSeat] = B.charId; policies[bSeat] = B.policy || {};

    const result = runMatch({
      world,
      charIds,
      policies,
      seed: `${baseSeed}:${i}`,
      maxTurns,
    });

    // Attribute the win to the contestant occupying the winning seat.
    if (result.winner === null || result.winner === undefined) {
      draws++;
    } else {
      const winSeat = parseInt(result.winner);
      const label = winSeat === aSeat ? A.label : B.label;
      wins[label]++;
    }
  }

  const decisive = games - draws;
  const table = aggregate(wins, decisive, labels);
  const gateResult = evaluateGate(table, gate);

  return {
    table,
    gate: gateResult,
    games,
    decisive,
    draws,
    seed: baseSeed,
    world: world ? world.id : 'classic',
  };
}
