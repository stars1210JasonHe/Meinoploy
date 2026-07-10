import {
  seatOfA, ci95, aggregate, evaluateGate, DEFAULT_GATE, runStrategyTournament,
  accumulateDuelStats, duelStatsTable, mergeDuelTables,
} from '../sim/tournament';
import { rankStandings, getTotalAssets } from '../sim/standings';
import { TERRA_CIRCUIT } from '../../mods/dominion/atlas/worlds/terra-circuit';

describe('seatOfA — seat rotation', () => {
  test('contestant A is in seat 0 for the first half, seat 1 for the second', () => {
    const n = 10;
    const seats = [];
    for (let i = 0; i < n; i++) seats.push(seatOfA(i, n));
    expect(seats).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1, 1]);
  });

  test('split is exactly half-and-half for even N', () => {
    const n = 200;
    let inSeat0 = 0;
    for (let i = 0; i < n; i++) if (seatOfA(i, n) === 0) inSeat0++;
    expect(inSeat0).toBe(100);
  });

  test('seats actually swap across game indices (not constant)', () => {
    expect(seatOfA(0, 4)).toBe(0);
    expect(seatOfA(3, 4)).toBe(1);
    expect(seatOfA(0, 4)).not.toBe(seatOfA(3, 4));
  });
});

describe('ci95 — confidence interval math', () => {
  test('half-width for p=0.5, n=100 is 1.96*sqrt(0.25/100)=0.098', () => {
    expect(ci95(0.5, 100)).toBeCloseTo(0.098, 3);
  });

  test('p=0 or p=1 gives zero width', () => {
    expect(ci95(0, 100)).toBe(0);
    expect(ci95(1, 100)).toBe(0);
  });

  test('n=0 guarded to 0', () => {
    expect(ci95(0.5, 0)).toBe(0);
  });

  test('shrinks as n grows', () => {
    expect(ci95(0.5, 400)).toBeLessThan(ci95(0.5, 100));
  });
});

describe('aggregate — win% on a known tally', () => {
  test('computes win% and CI from a known tally', () => {
    // 100 decisive games, A won 55, B won 45.
    const rows = aggregate({ A: 55, B: 45 }, 100, ['A', 'B']);
    expect(rows[0].label).toBe('A');
    expect(rows[0].winPct).toBeCloseTo(0.55, 5);
    expect(rows[1].label).toBe('B');
    expect(rows[1].winPct).toBeCloseTo(0.45, 5);
    // CI half-width ~ 1.96*sqrt(.55*.45/100) = 0.0975
    expect(rows[0].ciLow).toBeCloseTo(0.55 - 0.0975, 3);
    expect(rows[0].ciHigh).toBeCloseTo(0.55 + 0.0975, 3);
  });

  test('rows sorted by win% descending', () => {
    const rows = aggregate({ A: 30, B: 70 }, 100, ['A', 'B']);
    expect(rows.map(r => r.label)).toEqual(['B', 'A']);
  });

  test('CI clamped to [0,1]', () => {
    const rows = aggregate({ A: 100, B: 0 }, 100, ['A', 'B']);
    expect(rows[0].ciHigh).toBeLessThanOrEqual(1);
    expect(rows[1].ciLow).toBeGreaterThanOrEqual(0);
  });
});

describe('evaluateGate — 60/40 fairness gate', () => {
  test('PASS when leader is at or below 60%', () => {
    const rows = aggregate({ A: 58, B: 42 }, 100, ['A', 'B']);
    const g = evaluateGate(rows, DEFAULT_GATE);
    expect(g.pass).toBe(true);
    expect(g.leader).toBe('A');
    expect(g.maxWinPct).toBeCloseTo(0.58, 5);
  });

  test('FAIL when leader exceeds 60%', () => {
    const rows = aggregate({ A: 65, B: 35 }, 100, ['A', 'B']);
    const g = evaluateGate(rows, DEFAULT_GATE);
    expect(g.pass).toBe(false);
  });

  test('exactly 60% passes (boundary inclusive)', () => {
    const rows = aggregate({ A: 60, B: 40 }, 100, ['A', 'B']);
    expect(evaluateGate(rows, DEFAULT_GATE).pass).toBe(true);
  });

  test('flags when CI straddles 50%', () => {
    const rows = aggregate({ A: 55, B: 45 }, 100, ['A', 'B']);
    // 0.55 +/- 0.0975 = [0.4525, 0.6475] → straddles 0.5
    expect(evaluateGate(rows, DEFAULT_GATE).ciStraddles50).toBe(true);
  });

  test('does NOT flag straddle when clearly separated', () => {
    const rows = aggregate({ A: 80, B: 20 }, 1000, ['A', 'B']);
    expect(evaluateGate(rows, DEFAULT_GATE).ciStraddles50).toBe(false);
  });

  test('gate threshold is configurable', () => {
    const rows = aggregate({ A: 58, B: 42 }, 100, ['A', 'B']);
    expect(evaluateGate(rows, { maxWinPct: 0.55 }).pass).toBe(false);
  });
});

// --- Tiebreak (D5): the turn-cap winner is the higher net-worth player ---------

function capG(p0Money, p0Props, p1Money, p1Props) {
  // Two single-property groups so building/group math is exercised lightly.
  const board = {
    spaces: [
      { id: 0, type: 'property', color: 'a', price: 200 },
      { id: 1, type: 'property', color: 'b', price: 100 },
    ],
    colorGroups: { a: [0], b: [1] },
  };
  const players = [
    { id: '0', money: p0Money, properties: p0Props, bankrupt: false },
    { id: '1', money: p1Money, properties: p1Props, bankrupt: false },
  ];
  return { board, players, ownership: { 0: null, 1: null }, buildings: {}, mortgaged: {} };
}

describe('rankStandings tiebreak — higher net worth wins on cap', () => {
  test('player with higher total assets ranks first', () => {
    // p0: $500 cash, owns space 0 ($200) → 700. p1: $400 cash, owns space 1 ($100) → 500.
    const G = capG(500, [0], 400, [1]);
    G.ownership = { 0: '0', 1: '1' };
    const ranked = rankStandings(G, G.players);
    expect(ranked[0].id).toBe('0');
    expect(ranked[0].score).toBe(700);
    expect(ranked[1].score).toBe(500);
  });

  test('property value counts toward net worth (not just cash)', () => {
    // p0 less cash but a pricier property → still wins.
    const G = capG(100, [0], 250, []); // p0: 100+200=300; p1: 250
    G.ownership = { 0: '0', 1: null };
    const ranked = rankStandings(G, G.players);
    expect(ranked[0].id).toBe('0');
  });

  test('mortgaged property valued at mortgage payout, not full price', () => {
    const G = capG(0, [0], 0, [1]);
    G.ownership = { 0: '0', 1: '1' };
    G.mortgaged = { 0: true }; // space 0 price 200 → mortgaged worth floor(200*0.5)=100
    // p0: 0 + 100 = 100; p1: 0 + 100 (space1 price 100, unmortgaged) = 100 → tie on score,
    // tie-break on cash (both 0) then id asc → p0 first.
    const ranked = rankStandings(G, G.players);
    expect(getTotalAssets(G, G.players[0])).toBe(100);
    expect(ranked[0].id).toBe('0');
  });

  test('cash tie-break when net worth equal', () => {
    const G = capG(300, [], 300, []); // equal score 300
    const ranked = rankStandings(G, G.players);
    expect(ranked[0].id).toBe('0'); // equal cash → id asc
  });
});

// --- runStrategyTournament: camper/tourer with the character confound removed -----
// Integration test (drives real games), kept fast via tiny games/maxTurns. The point
// is the METHODOLOGY: it must tally by STRATEGY across BOTH character→strategy
// assignments, expose the per-assignment split, and be deterministic.
describe('runStrategyTournament — character-confound removal', () => {
  const base = {
    world: TERRA_CIRCUIT,
    charA: 'cassian-echo',
    charB: 'renn-chainbreaker',
    strategyA: 'camper',
    strategyB: 'tourer',
    games: 6,
    maxTurns: 30,
    baseSeed: 'confound-test',
  };

  test('aggregates by strategy label, wins sum to decisive', () => {
    const r = runStrategyTournament(base);
    const labels = r.table.map(row => row.label).sort();
    expect(labels).toEqual(['camper', 'tourer']);
    const totalWins = r.table.reduce((s, row) => s + row.wins, 0);
    expect(totalWins).toBe(r.decisive);
    expect(r.decisive + r.draws).toBe(base.games);
  });

  test('exposes BOTH character→strategy assignments (proof the confound is averaged out)', () => {
    const r = runStrategyTournament(base);
    expect(r.subTournaments).toBeDefined();
    // Each sub-table is keyed by strategy in BOTH runs, but the character carrying
    // each strategy is swapped between them.
    expect(r.subTournaments.charAisStrategyA.map(x => x.label).sort()).toEqual(['camper', 'tourer']);
    expect(r.subTournaments.charBisStrategyA.map(x => x.label).sort()).toEqual(['camper', 'tourer']);
  });

  test('deterministic: same seed → identical strategy table', () => {
    const a = runStrategyTournament(base);
    const b = runStrategyTournament(base);
    expect(b.table).toEqual(a.table);
  });
});

// --- duel economics accumulation (Task 7 of the duel mechanism) ---------------
// Unit-tested against CRAFTED events (a stand-in for a real runMatch result's
// `.events`), not a full tournament — real duel activity requires
// RULES.duel.enabled (off by default) plus a non-'never' duelPolicy, and
// driving that through real games in jest would be slow; the accumulation
// LOGIC itself is what's under test here.
describe('accumulateDuelStats / duelStatsTable — duel cashflow per character', () => {
  const charIds = ['albert-victor', 'lia-startrace']; // seat 0, seat 1

  test('challenger wins (outcome waived): rentWaived credited to the challenger, duelsWon too', () => {
    const events = [
      { type: 'duel_offered', actor: '0', data: { propertyId: 3, ownerId: '1', rent: 40 } },
      { type: 'duel_initiated', actor: '0', data: { propertyId: 3, ownerId: '1', rent: 40 } },
      // rent on duel_resolved (final-review Fix 2a) — the source of pricing now, not correlation.
      { type: 'duel_resolved', actor: '0', data: { propertyId: 3, ownerId: '1', winnerId: '0', outcome: 'waived', rent: 40 } },
    ];
    const acc = accumulateDuelStats({}, events, charIds);
    expect(acc['albert-victor']).toEqual({ duelsInitiated: 1, duelsWon: 1, rentWaived: 40, rentDoubledPaid: 0 });
    expect(acc['lia-startrace']).toBeUndefined(); // owner never referenced by an event
  });

  test("defender wins (outcome double): rentDoubledPaid = loseMultiplier x rent, credited to the CHALLENGER; duelsWon to the defender", () => {
    const events = [
      { type: 'duel_initiated', actor: '0', data: { propertyId: 5, ownerId: '1', rent: 30 } },
      { type: 'duel_resolved', actor: '0', data: { propertyId: 5, ownerId: '1', winnerId: '1', outcome: 'double', rent: 30 } },
    ];
    const acc = accumulateDuelStats({}, events, charIds);
    // RULES.duel.loseMultiplier default is 2 → 2 * 30 = 60.
    expect(acc['albert-victor']).toEqual({ duelsInitiated: 1, duelsWon: 0, rentWaived: 0, rentDoubledPaid: 60 });
    expect(acc['lia-startrace']).toEqual({ duelsInitiated: 0, duelsWon: 1, rentWaived: 0, rentDoubledPaid: 0 });
  });

  // Final-review Fix 2b regression: duel_resolved now carries its own rent, so
  // pricing survives even when the log's front-trim cut away the preceding
  // duel_initiated (the OLD pendingRent-correlation approach would have priced
  // this at 0 — see this file's git history / tournament.js's accumulateDuelStats
  // header comment).
  test('duel_resolved prices correctly even with NO preceding duel_initiated in the scanned window (simulates a front-trimmed log)', () => {
    const events = [
      { type: 'duel_resolved', actor: '0', data: { propertyId: 9, ownerId: '1', winnerId: '0', outcome: 'waived', rent: 77 } },
    ];
    const acc = accumulateDuelStats({}, events, charIds);
    expect(acc['albert-victor']).toEqual({ duelsInitiated: 0, duelsWon: 1, rentWaived: 77, rentDoubledPaid: 0 });
  });

  test('a declined offer (no duel_initiated/duel_resolved) contributes nothing', () => {
    const events = [
      { type: 'duel_offered', actor: '0', data: { propertyId: 2, ownerId: '1', rent: 25 } },
      { type: 'duel_declined', actor: '1', data: { challengerId: '0', propertyId: 2 } },
    ];
    expect(accumulateDuelStats({}, events, charIds)).toEqual({});
  });

  test('folds across MULTIPLE games (calls) into the SAME accumulator, keyed by character not seat', () => {
    // Game 1: albert-victor in seat 0 initiates and wins.
    const game1 = [
      { type: 'duel_initiated', actor: '0', data: { propertyId: 1, ownerId: '1', rent: 10 } },
      { type: 'duel_resolved', actor: '0', data: { propertyId: 1, ownerId: '1', winnerId: '0', outcome: 'waived', rent: 10 } },
    ];
    // Game 2: seats rotate — albert-victor now in seat 1, still initiates (as owner-seat
    // this time is irrelevant to accumulation; only the actor's mapped charId matters)
    // and loses.
    const rotatedCharIds = ['lia-startrace', 'albert-victor'];
    const game2 = [
      { type: 'duel_initiated', actor: '1', data: { propertyId: 2, ownerId: '0', rent: 20 } },
      { type: 'duel_resolved', actor: '1', data: { propertyId: 2, ownerId: '0', winnerId: '0', outcome: 'double', rent: 20 } },
    ];
    let acc = {};
    acc = accumulateDuelStats(acc, game1, charIds);
    acc = accumulateDuelStats(acc, game2, rotatedCharIds);
    expect(acc['albert-victor']).toEqual({ duelsInitiated: 2, duelsWon: 1, rentWaived: 10, rentDoubledPaid: 40 });
    expect(acc['lia-startrace']).toEqual({ duelsInitiated: 0, duelsWon: 1, rentWaived: 0, rentDoubledPaid: 0 });
  });

  test('no events → accumulator untouched; empty acc → no table rows', () => {
    expect(accumulateDuelStats({}, [], charIds)).toEqual({});
    expect(accumulateDuelStats({}, null, charIds)).toEqual({});
    expect(duelStatsTable({})).toEqual([]);
  });

  test('duelStatsTable sorts rows by charId and includes the charId field', () => {
    const acc = {
      'lia-startrace': { duelsInitiated: 1, duelsWon: 0, rentWaived: 0, rentDoubledPaid: 20 },
      'albert-victor': { duelsInitiated: 2, duelsWon: 2, rentWaived: 30, rentDoubledPaid: 0 },
    };
    expect(duelStatsTable(acc)).toEqual([
      { charId: 'albert-victor', duelsInitiated: 2, duelsWon: 2, rentWaived: 30, rentDoubledPaid: 0 },
      { charId: 'lia-startrace', duelsInitiated: 1, duelsWon: 0, rentWaived: 0, rentDoubledPaid: 20 },
    ]);
  });
});

describe('mergeDuelTables — combining two sub-tournament duel tables', () => {
  test('both null → null', () => {
    expect(mergeDuelTables(null, null)).toBeNull();
  });

  test('one null → the other, unchanged (still passes through duelStatsTable shape)', () => {
    const table = duelStatsTable({ 'albert-victor': { duelsInitiated: 1, duelsWon: 1, rentWaived: 10, rentDoubledPaid: 0 } });
    expect(mergeDuelTables(table, null)).toEqual(table);
    expect(mergeDuelTables(null, table)).toEqual(table);
  });

  test('sums rows sharing a charId across both tables', () => {
    const a = duelStatsTable({ 'albert-victor': { duelsInitiated: 1, duelsWon: 1, rentWaived: 10, rentDoubledPaid: 0 } });
    const b = duelStatsTable({ 'albert-victor': { duelsInitiated: 2, duelsWon: 0, rentWaived: 0, rentDoubledPaid: 40 } });
    expect(mergeDuelTables(a, b)).toEqual([
      { charId: 'albert-victor', duelsInitiated: 3, duelsWon: 1, rentWaived: 10, rentDoubledPaid: 40 },
    ]);
  });

  test('rows for a charId present in only ONE table still show up', () => {
    const a = duelStatsTable({ 'albert-victor': { duelsInitiated: 1, duelsWon: 1, rentWaived: 10, rentDoubledPaid: 0 } });
    const b = duelStatsTable({ 'lia-startrace': { duelsInitiated: 1, duelsWon: 0, rentWaived: 0, rentDoubledPaid: 20 } });
    expect(mergeDuelTables(a, b)).toEqual([
      { charId: 'albert-victor', duelsInitiated: 1, duelsWon: 1, rentWaived: 10, rentDoubledPaid: 0 },
      { charId: 'lia-startrace', duelsInitiated: 1, duelsWon: 0, rentWaived: 0, rentDoubledPaid: 20 },
    ]);
  });
});
