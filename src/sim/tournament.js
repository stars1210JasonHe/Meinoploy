// Atlas Balance Sim — N-game tournament runner (plan D5).
//
// Runs a 1v1 pairing of two "contestants" across N games and reports each
// contestant's win% with a 95% normal-approx CI, plus a PASS/FAIL on the 60/40
// fairness gate. The pure aggregation/methodology helpers (seat rotation, CI,
// gate) are exported separately so they can be unit-tested without running games.
//
// A contestant is { label, charId, policy }. For the best-fit/worst-fit question
// the two contestants differ in charId (policy held constant).
//
// The camper/tourer (policy) question CANNOT hold charId constant — the engine
// forbids two seats picking the same character. A single fixed assignment
// (charA=camper, charB=tourer) therefore confounds strategy with character
// strength (observed: the verdict flipped PASS↔FAIL across seeds because renn≠
// cassian, not because of strategy). runStrategyTournament (below) removes that
// confound by averaging BOTH character→strategy assignments.
//
// METHODOLOGY (D5, non-negotiable fairness):
//   - Seat rotation: contestant A sits in seat 0 for the first half of games, seat
//     1 for the second half (and vice-versa for B), so first-player turn-order
//     advantage cannot confound win%.
//   - Per-game seed: `${baseSeed}:${gameIndex}` — fully reproducible, each game differs.
//   - Win attribution: map the winning SEAT back to the contestant that occupied it.

import { runMatch } from './match';
import { RULES } from '../../mods/active-rules';

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

// === Duel economics (Task 7 of the duel mechanism) ============================
// Per-CHARACTER duel cashflow, folded across every game of a tournament. Silent
// (an empty accumulator) unless RULES.duel.enabled produced at least one duel —
// runs on duel-free maps/policies see zero events and the table stays empty, so
// printTournament (cli.js) can skip it entirely and leave existing output
// byte-identical.

function emptyDuelRow() {
  return { duelsInitiated: 0, duelsWon: 0, rentWaived: 0, rentDoubledPaid: 0 };
}

function duelRowFor(acc, charId) {
  return acc[charId] || (acc[charId] = emptyDuelRow());
}

// Scan ONE match's G.events (runMatch's result.events — Task 7 addition to
// match.js) for duel_initiated/duel_resolved and fold the counts into `acc`
// (mutated in place, keyed by CHARACTER id, not seat). `charIds` is the
// per-seat character array for THIS game — the same array runTournament
// already builds per game (charIds[aSeat]/[bSeat]) to launch runMatch.
//
// duel_offered/duel_declined are deliberately NOT scanned: an offer alone
// isn't a duel (no roll happened), and a decline falls back to ordinary
// single rent — neither produces duel cashflow to report.
//
// rent is carried on BOTH duel_initiated's payload (frozen G.duel.rent) AND,
// as of final-review Fix 2a, directly on duel_resolved's own payload
// (src/events.js / src/Game.js respondDuel) — read straight off the
// duel_resolved event rather than correlating back to its (possibly absent)
// preceding duel_initiated. Final-review Fix 2b: the old approach correlated
// by adjacency via a `pendingRent` variable, banking on duel_initiated and
// duel_resolved always surviving the event log's front-trim together — true
// in the steady state (G.duel is a singleton; nothing else logs between the
// two), but NOT guaranteed once a long sim game's cap-trimming is in play (a
// duel resolved early in the game can have its duel_initiated trimmed away by
// the time the match ends while a later-trimmed duel_resolved survives, or
// vice versa) — that made pricing silently fall back to 0. Reading rent
// directly off duel_resolved removes the fragile correlation entirely; only
// duelsInitiated (a pure count, no dollar figure) still comes from scanning
// duel_initiated events.
export function accumulateDuelStats(acc, events, charIds) {
  (events || []).forEach(ev => {
    if (ev.type === 'duel_initiated') {
      duelRowFor(acc, charIds[parseInt(ev.actor)]).duelsInitiated++;
    } else if (ev.type === 'duel_resolved') {
      const rent = ev.data.rent != null ? ev.data.rent : 0;
      duelRowFor(acc, charIds[parseInt(ev.data.winnerId)]).duelsWon++;
      // challenger-centric cashflow: what THIS duel cost/saved the challenger
      // (actor on duel_resolved is always the challenger — see Game.js respondDuel).
      const challengerRow = duelRowFor(acc, charIds[parseInt(ev.actor)]);
      if (ev.data.outcome === 'waived') {
        challengerRow.rentWaived += rent;
      } else {
        // Math.round to mirror the engine's own final-review Fix 4 (respondDuel
        // now pays Math.round(loseMultiplier * rent), not the raw product) —
        // keeps this reported figure equal to the dollar amount actually
        // charged in-game, not a pre-rounding approximation of it.
        challengerRow.rentDoubledPaid += Math.round(RULES.duel.loseMultiplier * rent);
      }
    }
  });
  return acc;
}

// Format an accumulator into a sorted table for printing/asserting. Rows sorted
// by charId so output is deterministic regardless of Object.keys iteration
// order guarantees.
export function duelStatsTable(acc) {
  return Object.keys(acc).sort().map(charId => Object.assign({ charId }, acc[charId]));
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
    mapJson = null,
    modId = null,
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
  const duelStats = {};

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
      mapJson,
      modId,
      charIds,
      policies,
      seed: `${baseSeed}:${i}`,
      maxTurns,
    });

    accumulateDuelStats(duelStats, result.events, charIds);

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
  // null (not []) when duel-free, so callers can `if (result.duelTable)` rather
  // than checking .length — and printTournament stays silent on duel-free runs.
  const duelTable = Object.keys(duelStats).length > 0 ? duelStatsTable(duelStats) : null;

  return {
    table,
    gate: gateResult,
    games,
    decisive,
    draws,
    seed: baseSeed,
    world: world ? world.id : (mapJson ? mapJson.id : (modId ? `${modId}:default` : 'classic')),
    duelTable,
  };
}

// Wins for a given label out of a tournament result's table (0 if absent).
function winsOf(result, label) {
  const row = result.table.find(r => r.label === label);
  return row ? row.wins : 0;
}

// Isolate a binary POLICY dimension (camper vs tourer) from CHARACTER identity.
// Because the engine forbids the same character in both seats, we cannot hold the
// character constant. Instead we run TWO sub-tournaments with the character→strategy
// assignment SWAPPED, then sum wins by the STRATEGY label:
//   sub-A: charA=strategyA, charB=strategyB
//   sub-B: charB=strategyA, charA=strategyB   (characters swapped)
// Each sub-tournament already does seat rotation (turn-order de-bias). Summing the
// two cancels the character confound: whatever edge charA's stats/passive give is
// applied to strategyA in sub-A and to strategyB in sub-B, so it nets out. What
// remains in the aggregate is the STRATEGY effect.
//   spec = { world, charA, charB, strategyA='camper', strategyB='tourer',
//            policyBase={}, games, baseSeed, maxTurns, gate }
export function runStrategyTournament(spec) {
  const {
    world = null,
    mapJson = null,
    modId = null,
    charA, charB,
    strategyA = 'camper', strategyB = 'tourer',
    policyBase = {},
    games = 200,
    baseSeed = '1',
    maxTurns = 300,
    gate,
  } = spec;
  const polFor = strat => Object.assign({}, policyBase, { routeStrategy: strat });
  const half = Math.floor(games / 2);

  const subA = runTournament({
    world, mapJson, modId, games: half, baseSeed: `${baseSeed}:cAB`, maxTurns,
    contestants: [
      { label: strategyA, charId: charA, policy: polFor(strategyA) },
      { label: strategyB, charId: charB, policy: polFor(strategyB) },
    ],
  });
  const subB = runTournament({
    world, mapJson, modId, games: games - half, baseSeed: `${baseSeed}:cBA`, maxTurns,
    contestants: [
      { label: strategyA, charId: charB, policy: polFor(strategyA) },
      { label: strategyB, charId: charA, policy: polFor(strategyB) },
    ],
  });

  const wins = {
    [strategyA]: winsOf(subA, strategyA) + winsOf(subB, strategyA),
    [strategyB]: winsOf(subA, strategyB) + winsOf(subB, strategyB),
  };
  const decisive = subA.decisive + subB.decisive;
  const table = aggregate(wins, decisive, [strategyA, strategyB]);
  const gateResult = evaluateGate(table, gate);

  return {
    table,
    gate: gateResult,
    games,
    decisive,
    draws: subA.draws + subB.draws,
    seed: baseSeed,
    world: world ? world.id : (mapJson ? mapJson.id : (modId ? `${modId}:default` : 'classic')),
    // Per-character-assignment breakdown, so a reviewer can see the confound is gone:
    // if strategyA wins regardless of which character carries it, the effect is real.
    subTournaments: { charAisStrategyA: subA.table, charBisStrategyA: subB.table },
    duelTable: mergeDuelTables(subA.duelTable, subB.duelTable),
  };
}

// Combine two duelTable arrays (each already deduped+sorted by charId — see
// duelStatsTable) by summing rows sharing a charId. Either/both may be null
// (duel-free sub-run); the result is null only when BOTH are, so a duel that
// only occurred in one of the two character→strategy assignments still shows.
export function mergeDuelTables(a, b) {
  if (!a && !b) return null;
  const acc = {};
  (a || []).concat(b || []).forEach(row => {
    const r = duelRowFor(acc, row.charId);
    r.duelsInitiated += row.duelsInitiated;
    r.duelsWon += row.duelsWon;
    r.rentWaived += row.rentWaived;
    r.rentDoubledPaid += row.rentDoubledPaid;
  });
  return duelStatsTable(acc);
}

// === Melee tournament (sim --mod wave, spec 2026-07-14 §2) =====================
// Full-roster shared games instead of 1v1 pairings: every registered character
// gets a per-character win rate against the 1/seats baseline. Rosters larger
// than the seat cap rotate through contiguous windows so appearances equalize.

export const DEFAULT_MELEE_GATE = { meleeMax: 2.0, meleeMin: 0.35 };

// Deterministic Fisher-Yates over an FNV-1a-seeded LCG. Same seed string →
// same order, input array untouched. No Math.random anywhere in the sim.
export function seededShuffle(items, seed) {
  let h = 2166136261 >>> 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  let state = (h >>> 0) || 1;
  const rnd = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = out[i]; out[i] = out[j]; out[j] = t;
  }
  return out;
}

// Which characters play game `gameIndex`, in which seat order.
// roster <= seats: everyone plays, seat order rotates so first-mover advantage
// averages out. roster > seats: contiguous window starting at (i*seats) % k —
// over a full cycle of k/gcd(k,seats) games every character appears equally
// (±1 inside partial cycles) — plus the same in-window seat rotation.
export function meleeWindow(roster, seats, gameIndex) {
  const k = roster.length;
  if (k <= seats) {
    const rot = gameIndex % k;
    return roster.slice(rot).concat(roster.slice(0, rot));
  }
  const start = (gameIndex * seats) % k;
  const w = [];
  for (let j = 0; j < seats; j++) w.push(roster[(start + j) % k]);
  const rot = gameIndex % seats;
  return w.slice(rot).concat(w.slice(0, rot));
}

// Per-character rows from a {charId: {games, wins}} tally. Win% is over games
// the character PLAYED (windows mean not everyone plays every game). A flag
// requires BOTH the point estimate to clear the gate multiple of the 1/seats
// baseline AND the 95% CI to exclude the baseline (small samples never flag).
export function meleeAggregate(tally, seats, gate) {
  const g = Object.assign({}, DEFAULT_MELEE_GATE, gate || {});
  const baseline = 1 / seats;
  const rows = Object.keys(tally).map(charId => {
    const t = tally[charId];
    const p = t.games > 0 ? t.wins / t.games : 0;
    const half = ci95(p, t.games);
    const ciLow = Math.max(0, p - half);
    const ciHigh = Math.min(1, p + half);
    let flag = null;
    if (p > g.meleeMax * baseline && ciLow > baseline) flag = 'strong';
    else if (p < g.meleeMin * baseline && ciHigh < baseline) flag = 'weak';
    return { charId, games: t.games, wins: t.wins, winPct: p, ciLow, ciHigh, baseline, flag };
  });
  rows.sort((a, b) => b.winPct - a.winPct);
  return rows;
}

// Run the melee: N shared games over the (seeded-shuffled) roster. `policy`
// applies to EVERY seat (character strength is the variable under test, not
// strategy). Returns { rows, seats, games, duelTable } — duel cashflow folded
// across games exactly like the 1v1 tournaments.
export function runMeleeTournament(spec) {
  const { roster, games, seed, world = null, mapJson = null, modId = null, maxTurns = 300, policy = null, maxSeats = 8, gate } = spec;
  const order = seededShuffle(roster, `${seed}:melee-roster`);
  const seats = Math.min(maxSeats, order.length);
  const tally = {};
  const duelAcc = {};
  for (let i = 0; i < games; i++) {
    const charIds = meleeWindow(order, seats, i);
    const result = runMatch({
      world,
      mapJson,
      modId,
      charIds,
      policies: charIds.map(() => policy || {}),
      seed: `${seed}:melee:${i}`,
      maxTurns,
    });
    charIds.forEach(id => { const t = tally[id] || (tally[id] = { games: 0, wins: 0 }); t.games++; });
    if (result.winner != null) {
      const winnerChar = charIds[parseInt(result.winner)];
      if (winnerChar) tally[winnerChar].wins++;
    }
    accumulateDuelStats(duelAcc, result.events, charIds);
  }
  return { rows: meleeAggregate(tally, seats, gate), seats, games, duelTable: duelStatsTable(duelAcc) };
}
