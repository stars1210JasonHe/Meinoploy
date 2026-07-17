// src/__tests__/dialogue-memory.test.js — T1 (MT2-SP4 direction B, 记忆宿敌).
// Spec: docs/superpowers/specs/2026-07-17-dialogue-system-design.md
// Plan: docs/superpowers/plans/2026-07-17-dialogue-b-plan.md
//
// Two fixture styles, both established elsewhere in this suite:
//  - Hand-built plain event objects ({seq, turn, type, actor, data}) with
//    field names copied VERBATIM from the Game.js logEvent call sites (line
//    refs in comments) — lets tests control turn/seq precisely for window
//    and decay boundary assertions.
//  - A dedicated "real shapes" block that drives the REAL logEvent (src/
//    events.js) against a minimal G stub built from the real dominion board/
//    RULES (mirrors src/__tests__/engine-events-emit.test.js's freshG
//    pattern) — a regression guard proving the hand-built fixtures above
//    match what the engine actually produces, not just my transcription.
import { INVALID_MOVE } from 'boardgame.io/core';
import { RULES, BOARD_SPACES } from '../../mods/dominion';
import { Monopoly } from '../Game';
import { DEFAULT_RULES } from '../mod-loader';
import { logEvent } from '../events';
import {
  DEFAULT_DIALOGUE_RULES,
  resolveDialogueRules,
  createLedgerState,
  getAttitude,
  applyEvent,
  applyEvents,
  decayLedger,
  serializeLedger,
  deserializeLedger,
  buildTurnDigest,
} from '../dialogue/memory';

function ev(seq, turn, type, actor, data) {
  return { seq, turn, type, actor, data };
}

// ---------------------------------------------------------------------------
// resolveDialogueRules — the "missing RULES.dialogue" fallback surface
// ---------------------------------------------------------------------------

describe('resolveDialogueRules', () => {
  test('undefined/null => full defaults, no NaN holes', () => {
    expect(resolveDialogueRules(undefined)).toEqual(DEFAULT_DIALOGUE_RULES);
    expect(resolveDialogueRules(null)).toEqual(DEFAULT_DIALOGUE_RULES);
  });

  test('a RULES object with NO dialogue key at all => full defaults (NaN-hole guard)', () => {
    const rulesLikeAMod = { core: { boardSize: 40 }, buildings: { names: ['x'] } };
    expect(resolveDialogueRules(rulesLikeAMod)).toEqual(DEFAULT_DIALOGUE_RULES);
  });

  test('a bare RULES.dialogue-shaped object is honored directly', () => {
    const bare = { weights: { duelLostGrudge: 99 } };
    const resolved = resolveDialogueRules(bare);
    expect(resolved.weights.duelLostGrudge).toBe(99);
    // gaps still filled
    expect(resolved.weights.bankruptedByGrudge).toBe(DEFAULT_DIALOGUE_RULES.weights.bankruptedByGrudge);
    expect(resolved.caps).toEqual(DEFAULT_DIALOGUE_RULES.caps);
  });

  test('the full RULES object (with a nested .dialogue) reads .dialogue, not the top level', () => {
    const fullRules = { core: {}, dialogue: { rentGrudgeThreshold: 5 } };
    const resolved = resolveDialogueRules(fullRules);
    expect(resolved.rentGrudgeThreshold).toBe(5);
    expect(resolved.weights).toEqual(DEFAULT_DIALOGUE_RULES.weights);
  });

  test('real mods/dominion RULES.dialogue round-trips through resolveDialogueRules unchanged', () => {
    expect(resolveDialogueRules(RULES)).toEqual(RULES.dialogue);
  });
});

// ---------------------------------------------------------------------------
// Defaults drift guard (review fix wave). The dialogue defaults exist as
// THREE hand-copied objects: DEFAULT_DIALOGUE_RULES (src/dialogue/memory.js),
// DEFAULT_RULES.dialogue (src/mod-loader.js), and the mods/dominion/rules.js
// dialogue block. The round-trip test above is tautological for drift (a
// fully-populated RULES.dialogue always wins the merge, so the defaults'
// VALUES are never compared) — these pairwise equality checks are the real
// guard. When T2 adds a field (e.g. costBudgetUSD), it must land in all
// three or these fail by construction.
// ---------------------------------------------------------------------------

describe('defaults drift guard — three copies stay in sync', () => {
  test('mods/dominion/rules.js dialogue block === module DEFAULT_DIALOGUE_RULES', () => {
    expect(RULES.dialogue).toEqual(DEFAULT_DIALOGUE_RULES);
  });

  test('mod-loader DEFAULT_RULES.dialogue === module DEFAULT_DIALOGUE_RULES', () => {
    expect(DEFAULT_RULES.dialogue).toEqual(DEFAULT_DIALOGUE_RULES);
  });

  test('mod-loader DEFAULT_RULES.dialogue === mods/dominion/rules.js dialogue block', () => {
    expect(DEFAULT_RULES.dialogue).toEqual(RULES.dialogue);
  });
});

// ---------------------------------------------------------------------------
// AttitudeLedger — rule table, one describe per row
// ---------------------------------------------------------------------------

describe('AttitudeLedger.applyEvent — rent_paid (big rent grudge)', () => {
  test('amount >= threshold: payer grudge toward owner increases by bigRentGrudge', () => {
    const state = createLedgerState();
    const e = ev(0, 1, 'rent_paid', '1', { propertyId: 3, ownerId: '0', amount: 250 });
    const next = applyEvent(state, e, RULES);
    expect(getAttitude(next, '1', '0')).toEqual({ grudge: RULES.dialogue.weights.bigRentGrudge, trust: 0 });
    expect(getAttitude(next, '0', '1')).toEqual({ grudge: 0, trust: 0 }); // one-directional
  });

  test('amount below threshold: no-op, same state reference', () => {
    const state = createLedgerState();
    const e = ev(0, 1, 'rent_paid', '1', { propertyId: 3, ownerId: '0', amount: 50 });
    expect(applyEvent(state, e, RULES)).toBe(state);
  });

  test('threshold is config-driven', () => {
    const state = createLedgerState();
    const customRules = { dialogue: { rentGrudgeThreshold: 10 } };
    const e = ev(0, 1, 'rent_paid', '1', { propertyId: 3, ownerId: '0', amount: 20 });
    const next = applyEvent(state, e, customRules);
    expect(getAttitude(next, '1', '0').grudge).toBe(DEFAULT_DIALOGUE_RULES.weights.bigRentGrudge);
  });
});

describe('AttitudeLedger.applyEvent — duel_resolved (duel lost)', () => {
  test('challenger loses (owner wins): challenger grudge toward owner rises', () => {
    const state = createLedgerState();
    const e = ev(0, 1, 'duel_resolved', '1', {
      propertyId: 3, ownerId: '0', rent: 100,
      challengerRoll: { total: 5 }, defenderRoll: { total: 9 },
      winnerId: '0', outcome: 'double',
    });
    const next = applyEvent(state, e, RULES);
    expect(getAttitude(next, '1', '0').grudge).toBe(RULES.dialogue.weights.duelLostGrudge);
  });

  test('owner loses (challenger wins): owner grudge toward challenger rises', () => {
    const state = createLedgerState();
    const e = ev(0, 1, 'duel_resolved', '1', {
      propertyId: 3, ownerId: '0', rent: 100,
      challengerRoll: { total: 11 }, defenderRoll: { total: 4 },
      winnerId: '1', outcome: 'waived',
    });
    const next = applyEvent(state, e, RULES);
    expect(getAttitude(next, '0', '1').grudge).toBe(RULES.dialogue.weights.duelLostGrudge);
    expect(getAttitude(next, '1', '0')).toEqual({ grudge: 0, trust: 0 }); // winner untouched
  });
});

describe('AttitudeLedger.applyEvent — bankruptcy (bankrupted by)', () => {
  test('creditorId present: bankrupt player grudge toward creditor rises', () => {
    const state = createLedgerState();
    const e = ev(0, 1, 'bankruptcy', '1', { creditorId: '0' });
    const next = applyEvent(state, e, RULES);
    expect(getAttitude(next, '1', '0').grudge).toBe(RULES.dialogue.weights.bankruptedByGrudge);
  });

  test('creditorId null (bankrupt via tax/card): no attributable actor, no-op', () => {
    const state = createLedgerState();
    const e = ev(0, 1, 'bankruptcy', '1', { creditorId: null });
    expect(applyEvent(state, e, RULES)).toBe(state);
  });
});

describe('AttitudeLedger.applyEvent — trade_accepted (symmetric trust)', () => {
  test('both parties gain trust toward each other', () => {
    const state = createLedgerState();
    const e = ev(0, 1, 'trade_accepted', '1', { proposerId: '0' }); // actor = target
    const next = applyEvent(state, e, RULES);
    expect(getAttitude(next, '1', '0')).toEqual({ grudge: 0, trust: RULES.dialogue.weights.tradeAcceptedTrust });
    expect(getAttitude(next, '0', '1')).toEqual({ grudge: 0, trust: RULES.dialogue.weights.tradeAcceptedTrust });
  });
});

describe('AttitudeLedger.applyEvent — card_applied forceBuy (hostile takeover)', () => {
  test("forceBuy 'bought': victim grudge toward the taker rises", () => {
    const state = createLedgerState();
    const e = ev(0, 1, 'card_applied', '1', {
      deck: 'chance', cardIndex: 2, action: 'forceBuy', text: 'x',
      effect: { outcome: 'bought', propertyId: 6, targetSpaceName: 'Y', targetOwnerId: '2', cost: 80 },
    });
    const next = applyEvent(state, e, RULES);
    expect(getAttitude(next, '2', '1').grudge).toBe(RULES.dialogue.weights.forceBuyVictimGrudge);
  });

  test.each([
    ['forceBuy insufficient_funds (no victim)', { action: 'forceBuy', effect: { outcome: 'insufficient_funds', cost: 500 } }],
    ['forceBuy no_opponents (no victim)', { action: 'forceBuy', effect: { outcome: 'no_opponents' } }],
    ['pay (settles with the bank, no opponent id)', { action: 'pay', effect: { amount: 40 } }],
    ['payPercent (settles with the bank)', { action: 'payPercent', effect: { assets: 1000, amount: 100, percent: 10 } }],
    ['downgrade (no opponent id)', { action: 'downgrade', effect: { outcome: 'downgraded', propertyId: 1, targetSpaceName: 'Z', newLevel: 0, newLevelName: 'Vacant' } }],
    ['goToJail (no opponent id)', { action: 'goToJail', effect: {} }],
  ])('%s => no-op', (_label, data) => {
    const state = createLedgerState();
    const e = ev(0, 1, 'card_applied', '1', { deck: 'chance', cardIndex: 0, text: 'x', ...data });
    expect(applyEvent(state, e, RULES)).toBe(state);
  });
});

describe('AttitudeLedger.applyEvent — season_changed decays every pair', () => {
  test('decays both grudge and trust across multiple pairs toward 0', () => {
    let state = createLedgerState();
    state = applyEvent(state, ev(0, 1, 'bankruptcy', '1', { creditorId: '0' }), RULES); // grudge 3
    state = applyEvent(state, ev(1, 1, 'trade_accepted', '2', { proposerId: '0' }), RULES); // trust 1 both ways
    const before10 = getAttitude(state, '1', '0');
    const beforeTrust = getAttitude(state, '2', '0');
    const next = applyEvent(state, ev(2, 2, 'season_changed', null, { seasonIndex: 1, seasonName: 'Autumn' }), RULES);
    expect(getAttitude(next, '1', '0').grudge).toBe(before10.grudge - RULES.dialogue.decayPerSeason.grudge);
    expect(getAttitude(next, '2', '0').trust).toBe(beforeTrust.trust - RULES.dialogue.decayPerSeason.trust);
  });

  test('decayLedger is directly callable and equivalent to routing season_changed through applyEvent', () => {
    let state = createLedgerState();
    state = applyEvent(state, ev(0, 1, 'bankruptcy', '1', { creditorId: '0' }), RULES);
    const viaEvent = applyEvent(state, ev(1, 2, 'season_changed', null, { seasonIndex: 1, seasonName: 'Autumn' }), RULES);
    const viaDirect = decayLedger(state, RULES);
    expect(viaEvent).toEqual(viaDirect);
  });

  test('empty ledger decay is a no-op (same reference)', () => {
    const state = createLedgerState();
    expect(decayLedger(state, RULES)).toBe(state);
  });
});

describe('AttitudeLedger.applyEvent — unknown/irrelevant event tolerance', () => {
  test('a genuinely unknown future event type no-ops (registry will grow)', () => {
    const state = createLedgerState();
    const e = ev(0, 1, 'some_future_event_type_2027', '1', { whatever: true });
    expect(applyEvent(state, e, RULES)).toBe(state);
  });

  test.each(['dice_rolled', 'moved', 'property_bought', 'auction_started', 'bid_placed', 'trade_proposed', 'trade_rejected', 'trade_cancelled'])(
    'known-but-ledger-irrelevant type %s no-ops',
    (type) => {
      const state = createLedgerState();
      const e = ev(0, 1, type, '1', {});
      expect(applyEvent(state, e, RULES)).toBe(state);
    }
  );

  test('malformed event (no type) no-ops without throwing', () => {
    const state = createLedgerState();
    expect(() => applyEvent(state, {}, RULES)).not.toThrow();
    expect(applyEvent(state, {}, RULES)).toBe(state);
  });

  test('null/undefined state is tolerated, starts fresh', () => {
    const e = ev(0, 1, 'bankruptcy', '1', { creditorId: '0' });
    expect(() => applyEvent(undefined, e, RULES)).not.toThrow();
    expect(getAttitude(applyEvent(undefined, e, RULES), '1', '0').grudge).toBe(RULES.dialogue.weights.bankruptedByGrudge);
  });

  test('missing RULES.dialogue end-to-end through applyEvent still applies default weights', () => {
    const rulesWithNoDialogue = { core: { boardSize: 40 } }; // no .dialogue key
    const state = createLedgerState();
    const e = ev(0, 1, 'bankruptcy', '1', { creditorId: '0' });
    const next = applyEvent(state, e, rulesWithNoDialogue);
    expect(getAttitude(next, '1', '0').grudge).toBe(DEFAULT_DIALOGUE_RULES.weights.bankruptedByGrudge);
  });
});

// ---------------------------------------------------------------------------
// Caps + decay boundaries
// ---------------------------------------------------------------------------

describe('caps + decay boundaries', () => {
  test('grudge clamps at rules.caps.grudge and does not exceed it with repeated losses', () => {
    let state = createLedgerState();
    const cap = RULES.dialogue.caps.grudge;
    for (let i = 0; i < 20; i++) {
      state = applyEvent(state, ev(i, i, 'bankruptcy', '1', { creditorId: '0' }), RULES);
    }
    expect(getAttitude(state, '1', '0').grudge).toBe(cap);
  });

  test('once at cap, further identical events are true no-ops (identity-stable)', () => {
    let state = createLedgerState();
    const custom = { dialogue: { caps: { grudge: 3, trust: 10 }, weights: { bankruptedByGrudge: 3 } } };
    state = applyEvent(state, ev(0, 1, 'bankruptcy', '1', { creditorId: '0' }), custom);
    expect(getAttitude(state, '1', '0').grudge).toBe(3);
    const capped = applyEvent(state, ev(1, 2, 'bankruptcy', '1', { creditorId: '0' }), custom);
    expect(capped).toBe(state); // no change possible, same reference
  });

  test('decay never undershoots past 0', () => {
    const custom = { dialogue: { decayPerSeason: { grudge: 5, trust: 5 } } };
    let state = createLedgerState();
    state = applyEvent(state, ev(0, 1, 'bankruptcy', '1', { creditorId: '0' }), RULES); // grudge 3
    const decayed = decayLedger(state, custom);
    expect(getAttitude(decayed, '1', '0').grudge).toBe(0);
  });

  test('decay of an exact-zero pair stays at zero (no negative excursion)', () => {
    let state = { '1': { '0': { grudge: 0, trust: 0 } } };
    const decayed = decayLedger(state, RULES);
    // no observable change -> identity-stable
    expect(decayed).toBe(state);
  });
});

// ---------------------------------------------------------------------------
// applyEvents batch + determinism
// ---------------------------------------------------------------------------

describe('applyEvents (batch) + determinism', () => {
  const mixedEvents = [
    ev(0, 1, 'rent_paid', '1', { propertyId: 3, ownerId: '0', amount: 250 }),
    ev(1, 2, 'duel_resolved', '2', { propertyId: 5, ownerId: '1', rent: 50, challengerRoll: { total: 4 }, defenderRoll: { total: 8 }, winnerId: '1', outcome: 'double' }),
    ev(2, 3, 'trade_accepted', '0', { proposerId: '2' }),
    ev(3, 4, 'bankruptcy', '2', { creditorId: '0' }),
    ev(4, 10, 'season_changed', null, { seasonIndex: 1, seasonName: 'Autumn' }),
    ev(5, 11, 'card_applied', '0', { deck: 'community', cardIndex: 1, action: 'forceBuy', text: 'x', effect: { outcome: 'bought', propertyId: 9, targetSpaceName: 'Q', targetOwnerId: '1', cost: 120 } }),
  ];

  test('same event list applied twice from fresh state => deep-equal ledgers', () => {
    const a = applyEvents(createLedgerState(), mixedEvents, RULES);
    const b = applyEvents(createLedgerState(), mixedEvents, RULES);
    expect(a).toEqual(b);
    expect(a).not.toBe(b); // structurally equal, not the same object
  });

  test('applyEvents matches manual sequential applyEvent folding', () => {
    let manual = createLedgerState();
    for (const e of mixedEvents) manual = applyEvent(manual, e, RULES);
    const batch = applyEvents(createLedgerState(), mixedEvents, RULES);
    expect(batch).toEqual(manual);
  });

  test('empty event list is a no-op', () => {
    const state = createLedgerState();
    expect(applyEvents(state, [], RULES)).toBe(state);
    expect(applyEvents(state, undefined, RULES)).toBe(state);
  });
});

// ---------------------------------------------------------------------------
// serialize / deserialize
// ---------------------------------------------------------------------------

describe('serialize/deserialize', () => {
  function sampleLedger() {
    let state = createLedgerState();
    state = applyEvent(state, ev(0, 1, 'bankruptcy', '1', { creditorId: '0' }), RULES);
    state = applyEvent(state, ev(1, 2, 'trade_accepted', '2', { proposerId: '0' }), RULES);
    return state;
  }

  test('round-trip: deserialize(serialize(state)) deep-equals state', () => {
    const state = sampleLedger();
    const round = deserializeLedger(serializeLedger(state));
    expect(round).toEqual(state);
  });

  test('byte-stability: serializing the same state twice yields identical JSON', () => {
    const state = sampleLedger();
    const s1 = JSON.stringify(serializeLedger(state));
    const s2 = JSON.stringify(serializeLedger(state));
    expect(s1).toBe(s2);
  });

  test('byte-stability across two INDEPENDENTLY-built equivalent ledgers (review NIT): same event history folded twice from fresh state => identical bytes', () => {
    // sampleLedger() constructs a brand-new state per call by re-applying the
    // same events — two separate objects, not one serialized twice — so this
    // asserts that key-insertion order (and thus JSON bytes) is a pure
    // function of event order, not of object identity.
    const a = sampleLedger();
    const b = sampleLedger();
    expect(a).not.toBe(b);
    expect(JSON.stringify(serializeLedger(a))).toBe(JSON.stringify(serializeLedger(b)));
  });

  test('serializeLedger(undefined/null) => {}', () => {
    expect(serializeLedger(undefined)).toEqual({});
    expect(serializeLedger(null)).toEqual({});
  });

  test.each([undefined, null, 'not an object', 42, []])('deserializeLedger tolerates non-object input %p', (bad) => {
    expect(() => deserializeLedger(bad)).not.toThrow();
    expect(deserializeLedger(bad)).toEqual({});
  });

  test('deserializeLedger fills missing grudge/trust with 0 and drops non-finite values', () => {
    const raw = {
      '1': {
        '0': { grudge: 5 }, // missing trust
        '2': { trust: 4 },  // missing grudge
        '3': { grudge: 'NaN-ish', trust: undefined }, // non-finite
      },
    };
    expect(deserializeLedger(raw)).toEqual({
      '1': {
        '0': { grudge: 5, trust: 0 },
        '2': { grudge: 0, trust: 4 },
        '3': { grudge: 0, trust: 0 },
      },
    });
  });

  test('deserializeLedger drops malformed buckets/pairs and ignores unknown extra fields (old-save forward-compat)', () => {
    const raw = {
      '1': { '0': { grudge: 2, trust: 1, futureField: 'ignored' }, '9': 'not an object' },
      '2': 'not an object at all',
      futureTopLevelField: { some: 'junk' },
    };
    expect(deserializeLedger(raw)).toEqual({
      '1': { '0': { grudge: 2, trust: 1 } },
    });
  });

  test('deserialize of a completely absent save field (undefined) yields a fresh empty ledger', () => {
    const fresh = deserializeLedger(undefined);
    expect(fresh).toEqual(createLedgerState());
    // fresh ledger behaves identically to a brand-new one under applyEvent
    const withEvent = applyEvent(fresh, ev(0, 1, 'bankruptcy', '1', { creditorId: '0' }), RULES);
    expect(getAttitude(withEvent, '1', '0').grudge).toBe(RULES.dialogue.weights.bankruptedByGrudge);
  });
});

// ---------------------------------------------------------------------------
// buildTurnDigest
// ---------------------------------------------------------------------------

describe('buildTurnDigest — categorization with real amounts', () => {
  const events = [
    ev(0, 1, 'rent_paid', '1', { propertyId: 3, ownerId: '0', amount: 40 }),   // '1' pays '0'
    ev(1, 2, 'rent_paid', '0', { propertyId: 5, ownerId: '1', amount: 300 }),  // '0' pays '1'
    ev(2, 3, 'duel_resolved', '1', { propertyId: 3, ownerId: '0', rent: 60, challengerRoll: { total: 4 }, defenderRoll: { total: 9 }, winnerId: '0', outcome: 'double' }), // '1' loses to '0'
    ev(3, 4, 'duel_resolved', '2', { propertyId: 8, ownerId: '1', rent: 20, challengerRoll: { total: 11 }, defenderRoll: { total: 3 }, winnerId: '2', outcome: 'waived' }), // '2' beats '1'
    ev(4, 5, 'trade_proposed', '0', { targetPlayerId: '1', offeredProperties: [], requestedProperties: [], offeredMoney: 0, requestedMoney: 0 }),
    ev(5, 5, 'trade_accepted', '1', { proposerId: '0' }),
    ev(6, 6, 'trade_proposed', '2', { targetPlayerId: '1', offeredProperties: [], requestedProperties: [], offeredMoney: 0, requestedMoney: 0 }),
    ev(7, 6, 'trade_rejected', '1', { proposerId: '2' }),
    ev(8, 7, 'trade_cancelled', '0', { targetPlayerId: '1' }), // normal cancel
    ev(9, 8, 'trade_cancelled', '2', { targetPlayerId: '1', reason: 'stale' }), // stale auto-cancel
    ev(10, 9, 'trade_cancelled', '1', { otherPartyId: '0', reason: 'bankruptcy' }), // bankruptcy cleanup, actor='1' (was mid-trade with '0')
    ev(11, 10, 'auction_started', null, { propertyId: 7, bidders: ['0', '1', '2'] }),
    ev(12, 10, 'bid_placed', '1', { propertyId: 7, amount: 5 }),
    ev(13, 10, 'bid_placed', '2', { propertyId: 7, amount: 10 }),
    ev(14, 10, 'auction_ended', null, { propertyId: 7, winnerId: '2', amount: 10 }), // '1' bid and lost, '0' never bid
    ev(15, 11, 'card_applied', '1', { deck: 'chance', cardIndex: 0, action: 'pay', text: 'x', effect: { amount: 30 } }),
    ev(16, 11, 'card_applied', '1', { deck: 'chance', cardIndex: 1, action: 'payPercent', text: 'x', effect: { assets: 500, amount: 50, percent: 10 } }),
    ev(17, 12, 'card_applied', '0', { deck: 'community', cardIndex: 2, action: 'forceBuy', text: 'x', effect: { outcome: 'bought', propertyId: 9, targetSpaceName: 'Q', targetOwnerId: '1', cost: 120 } }),
    ev(18, 13, 'bankruptcy', '1', { creditorId: '0' }),
    ev(19, 14, 'bankruptcy', '2', { creditorId: null }),
  ];

  test('rentsPaid / rentsCollected carry real amounts and correct opponent', () => {
    const d1 = buildTurnDigest(events, '1', { maxEvents: 100, maxSeasons: 0 });
    expect(d1.rentsPaid).toEqual([{ turn: 1, opponentId: '0', propertyId: 3, amount: 40 }]);
    expect(d1.rentsCollected).toEqual([{ turn: 2, opponentId: '0', propertyId: 5, amount: 300 }]);
  });

  test('duelsWon / duelsLost from the perspective of the requested character', () => {
    const d1 = buildTurnDigest(events, '1', { maxEvents: 100, maxSeasons: 0 });
    // '1' loses twice: once as challenger (vs '0', turn 3), once as owner/
    // defender (vs '2', turn 4 — '2' challenged and beat '1' for property 8).
    expect(d1.duelsLost).toEqual([
      { turn: 3, opponentId: '0', propertyId: 3, rent: 60 },
      { turn: 4, opponentId: '2', propertyId: 8, rent: 20 },
    ]);
    expect(d1.duelsWon).toEqual([]);
    const d2 = buildTurnDigest(events, '2', { maxEvents: 100, maxSeasons: 0 });
    expect(d2.duelsWon).toEqual([{ turn: 4, opponentId: '1', propertyId: 8, rent: 20 }]);
  });

  test('trades: completed/rejected/cancelled (all three trade_cancelled field shapes)', () => {
    const d1 = buildTurnDigest(events, '1', { maxEvents: 100, maxSeasons: 0 });
    expect(d1.tradesCompleted).toEqual([{ turn: 5, opponentId: '0', role: 'target' }]);
    expect(d1.tradesRejected).toEqual([{ turn: 6, opponentId: '2', role: 'target' }]);
    // '1' is involved in all three cancels: normal (targetPlayerId), stale (targetPlayerId), bankruptcy (otherPartyId, actor='1')
    expect(d1.tradesCancelled).toEqual([
      { turn: 7, opponentId: '0', reason: 'manual' },
      { turn: 8, opponentId: '2', reason: 'stale' },
      { turn: 9, opponentId: '0', reason: 'bankruptcy' },
    ]);
  });

  test('auctions: won vs lost (only actual bidders count as "lost", not mere eligibility)', () => {
    const d0 = buildTurnDigest(events, '0', { maxEvents: 100, maxSeasons: 0 });
    expect(d0.auctionsWon).toEqual([]);
    expect(d0.auctionsLost).toEqual([]); // '0' never placed a bid, only listed as eligible in auction_started
    const d1 = buildTurnDigest(events, '1', { maxEvents: 100, maxSeasons: 0 });
    expect(d1.auctionsLost).toEqual([{ turn: 10, propertyId: 7, winnerId: '2', amount: 10 }]);
    const d2 = buildTurnDigest(events, '2', { maxEvents: 100, maxSeasons: 0 });
    expect(d2.auctionsWon).toEqual([{ turn: 10, propertyId: 7, amount: 10 }]);
  });

  test('cardsSuffered (pay/payPercent) and forceBuy property transfer (both directions)', () => {
    const d1 = buildTurnDigest(events, '1', { maxEvents: 100, maxSeasons: 0 });
    expect(d1.cardsSuffered).toEqual([
      { turn: 11, action: 'pay', amount: 30 },
      { turn: 11, action: 'payPercent', amount: 50 },
    ]);
    expect(d1.propertiesTakenFrom).toEqual([{ turn: 12, propertyId: 9, byId: '0', cost: 120 }]);
    const d0 = buildTurnDigest(events, '0', { maxEvents: 100, maxSeasons: 0 });
    expect(d0.propertiesTaken).toEqual([{ turn: 12, propertyId: 9, fromId: '1', cost: 120 }]);
  });

  test('bankruptcy split three ways: wasBankrupted / bankruptciesCaused / bankruptciesObserved', () => {
    const d1 = buildTurnDigest(events, '1', { maxEvents: 100, maxSeasons: 0 });
    expect(d1.wasBankrupted).toEqual([{ turn: 13, creditorId: '0' }]);
    const d0 = buildTurnDigest(events, '0', { maxEvents: 100, maxSeasons: 0 });
    expect(d0.bankruptciesCaused).toEqual([{ turn: 13, victimId: '1' }]);
    // '2' bankrupt via tax/card (creditorId null): observed by everyone else, not attributed to '0'
    expect(d0.bankruptciesObserved).toEqual([{ turn: 14, playerId: '2', creditorId: null }]);
  });

  test('charId null => well-formed empty digest, no throw', () => {
    expect(() => buildTurnDigest(events, null, {})).not.toThrow();
    const d = buildTurnDigest(events, null, {});
    expect(d.rentsPaid).toEqual([]);
    expect(d.charId).toBeNull();
  });

  test('determinism: same events + charId + window => deep-equal digest', () => {
    const a = buildTurnDigest(events, '1', { maxEvents: 100, maxSeasons: 0 });
    const b = buildTurnDigest(events, '1', { maxEvents: 100, maxSeasons: 0 });
    expect(a).toEqual(b);
  });
});

describe('buildTurnDigest — window edges', () => {
  function seasonEvent(seq, turn, seasonIndex) {
    return ev(seq, turn, 'season_changed', null, { seasonIndex, seasonName: RULES.seasons.list[seasonIndex].name });
  }
  function rentEvent(seq, turn) {
    return ev(seq, turn, 'rent_paid', '1', { propertyId: 1, ownerId: '0', amount: 10 });
  }

  test('fewer events than maxEvents/maxSeasons: keeps everything', () => {
    const events = [rentEvent(0, 1), rentEvent(1, 2), rentEvent(2, 3)];
    const d = buildTurnDigest(events, '1', { maxEvents: 60, maxSeasons: 2 });
    expect(d.window).toMatchObject({ totalEvents: 3, consideredEvents: 3, start: 0 });
    expect(d.rentsPaid).toHaveLength(3);
  });

  test('exactly at the maxEvents cap: keeps everything, start=0', () => {
    const events = Array.from({ length: 5 }, (_, i) => rentEvent(i, i + 1));
    const d = buildTurnDigest(events, '1', { maxEvents: 5, maxSeasons: 0 });
    expect(d.window).toMatchObject({ totalEvents: 5, consideredEvents: 5, start: 0 });
    expect(d.rentsPaid).toHaveLength(5);
  });

  test('one event over the maxEvents cap: drops exactly the oldest one', () => {
    const events = Array.from({ length: 6 }, (_, i) => rentEvent(i, i + 1));
    const d = buildTurnDigest(events, '1', { maxEvents: 5, maxSeasons: 0 });
    expect(d.window).toMatchObject({ totalEvents: 6, consideredEvents: 5, start: 1 });
    expect(d.rentsPaid).toHaveLength(5);
    expect(d.rentsPaid[0].turn).toBe(2); // turn 1's event (seq 0) dropped
  });

  test('season boundary: maxSeasons=2 keeps back to just after the 3rd-from-end boundary', () => {
    // layout: rent(t1) | season(t2,S0) | rent(t3) | season(t4,S1) | rent(t5) | season(t6,S2) | rent(t7)
    const events = [
      rentEvent(0, 1),
      seasonEvent(1, 2, 0),
      rentEvent(2, 3),
      seasonEvent(3, 4, 1),
      rentEvent(4, 5),
      seasonEvent(5, 6, 2),
      rentEvent(6, 7),
    ];
    const d = buildTurnDigest(events, '1', { maxEvents: 100, maxSeasons: 2 });
    // 3 season_changed events exist; maxSeasons=2 cuts right after the OLDEST
    // (1st-from-start / 3rd-from-end) boundary — index 1 (seq=1) excluded,
    // everything from index 2 onward kept.
    expect(d.window.seasonStart).toBe(2);
    expect(d.window.start).toBe(2);
    expect(d.rentsPaid.map(r => r.turn)).toEqual([3, 5, 7]);
  });

  test('maxSeasons=0 disables the season window entirely (count window alone governs)', () => {
    const events = [
      rentEvent(0, 1), seasonEvent(1, 2, 0), rentEvent(2, 3), seasonEvent(3, 4, 1), rentEvent(4, 5),
    ];
    const d = buildTurnDigest(events, '1', { maxEvents: 100, maxSeasons: 0 });
    expect(d.window.seasonStart).toBe(0);
    expect(d.rentsPaid).toHaveLength(3);
  });

  test('missing windowSpec falls back to DEFAULT_DIALOGUE_RULES.digestWindow', () => {
    const events = [rentEvent(0, 1)];
    const d = buildTurnDigest(events, '1', undefined);
    expect(d.window.requestedMaxEvents).toBe(DEFAULT_DIALOGUE_RULES.digestWindow.maxEvents);
    expect(d.window.requestedMaxSeasons).toBe(DEFAULT_DIALOGUE_RULES.digestWindow.maxSeasons);
  });

  test('empty event list => empty, well-formed digest', () => {
    const d = buildTurnDigest([], '1', { maxEvents: 60, maxSeasons: 2 });
    expect(d.window).toMatchObject({ totalEvents: 0, consideredEvents: 0, start: 0 });
    expect(d.generatedAtTurn).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Real event shapes via the actual logEvent (src/events.js) — regression
// guard against fixture drift from the hand-built objects above.
// ---------------------------------------------------------------------------

describe('real event shapes (driven through the actual logEvent)', () => {
  function realG() {
    return {
      events: [], eventSeq: 0, messages: [], totalTurns: 0,
      players: [{ id: '0' }, { id: '1' }, { id: '2' }],
      board: { spaces: BOARD_SPACES },
    };
  }

  test('logEvent-produced events feed buildTurnDigest/applyEvent identically to the hand-built fixtures', () => {
    const G = realG();
    G.totalTurns = 1;
    logEvent(G, 'rent_paid', '1', { propertyId: 1, ownerId: '0', amount: 250 });
    G.totalTurns = 2;
    logEvent(G, 'duel_resolved', '1', {
      propertyId: 3, ownerId: '0', rent: 100,
      challengerRoll: { total: 5 }, defenderRoll: { total: 9 },
      winnerId: '0', outcome: 'double',
    });
    G.totalTurns = 3;
    logEvent(G, 'bankruptcy', '1', { creditorId: '0' });
    G.totalTurns = 4;
    logEvent(G, 'trade_accepted', '2', { proposerId: '0' });
    G.totalTurns = 5;
    logEvent(G, 'card_applied', '1', {
      deck: 'chance', cardIndex: 0, action: 'forceBuy', text: 'x',
      effect: { outcome: 'bought', propertyId: 6, targetSpaceName: 'X', targetOwnerId: '2', cost: 80 },
    });
    G.totalTurns = 6;
    logEvent(G, 'season_changed', null, { seasonIndex: 1, seasonName: RULES.seasons.list[1].name });

    // sanity: logEvent really produced 6 well-formed events with seq/turn set
    expect(G.events).toHaveLength(6);
    expect(G.events.map(e => e.type)).toEqual([
      'rent_paid', 'duel_resolved', 'bankruptcy', 'trade_accepted', 'card_applied', 'season_changed',
    ]);

    const ledger = applyEvents(createLedgerState(), G.events, RULES);
    // '1' paid big rent to '0' (+1), lost the duel to '0' (+2), went bankrupt
    // via '0' (+3) => 6, then the trailing season_changed decays it by 1 => 5.
    const expectedGrudge = 1 + 2 + 3 - RULES.dialogue.decayPerSeason.grudge;
    expect(getAttitude(ledger, '1', '0').grudge).toBe(expectedGrudge);
    // '2' hostile-took-over by '1' => victim grudge +2, then decayed by 1 by the trailing season_changed
    const expectedForceBuyGrudge = Math.max(0, RULES.dialogue.weights.forceBuyVictimGrudge - RULES.dialogue.decayPerSeason.grudge);
    expect(getAttitude(ledger, '2', '1').grudge).toBe(expectedForceBuyGrudge);
    // trade_accepted: '2' (target) <-> '0' (proposer) symmetric trust, then decayed by one season_changed
    const expectedTrust = Math.max(0, RULES.dialogue.weights.tradeAcceptedTrust - RULES.dialogue.decayPerSeason.trust);
    expect(getAttitude(ledger, '2', '0').trust).toBe(expectedTrust);
    expect(getAttitude(ledger, '0', '2').trust).toBe(expectedTrust);

    const digest = buildTurnDigest(G.events, '1', RULES.dialogue.digestWindow);
    expect(digest.rentsPaid).toEqual([{ turn: 1, opponentId: '0', propertyId: 1, amount: 250 }]);
    expect(digest.duelsLost).toEqual([{ turn: 2, opponentId: '0', propertyId: 3, rent: 100 }]);
    expect(digest.wasBankrupted).toEqual([{ turn: 3, creditorId: '0' }]);
    expect(digest.propertiesTakenFrom).toEqual([]); // '1' was the taker here, not the victim
    expect(digest.propertiesTaken).toEqual([{ turn: 5, propertyId: 6, fromId: '2', cost: 80 }]);
  });
});

// ---------------------------------------------------------------------------
// Real-reducer contract tests (review fix wave). The block above drives the
// real logEvent() but with HAND-TYPED data objects — a Game.js payload field
// rename (e.g. ownerId -> landlordId) would sail through it silently. These
// tests drive the REAL Game.js moves (Monopoly.moves.respondDuel, same
// direct-invocation pattern src/__tests__/engine-duel.test.js established)
// so the event payloads are produced by the actual reducer; if Game.js
// renames a field the ledger/digest assertions here fail. Covers the two
// riskiest shapes: duel_resolved (both outcomes — incl. the actor-is-
// ALWAYS-the-challenger quirk, win or lose) and handleBankruptcy's
// trade_cancelled {otherPartyId, reason:'bankruptcy'} variant (the one
// trade_cancelled shape with a DIFFERENT opponent field name).
// ---------------------------------------------------------------------------

describe('real-reducer contract (events produced by actual Game.js moves)', () => {
  function freshEngineG(numPlayers = 2) {
    const ctx = { numPlayers, playOrder: Array.from({ length: numPlayers }, (_, i) => String(i)) };
    const G = Monopoly.setup(ctx);
    G.phase = 'play';
    return G;
  }

  function valForDie(n) {
    return (n - 1) / 6 + 0.01;
  }

  // respondDuel's pinned roll order (Game.js): challenger d1, d2, then
  // defender d1, d2 — same helper shape as engine-duel.test.js.
  function ctxWithDice(currentPlayer, dice) {
    let i = 0;
    const values = dice.length ? dice.map(valForDie) : [0.5];
    return {
      currentPlayer,
      numPlayers: 2,
      random: { Number: () => values[i++ % values.length] },
      events: { endTurn: jest.fn(), setActivePlayers: jest.fn() },
    };
  }

  function statChar(stats) {
    return {
      id: 'test-char', name: 'Test Character', passive: {},
      stats: { capital: 5, luck: 0, negotiation: 5, charisma: 5, tech: 5, stamina: 4, ...stats },
    };
  }

  test('duel_resolved via real respondDuel — challenger WINS: owner (loser) gains grudge toward the challenger despite actor being the challenger', () => {
    const G = freshEngineG();
    G.players[0].character = statChar({ stamina: 10 }); // challenger
    G.players[1].character = statChar({ stamina: 2 });  // owner/defender
    G.duel = { phase: 'response', propertyId: 3, ownerId: '1', challengerId: '0', rent: 8 };
    G.hasRolled = true;
    G.totalTurns = 5;

    const result = Monopoly.moves.respondDuel(G, ctxWithDice('1', [6, 6, 1, 1])); // 22 vs 4
    expect(result).not.toBe(INVALID_MOVE);
    expect(G.events.map(e => e.type)).toEqual(['duel_resolved']); // waived: no rent_paid

    const ledger = applyEvents(createLedgerState(), G.events, RULES);
    // actor on duel_resolved is ALWAYS the challenger ('0'), but the LOSER is
    // the owner ('1') — the ledger must attribute the grudge to the loser,
    // not to the event's actor.
    expect(getAttitude(ledger, '1', '0').grudge).toBe(RULES.dialogue.weights.duelLostGrudge);
    expect(getAttitude(ledger, '0', '1')).toEqual({ grudge: 0, trust: 0 });

    const dOwner = buildTurnDigest(G.events, '1', RULES.dialogue.digestWindow);
    expect(dOwner.duelsLost).toEqual([{ turn: 5, opponentId: '0', propertyId: 3, rent: 8 }]);
    expect(dOwner.duelsWon).toEqual([]);
    const dChallenger = buildTurnDigest(G.events, '0', RULES.dialogue.digestWindow);
    expect(dChallenger.duelsWon).toEqual([{ turn: 5, opponentId: '1', propertyId: 3, rent: 8 }]);
    expect(dChallenger.rentsPaid).toEqual([]); // waived
  });

  test('duel_resolved via real respondDuel — challenger LOSES into bankruptcy with a pending trade: full causal chain (duel_resolved -> rent_paid -> bankruptcy -> trade_cancelled {otherPartyId})', () => {
    const G = freshEngineG();
    G.players[0].character = statChar({ stamina: 1 });  // challenger
    G.players[1].character = statChar({ stamina: 10 }); // owner/defender
    G.players[0].money = 400; // 2x rent(250) = 500 payment -> -100 -> bankrupt
    G.trade = {
      proposerId: '0', targetPlayerId: '1',
      offeredProperties: [], requestedProperties: [], offeredMoney: 0, requestedMoney: 0,
    };
    G.duel = { phase: 'response', propertyId: 3, ownerId: '1', challengerId: '0', rent: 250 };
    G.hasRolled = true;
    G.totalTurns = 7;

    const result = Monopoly.moves.respondDuel(G, ctxWithDice('1', [1, 1, 6, 6])); // 3 vs 22
    expect(result).not.toBe(INVALID_MOVE);
    // The real reducer emits the full chain in this order:
    expect(G.events.map(e => e.type)).toEqual(['duel_resolved', 'rent_paid', 'bankruptcy', 'trade_cancelled']);
    // and the bankruptcy-path trade_cancelled uses the otherPartyId shape
    // (handleBankruptcy, Game.js ~480), NOT cancelTrade's targetPlayerId:
    const cancelled = G.events.find(e => e.type === 'trade_cancelled');
    expect(cancelled.actor).toBe('0');
    expect(cancelled.data).toEqual({ otherPartyId: '1', reason: 'bankruptcy' });

    const ledger = applyEvents(createLedgerState(), G.events, RULES);
    // duel lost (+2) + big rent 500 >= 200 (+1) + bankrupted by '1' (+3) = 6.
    // Stacking magnitude is a config-knob question for owner sign-off (see
    // T1 report concern #5) — this asserts the MECHANISM against real
    // reducer output, with all weights read from RULES.dialogue.
    const w = RULES.dialogue.weights;
    expect(getAttitude(ledger, '0', '1').grudge).toBe(w.duelLostGrudge + w.bigRentGrudge + w.bankruptedByGrudge);
    expect(getAttitude(ledger, '1', '0')).toEqual({ grudge: 0, trust: 0 });

    const dChallenger = buildTurnDigest(G.events, '0', RULES.dialogue.digestWindow);
    expect(dChallenger.duelsLost).toEqual([{ turn: 7, opponentId: '1', propertyId: 3, rent: 250 }]);
    expect(dChallenger.rentsPaid).toEqual([{ turn: 7, opponentId: '1', propertyId: 3, amount: 500 }]);
    expect(dChallenger.wasBankrupted).toEqual([{ turn: 7, creditorId: '1' }]);
    expect(dChallenger.tradesCancelled).toEqual([{ turn: 7, opponentId: '1', reason: 'bankruptcy' }]);

    const dOwner = buildTurnDigest(G.events, '1', RULES.dialogue.digestWindow);
    expect(dOwner.duelsWon).toEqual([{ turn: 7, opponentId: '0', propertyId: 3, rent: 250 }]);
    expect(dOwner.rentsCollected).toEqual([{ turn: 7, opponentId: '0', propertyId: 3, amount: 500 }]);
    expect(dOwner.bankruptciesCaused).toEqual([{ turn: 7, victimId: '0' }]);
    expect(dOwner.tradesCancelled).toEqual([{ turn: 7, opponentId: '0', reason: 'bankruptcy' }]);
  });
});
