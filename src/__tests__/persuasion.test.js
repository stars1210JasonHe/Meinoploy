// src/__tests__/persuasion.test.js — MT2-SP5 direction C2 "舌战群儒", T1.
// Spec: docs/superpowers/specs/2026-07-18-dialogue-c-design.md
// Plan: docs/superpowers/plans/2026-07-21-dialogue-c2-plan.md (task T1)
//
// Covers: the pure core (src/persuasion/engine.js), the ONE engine move
// (Game.js attemptPersuasion), the two consumer seams it feeds
// (respondDuel's duel-modifier consumption, bot-driver.js's trade-threshold
// shift), the dialogue ledger's new failure-cost rule-table row, RULES.
// persuasion's three-copy drift guard, and save/load roundtrip. Driving
// style mirrors engine-duel.test.js: direct `Monopoly.moves.X(G, ctx, ...)`
// invocation against a hand-built G for the controlled matrix, a REAL seeded
// Client (helpers/drive.js) for the end-to-end/determinism/save-load proofs.

import { INVALID_MOVE } from 'boardgame.io/core';
import { Monopoly, rehydrateSavedG, freshPersuasionState } from '../Game';
import { RULES } from '../../mods/active-rules';
import { DEFAULT_RULES } from '../mod-loader';
import { RULES as DominionRules } from '../../mods/dominion/rules';
import { makeClient } from './helpers/drive';
import { decideTradeResponse } from '../bot-driver';
import {
  DEFAULT_PERSUASION_RULES, resolvePersuasionRules, sanitizeText, canAttempt,
  freshAttemptsState, attemptCount, recordAttempt, globalAttemptCount, recordGlobalAttempt,
  rollTier, rentDiscountForTier, applyRentDiscount, duelEffectForTier, tradeShiftForTier,
} from '../persuasion/engine';
import {
  createLedgerState, applyEvent, getAttitude, DEFAULT_DIALOGUE_RULES,
} from '../dialogue/memory';

// --- shared helpers (mirror engine-duel.test.js's own) ---------------------

// ctx.random.Number() -> die face n via Math.floor(x*6)+1 (respondDuel's own
// formula) — same conversion engine-duel.test.js's own valForDie uses.
function valForDie(n) {
  return (n - 1) / 6 + 0.01;
}

function statChar(charisma) {
  return {
    id: 'test-char', name: 'Test Character', passive: {},
    stats: { capital: 5, luck: 4, negotiation: 5, charisma, tech: 5, stamina: 4 },
  };
}

// All seats start with EQUAL charisma (5) by default -> rollTier's `edge` is
// 0 -> deterministic cutpoints under DEFAULT_PERSUASION_RULES: tier2Cut =
// 1 - 0.15 = 0.85, tier1Cut = 0.85 - 0.45 = 0.40. Fixed rng values below rely
// on exactly this.
const TIER0_R = 0.10; // < 0.40
const TIER1_R = 0.50; // in [0.40, 0.85)
const TIER2_R = 0.90; // >= 0.85

function freshG(numPlayers = 3) {
  const ctx = { numPlayers, playOrder: Array.from({ length: numPlayers }, (_, i) => String(i)) };
  const G = Monopoly.setup(ctx);
  G.phase = 'play';
  G.players.forEach(p => { p.character = statChar(5); });
  return G;
}

function makeCtx(currentPlayer, opts = {}) {
  const randomValue = opts.randomValue !== undefined ? opts.randomValue : 0.5;
  const calls = { count: 0 };
  return {
    currentPlayer,
    playerID: opts.playerID !== undefined ? opts.playerID : currentPlayer,
    numPlayers: 3,
    random: { Number: () => { calls.count++; return randomValue; } },
    events: { endTurn: jest.fn(), setActivePlayers: jest.fn() },
    _calls: calls,
  };
}

function offerDuel(overrides) {
  return { phase: 'offer', propertyId: 3, ownerId: '1', challengerId: '0', rent: 100, ...overrides };
}
function responseDuel(overrides) {
  return { phase: 'response', propertyId: 3, ownerId: '1', challengerId: '0', rent: 100, ...overrides };
}
function tradeState(overrides) {
  return {
    proposerId: '0', targetPlayerId: '1',
    offeredProperties: [], requestedProperties: [], offeredMoney: 0, requestedMoney: 0,
    ...overrides,
  };
}

function withDuelOffer(G, overrides) {
  G.duel = offerDuel(overrides);
  G.turnPhase = 'duel';
  return G;
}
function withDuelResponse(G, overrides) {
  G.duel = responseDuel(overrides);
  G.turnPhase = 'duel';
  return G;
}
function withTrade(G, overrides) {
  G.trade = tradeState(overrides);
  G.turnPhase = 'trade';
  return G;
}

// =============================================================================
// Part A — src/persuasion/engine.js pure core
// =============================================================================

describe('resolvePersuasionRules', () => {
  test('null/undefined -> full defaults', () => {
    expect(resolvePersuasionRules(null)).toEqual(DEFAULT_PERSUASION_RULES);
    expect(resolvePersuasionRules(undefined)).toEqual(DEFAULT_PERSUASION_RULES);
  });

  test('a RULES object with no .persuasion key -> full defaults (NaN-hole guard)', () => {
    const rulesLikeAMod = { core: { boardSize: 40 } };
    expect(resolvePersuasionRules(rulesLikeAMod)).toEqual(DEFAULT_PERSUASION_RULES);
  });

  test('a bare RULES.persuasion-shaped object is honored, gaps filled', () => {
    const bare = { globalCapPerGame: 9 };
    const resolved = resolvePersuasionRules(bare);
    expect(resolved.globalCapPerGame).toBe(9);
    expect(resolved.perOpponentSeamLimit).toBe(DEFAULT_PERSUASION_RULES.perOpponentSeamLimit);
    expect(resolved.rent).toEqual(DEFAULT_PERSUASION_RULES.rent);
  });

  test('the full RULES object (with a nested .persuasion) reads .persuasion, not the top level', () => {
    const fullRules = { core: {}, persuasion: { globalCapPerGame: 7 } };
    const resolved = resolvePersuasionRules(fullRules);
    expect(resolved.globalCapPerGame).toBe(7);
    expect(resolved.rent).toEqual(DEFAULT_PERSUASION_RULES.rent);
  });

  test('real mods/dominion RULES.persuasion round-trips unchanged', () => {
    expect(resolvePersuasionRules(RULES)).toEqual(RULES.persuasion);
  });
});

describe('defaults drift guard — three copies stay in sync (mirrors dialogue-memory.test.js)', () => {
  test('mods/dominion/rules.js persuasion block === engine.js DEFAULT_PERSUASION_RULES', () => {
    expect(DominionRules.persuasion).toEqual(DEFAULT_PERSUASION_RULES);
  });
  test('mod-loader DEFAULT_RULES.persuasion === engine.js DEFAULT_PERSUASION_RULES', () => {
    expect(DEFAULT_RULES.persuasion).toEqual(DEFAULT_PERSUASION_RULES);
  });
  test('mod-loader DEFAULT_RULES.persuasion === mods/dominion/rules.js persuasion block', () => {
    expect(DEFAULT_RULES.persuasion).toEqual(DominionRules.persuasion);
  });
  // The live RULES singleton (mods/active-rules.js) shares identity with
  // mods/dominion/rules.js at module load — this pins that the drift-guard
  // covers what the engine actually reads at runtime, not just the source file.
  test('live RULES.persuasion === engine.js DEFAULT_PERSUASION_RULES', () => {
    expect(RULES.persuasion).toEqual(DEFAULT_PERSUASION_RULES);
  });
  // The new dialogue.weights fields (failure-cost magnitudes) ride the SAME
  // three-copy discipline as every other dialogue.weights field — the
  // existing dialogue-memory.test.js "defaults drift guard" describe block
  // already asserts full-object equality across all three dialogue copies,
  // so this just pins the two NEW fields exist and match, for readability.
  test('dialogue.weights persuasion failure-cost fields present + in sync', () => {
    expect(RULES.dialogue.weights.persuasionRentFailGrudge).toBe(DEFAULT_DIALOGUE_RULES.weights.persuasionRentFailGrudge);
    expect(RULES.dialogue.weights.persuasionTradeFailTrust).toBe(DEFAULT_DIALOGUE_RULES.weights.persuasionTradeFailTrust);
    expect(DEFAULT_RULES.dialogue.weights.persuasionRentFailGrudge).toBe(DEFAULT_DIALOGUE_RULES.weights.persuasionRentFailGrudge);
  });
});

describe('sanitizeText', () => {
  test('trims and passes through short text', () => {
    expect(sanitizeText('  hello  ', 200)).toBe('hello');
  });
  test('caps at maxLen', () => {
    const long = 'x'.repeat(300);
    expect(sanitizeText(long, 200)).toHaveLength(200);
  });
  test('non-string -> empty string', () => {
    expect(sanitizeText(undefined, 200)).toBe('');
    expect(sanitizeText(null, 200)).toBe('');
    expect(sanitizeText(42, 200)).toBe('');
    expect(sanitizeText({}, 200)).toBe('');
  });
  test('invalid maxLen falls back to the default (200)', () => {
    const long = 'y'.repeat(250);
    expect(sanitizeText(long, 0)).toHaveLength(200);
    expect(sanitizeText(long, -5)).toHaveLength(200);
    expect(sanitizeText(long, NaN)).toHaveLength(200);
    expect(sanitizeText(long, undefined)).toHaveLength(200);
  });
});

describe('attempt accounting helpers (pure, identity-stable)', () => {
  test('attemptCount: 0 for a fresh/empty state', () => {
    expect(attemptCount(freshAttemptsState(), 'rent', '0', '1')).toBe(0);
    expect(attemptCount(null, 'rent', '0', '1')).toBe(0);
  });

  test('recordAttempt increments the (kind, actor, target) count and is otherwise unaffected', () => {
    let attempts = freshAttemptsState();
    attempts = recordAttempt(attempts, 'rent', '0', '1');
    expect(attemptCount(attempts, 'rent', '0', '1')).toBe(1);
    attempts = recordAttempt(attempts, 'rent', '0', '1');
    expect(attemptCount(attempts, 'rent', '0', '1')).toBe(2);
    // Different kind/actor/target pairs are untouched.
    expect(attemptCount(attempts, 'duel', '0', '1')).toBe(0);
    expect(attemptCount(attempts, 'rent', '1', '0')).toBe(0);
    expect(attemptCount(attempts, 'rent', '0', '2')).toBe(0);
  });

  test('recordAttempt never mutates the input (new object each call)', () => {
    const before = freshAttemptsState();
    const after = recordAttempt(before, 'trade', '0', '1');
    expect(before.trade).toEqual({});
    expect(after).not.toBe(before);
  });

  test('globalAttemptCount / recordGlobalAttempt', () => {
    let globalUsed = {};
    expect(globalAttemptCount(globalUsed, '0')).toBe(0);
    globalUsed = recordGlobalAttempt(globalUsed, '0');
    expect(globalAttemptCount(globalUsed, '0')).toBe(1);
    globalUsed = recordGlobalAttempt(globalUsed, '0');
    globalUsed = recordGlobalAttempt(globalUsed, '1');
    expect(globalAttemptCount(globalUsed, '0')).toBe(2);
    expect(globalAttemptCount(globalUsed, '1')).toBe(1);
  });
});

describe('rollTier — deterministic charisma check', () => {
  test('equal charisma: exact cutpoints from DEFAULT_PERSUASION_RULES', () => {
    expect(rollTier(() => TIER0_R, 5, 5, RULES)).toBe(0);
    expect(rollTier(() => TIER1_R, 5, 5, RULES)).toBe(1);
    expect(rollTier(() => TIER2_R, 5, 5, RULES)).toBe(2);
    // Exact boundary values land on the HIGHER tier (>=, not >).
    expect(rollTier(() => 0.40, 5, 5, RULES)).toBe(1);
    expect(rollTier(() => 0.85, 5, 5, RULES)).toBe(2);
  });

  test('same rng + same stats -> same tier, every time (determinism)', () => {
    const results = Array.from({ length: 5 }, () => rollTier(() => 0.6, 7, 3, RULES));
    expect(new Set(results).size).toBe(1);
  });

  test('higher actor charisma shifts probability mass toward tier 2 (edge clamped)', () => {
    // A huge charisma gap clamps at maxDiffBonus (0.30): edge = +0.30 ->
    // tier2Cut = 1 - (0.15+0.30) = 0.55 (down from 0.85 at parity).
    const r = 0.60; // tier1 at parity (0.60 < 0.85), tier2 once the edge shifts the cut below it
    expect(rollTier(() => r, 5, 5, RULES)).toBe(1);
    expect(rollTier(() => r, 50, 5, RULES)).toBe(2);
  });

  test('lower actor charisma shifts probability mass toward tier 0', () => {
    const r = 0.40; // tier1 at parity (exact tier1Cut)
    expect(rollTier(() => r, 5, 5, RULES)).toBe(1);
    expect(rollTier(() => r, 5, 50, RULES)).toBe(0);
  });

  test('missing rng function falls back to 0.5 rather than throwing', () => {
    expect(() => rollTier(undefined, 5, 5, RULES)).not.toThrow();
  });

  test('non-finite charisma inputs treated as 0 (NaN-hole guard)', () => {
    expect(() => rollTier(() => 0.5, NaN, undefined, RULES)).not.toThrow();
  });
});

describe('tier -> effect calculators', () => {
  test('rentDiscountForTier / applyRentDiscount: tiers 0/1/2 under RULES defaults', () => {
    expect(rentDiscountForTier(0, RULES)).toBe(0);
    expect(rentDiscountForTier(1, RULES)).toBe(0.10);
    expect(rentDiscountForTier(2, RULES)).toBe(0.20);
    expect(applyRentDiscount(100, 0, RULES)).toBe(100);
    expect(applyRentDiscount(100, 1, RULES)).toBe(90);
    expect(applyRentDiscount(100, 2, RULES)).toBe(80);
  });

  test('applyRentDiscount floors at 0 dollars and rounds down to whole dollars', () => {
    expect(applyRentDiscount(3, 2, RULES)).toBe(2); // 3*0.8=2.4 -> floor 2
    expect(applyRentDiscount(0, 2, RULES)).toBe(0);
    expect(applyRentDiscount(-5, 1, RULES)).toBe(0); // never negative
  });

  test('applyRentDiscount is NaN-safe', () => {
    expect(applyRentDiscount(NaN, 1, RULES)).toBe(0);
  });

  test('duelEffectForTier: lever + amount, default targetMinus lever', () => {
    expect(duelEffectForTier(0, RULES)).toEqual({ lever: 'targetMinus', amount: 0 });
    expect(duelEffectForTier(1, RULES)).toEqual({ lever: 'targetMinus', amount: 1 });
    expect(duelEffectForTier(2, RULES)).toEqual({ lever: 'targetMinus', amount: 2 });
  });

  test('duelEffectForTier honors an ownPlus lever override', () => {
    const custom = { persuasion: { duel: { lever: 'ownPlus', tierAmounts: [0, 1, 2] } } };
    expect(duelEffectForTier(1, custom)).toEqual({ lever: 'ownPlus', amount: 1 });
  });

  test('tradeShiftForTier: tiers 0/1/2 under RULES defaults', () => {
    expect(tradeShiftForTier(0, RULES)).toBe(0);
    expect(tradeShiftForTier(1, RULES)).toBe(-25);
    expect(tradeShiftForTier(2, RULES)).toBe(-50);
  });
});

describe('canAttempt — window predicate', () => {
  test('disabled -> reason disabled, before any other check', () => {
    const G = withDuelOffer(freshG());
    const disabledRules = resolvePersuasionRules({ persuasion: { enabled: false } });
    expect(canAttempt(G, {}, 'rent', '0', '1', disabledRules)).toEqual({ ok: false, reason: 'disabled' });
  });

  test('unknown kind -> reason unknown_kind', () => {
    const G = withDuelOffer(freshG());
    expect(canAttempt(G, {}, 'bribery', '0', '1', RULES)).toEqual({ ok: false, reason: 'unknown_kind' });
  });

  test('wrong G.phase -> window_closed', () => {
    const G = withDuelOffer(freshG());
    G.phase = 'characterSelect';
    expect(canAttempt(G, {}, 'rent', '0', '1', RULES)).toEqual({ ok: false, reason: 'window_closed' });
  });

  test('self-target -> reason self_target', () => {
    const G = withDuelOffer(freshG());
    expect(canAttempt(G, {}, 'rent', '0', '0', RULES).reason).toBe('self_target');
  });

  test('missing/bankrupt target -> reason invalid_target', () => {
    const G = withDuelOffer(freshG());
    expect(canAttempt(G, {}, 'rent', '0', null, RULES).reason).toBe('invalid_target');
    expect(canAttempt(G, {}, 'rent', '0', '9', RULES).reason).toBe('invalid_target'); // no such seat
    G.players[1].bankrupt = true;
    expect(canAttempt(G, {}, 'rent', '0', '1', RULES).reason).toBe('invalid_target');
  });

  describe('rent kind window', () => {
    test('no G.duel at all -> window_closed', () => {
      const G = freshG();
      expect(canAttempt(G, {}, 'rent', '0', '1', RULES).reason).toBe('window_closed');
    });
    test('G.duel.phase response (already escalated) -> window_closed', () => {
      const G = withDuelResponse(freshG());
      expect(canAttempt(G, {}, 'rent', '0', '1', RULES).reason).toBe('window_closed');
    });
    test('G.duel offer but turnPhase not duel -> window_closed', () => {
      const G = withDuelOffer(freshG());
      G.turnPhase = 'roll';
      expect(canAttempt(G, {}, 'rent', '0', '1', RULES).reason).toBe('window_closed');
    });
    test('wrong actor (not the challenger) -> wrong_actor', () => {
      const G = withDuelOffer(freshG());
      expect(canAttempt(G, {}, 'rent', '2', '1', RULES).reason).toBe('wrong_actor');
    });
    test('wrong target (not the owner) -> wrong_target', () => {
      const G = withDuelOffer(freshG());
      expect(canAttempt(G, {}, 'rent', '0', '2', RULES).reason).toBe('wrong_target');
    });
    test('open window, correct actor/target -> ok', () => {
      const G = withDuelOffer(freshG());
      expect(canAttempt(G, {}, 'rent', '0', '1', RULES)).toEqual({ ok: true, reason: null });
    });
  });

  describe('duel kind window', () => {
    test('G.duel.phase offer (not yet escalated) -> window_closed', () => {
      const G = withDuelOffer(freshG());
      expect(canAttempt(G, {}, 'duel', '0', '1', RULES).reason).toBe('window_closed');
    });
    test('open response window, correct actor/target -> ok', () => {
      const G = withDuelResponse(freshG());
      expect(canAttempt(G, {}, 'duel', '0', '1', RULES)).toEqual({ ok: true, reason: null });
    });
    test('wrong actor/target rejected same as rent kind', () => {
      const G = withDuelResponse(freshG());
      expect(canAttempt(G, {}, 'duel', '1', '0', RULES).reason).toBe('wrong_actor');
      expect(canAttempt(G, {}, 'duel', '0', '2', RULES).reason).toBe('wrong_target');
    });
  });

  describe('trade kind window', () => {
    test('no G.trade -> window_closed', () => {
      const G = freshG();
      expect(canAttempt(G, {}, 'trade', '0', '1', RULES).reason).toBe('window_closed');
    });
    test('wrong actor (not the proposer) -> wrong_actor', () => {
      const G = withTrade(freshG());
      expect(canAttempt(G, {}, 'trade', '1', '0', RULES).reason).toBe('wrong_actor');
    });
    test('wrong target (not the trade target) -> wrong_target', () => {
      const G = withTrade(freshG());
      expect(canAttempt(G, {}, 'trade', '0', '2', RULES).reason).toBe('wrong_target');
    });
    test('open window, correct actor/target -> ok', () => {
      const G = withTrade(freshG());
      expect(canAttempt(G, {}, 'trade', '0', '1', RULES)).toEqual({ ok: true, reason: null });
    });
  });

  describe('accounting caps', () => {
    test('seam already used (per-opponent-per-seam) -> seam_exhausted', () => {
      const G = withDuelOffer(freshG());
      G.persuasion.attempts = recordAttempt(G.persuasion.attempts, 'rent', '0', '1');
      expect(canAttempt(G, {}, 'rent', '0', '1', RULES).reason).toBe('seam_exhausted');
    });
    test('a DIFFERENT kind/target pair is unaffected by another pair being exhausted', () => {
      const G = withDuelOffer(freshG());
      G.persuasion.attempts = recordAttempt(G.persuasion.attempts, 'trade', '0', '1');
      expect(canAttempt(G, {}, 'rent', '0', '1', RULES)).toEqual({ ok: true, reason: null });
    });
    test('perOpponentSeamLimit is a REAL configurable count, not just boolean', () => {
      const G = withDuelOffer(freshG());
      const looser = resolvePersuasionRules({ persuasion: { perOpponentSeamLimit: 2 } });
      G.persuasion.attempts = recordAttempt(G.persuasion.attempts, 'rent', '0', '1');
      expect(canAttempt(G, {}, 'rent', '0', '1', looser)).toEqual({ ok: true, reason: null }); // 1 < 2, still ok
      G.persuasion.attempts = recordAttempt(G.persuasion.attempts, 'rent', '0', '1');
      expect(canAttempt(G, {}, 'rent', '0', '1', looser).reason).toBe('seam_exhausted'); // 2 >= 2
    });
    test('global cap reached -> global_cap_reached, even on a fresh seam', () => {
      const G = withDuelOffer(freshG());
      G.persuasion.globalUsed = { 0: RULES.persuasion.globalCapPerGame };
      expect(canAttempt(G, {}, 'rent', '0', '1', RULES).reason).toBe('global_cap_reached');
    });
    test('below global cap -> ok', () => {
      const G = withDuelOffer(freshG());
      G.persuasion.globalUsed = { 0: RULES.persuasion.globalCapPerGame - 1 };
      expect(canAttempt(G, {}, 'rent', '0', '1', RULES)).toEqual({ ok: true, reason: null });
    });
  });
});

// =============================================================================
// Part B — G.persuasion state block: setup() + rehydrateSavedG
// =============================================================================

describe('G.persuasion — setup() + save/load', () => {
  test('setup() seeds the fresh envelope shape', () => {
    const G = freshG();
    expect(G.persuasion).toEqual(freshPersuasionState());
    expect(G.persuasion).toEqual({
      attempts: { rent: {}, duel: {}, trade: {} },
      globalUsed: {},
      pending: null,
      activeModifier: null,
    });
  });

  test('every player starts with persuasionDuelPenalty: 0', () => {
    const G = freshG();
    G.players.forEach(p => expect(p.persuasionDuelPenalty).toBe(0));
  });

  test('rehydrateSavedG: old save with NO persuasion field at all -> fresh envelope', () => {
    const G = freshG();
    const savedG = JSON.parse(JSON.stringify(G));
    delete savedG.persuasion;
    delete savedG.players[0].persuasionDuelPenalty;
    delete savedG.players[1].persuasionDuelPenalty;
    const rehydrated = rehydrateSavedG(savedG);
    expect(rehydrated.persuasion).toEqual(freshPersuasionState());
    rehydrated.players.forEach(p => expect(p.persuasionDuelPenalty).toBe(0));
  });

  test('rehydrateSavedG: well-formed persuasion data round-trips exactly (JSON-plain, lossless)', () => {
    const G = withDuelResponse(freshG());
    G.persuasion.attempts = recordAttempt(G.persuasion.attempts, 'rent', '0', '1');
    G.persuasion.globalUsed = recordGlobalAttempt(G.persuasion.globalUsed, '0');
    G.persuasion.activeModifier = { kind: 'duel', tier: 1, actorSeat: '0', targetSeat: '1', lever: 'targetMinus', amount: 1 };
    G.players[0].persuasionDuelPenalty = 2;
    const savedG = JSON.parse(JSON.stringify(G));
    const rehydrated = rehydrateSavedG(savedG);
    expect(rehydrated.persuasion).toEqual(G.persuasion);
    expect(rehydrated.players[0].persuasionDuelPenalty).toBe(2);
  });

  test('rehydrateSavedG: PARTIAL persuasion shape (missing a sub-bucket) is backfilled field-by-field', () => {
    const G = freshG();
    G.persuasion.attempts = recordAttempt(G.persuasion.attempts, 'rent', '0', '1');
    const savedG = JSON.parse(JSON.stringify(G));
    delete savedG.persuasion.attempts.duel; // simulate a malformed/older-partial save
    delete savedG.persuasion.globalUsed;
    const rehydrated = rehydrateSavedG(savedG);
    expect(rehydrated.persuasion.attempts.duel).toEqual({});
    expect(rehydrated.persuasion.attempts.trade).toEqual({});
    expect(rehydrated.persuasion.attempts.rent).toEqual({ 0: { 1: 1 } });
    expect(rehydrated.persuasion.globalUsed).toEqual({});
    expect(rehydrated.persuasion.pending).toBeNull();
    expect(rehydrated.persuasion.activeModifier).toBeNull();
  });

  test('a save from before this wave (missing player.persuasionDuelPenalty) backfills to 0', () => {
    const G = freshG();
    const savedG = JSON.parse(JSON.stringify(G));
    savedG.players.forEach(p => { delete p.persuasionDuelPenalty; });
    const rehydrated = rehydrateSavedG(savedG);
    rehydrated.players.forEach(p => expect(p.persuasionDuelPenalty).toBe(0));
  });
});

// =============================================================================
// Part C — Monopoly.moves.attemptPersuasion (direct invocation)
// =============================================================================

describe('attemptPersuasion — malformed args (blind-dispatch safety)', () => {
  test('no args at all -> INVALID_MOVE, no G mutation, ctx.random never called', () => {
    const G = withDuelOffer(freshG());
    const before = JSON.parse(JSON.stringify(G));
    const ctx = makeCtx('0');
    const result = Monopoly.moves.attemptPersuasion(G, ctx);
    expect(result).toBe(INVALID_MOVE);
    expect(JSON.parse(JSON.stringify(G))).toEqual(before);
    expect(ctx._calls.count).toBe(0);
  });

  test('unknown kind -> INVALID_MOVE', () => {
    const G = withDuelOffer(freshG());
    expect(Monopoly.moves.attemptPersuasion(G, makeCtx('0'), 'bribery', '1', 'text')).toBe(INVALID_MOVE);
  });

  test('missing targetSeat -> INVALID_MOVE', () => {
    const G = withDuelOffer(freshG());
    expect(Monopoly.moves.attemptPersuasion(G, makeCtx('0'), 'rent', undefined, 'text')).toBe(INVALID_MOVE);
    expect(Monopoly.moves.attemptPersuasion(G, makeCtx('0'), 'rent', null, 'text')).toBe(INVALID_MOVE);
  });
});

describe('attemptPersuasion — seat authorization', () => {
  test('enforceSeats off (hot-seat): any ctx.playerID accepted', () => {
    const G = withDuelOffer(freshG());
    G.enforceSeats = false;
    const ctx = makeCtx('0', { playerID: '9', randomValue: TIER1_R });
    expect(Monopoly.moves.attemptPersuasion(G, ctx, 'rent', '1', 'please')).not.toBe(INVALID_MOVE);
  });

  test('enforceSeats on: ctx.playerID must match ctx.currentPlayer (the actor)', () => {
    const G = withDuelOffer(freshG());
    G.enforceSeats = true;
    const wrongSeat = makeCtx('0', { playerID: '1', randomValue: TIER1_R });
    expect(Monopoly.moves.attemptPersuasion(G, wrongSeat, 'rent', '1', 'please')).toBe(INVALID_MOVE);
    const rightSeat = makeCtx('0', { playerID: '0', randomValue: TIER1_R });
    expect(Monopoly.moves.attemptPersuasion(G, rightSeat, 'rent', '1', 'please')).not.toBe(INVALID_MOVE);
  });
});

describe('attemptPersuasion — RULES.persuasion.enabled gate', () => {
  beforeEach(() => { RULES.persuasion.enabled = false; });
  afterEach(() => { RULES.persuasion.enabled = true; });

  test('disabled -> INVALID_MOVE regardless of an otherwise-open window', () => {
    const G = withDuelOffer(freshG());
    expect(Monopoly.moves.attemptPersuasion(G, makeCtx('0'), 'rent', '1', 'please')).toBe(INVALID_MOVE);
  });
});

describe('attemptPersuasion — window guards route through canAttempt (INVALID_MOVE end-to-end)', () => {
  test('rent kind outside its window -> INVALID_MOVE', () => {
    const G = freshG(); // no G.duel at all
    expect(Monopoly.moves.attemptPersuasion(G, makeCtx('0'), 'rent', '1', 'x')).toBe(INVALID_MOVE);
  });
  test('duel kind outside its window (still offer phase) -> INVALID_MOVE', () => {
    const G = withDuelOffer(freshG());
    expect(Monopoly.moves.attemptPersuasion(G, makeCtx('0'), 'duel', '1', 'x')).toBe(INVALID_MOVE);
  });
  test('trade kind outside its window -> INVALID_MOVE', () => {
    const G = freshG(); // no G.trade
    expect(Monopoly.moves.attemptPersuasion(G, makeCtx('0'), 'trade', '1', 'x')).toBe(INVALID_MOVE);
  });
  test('wrong target seat -> INVALID_MOVE, no G mutation', () => {
    const G = withDuelOffer(freshG());
    const before = JSON.parse(JSON.stringify(G));
    expect(Monopoly.moves.attemptPersuasion(G, makeCtx('0'), 'rent', '2', 'x')).toBe(INVALID_MOVE);
    expect(JSON.parse(JSON.stringify(G))).toEqual(before);
  });
});

describe('attemptPersuasion — accounting caps enforced end-to-end', () => {
  test('a second attempt at the SAME (kind, actor, target) is rejected (seam exhausted)', () => {
    const G = withDuelOffer(freshG());
    const first = Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER0_R }), 'rent', '1', 'please');
    expect(first).not.toBe(INVALID_MOVE);
    // Re-open an identical window (as if landing on the same property again later).
    G.duel = offerDuel();
    G.turnPhase = 'duel';
    const second = Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER1_R }), 'rent', '1', 'again');
    expect(second).toBe(INVALID_MOVE);
  });

  test('global cap (default 3) blocks a 4th attempt across different kinds/targets', () => {
    const G = freshG();
    withDuelOffer(G, { challengerId: '0', ownerId: '1' });
    expect(Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER0_R }), 'rent', '1', 'a')).not.toBe(INVALID_MOVE);

    withTrade(G, { proposerId: '0', targetPlayerId: '1' });
    expect(Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER0_R }), 'trade', '1', 'b')).not.toBe(INVALID_MOVE);

    withTrade(G, { proposerId: '0', targetPlayerId: '2' });
    expect(Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER0_R }), 'trade', '2', 'c')).not.toBe(INVALID_MOVE);

    // 4th attempt, a fresh (kind,target) pair — still blocked by the GLOBAL cap.
    withDuelResponse(G, { challengerId: '0', ownerId: '2' });
    const fourth = Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER0_R }), 'duel', '2', 'd');
    expect(fourth).toBe(INVALID_MOVE);
    expect(globalAttemptCount(G.persuasion.globalUsed, '0')).toBe(3);
  });

  test('accounting is consumed on a FAILURE too (not a free reroll)', () => {
    const G = withDuelOffer(freshG());
    Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER0_R }), 'rent', '1', 'please'); // tier 0
    expect(attemptCount(G.persuasion.attempts, 'rent', '0', '1')).toBe(1);
    expect(globalAttemptCount(G.persuasion.globalUsed, '0')).toBe(1);
  });
});

describe('attemptPersuasion — event payloads', () => {
  test('persuasion_attempted carries {kind, targetSeat, text} and is emitted BEFORE resolution', () => {
    const G = withDuelOffer(freshG());
    Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER1_R }), 'rent', '1', '  please, my lord  ');
    const attempted = G.events.filter(e => e.type === 'persuasion_attempted');
    expect(attempted).toHaveLength(1);
    expect(attempted[0].actor).toBe('0');
    expect(attempted[0].data).toEqual({ kind: 'rent', targetSeat: '1', text: 'please, my lord' });
    const resolved = G.events.filter(e => e.type === 'persuasion_resolved');
    expect(attempted[0].seq).toBeLessThan(resolved[0].seq);
  });

  test('text is sanitized (trimmed + capped) before landing on the event', () => {
    const G = withDuelOffer(freshG());
    const long = 'z'.repeat(500);
    Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER1_R }), 'rent', '1', long);
    const attempted = G.events.find(e => e.type === 'persuasion_attempted');
    expect(attempted.data.text).toHaveLength(RULES.persuasion.maxTextLength);
  });

  test('persuasion_resolved carries {kind, tier, score: null, actorSeat, targetSeat, effect}', () => {
    const G = withDuelOffer(freshG());
    Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER2_R }), 'rent', '1', 'please');
    const resolved = G.events.find(e => e.type === 'persuasion_resolved');
    expect(resolved.actor).toBe('0');
    expect(resolved.data.kind).toBe('rent');
    expect(resolved.data.tier).toBe(2);
    expect(resolved.data.score).toBeNull();
    expect(resolved.data.actorSeat).toBe('0');
    expect(resolved.data.targetSeat).toBe('1');
    expect(resolved.data.effect).toEqual({ type: 'rentDiscount', discountPct: 0.20, originalRent: 100, discountedRent: 80 });
  });

  test('an omitted text arg resolves to an empty string, not a crash', () => {
    const G = withDuelOffer(freshG());
    expect(() => Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER1_R }), 'rent', '1')).not.toThrow();
    expect(G.events.find(e => e.type === 'persuasion_attempted').data.text).toBe('');
  });
});

describe('attemptPersuasion — rent kind effect math', () => {
  test('tier 0 (failure): G.duel.rent unchanged, effect null', () => {
    const G = withDuelOffer(freshG(), { rent: 100 });
    Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER0_R }), 'rent', '1', 'x');
    expect(G.duel.rent).toBe(100); // never nulled — payRent/declineDuel still need it
    const resolved = G.events.find(e => e.type === 'persuasion_resolved');
    expect(resolved.data.tier).toBe(0);
    expect(resolved.data.effect).toBeNull();
  });

  test('tier 1: -10% discount, stacks AFTER the already-computed (charisma-discounted) rent', () => {
    const G = withDuelOffer(freshG(), { rent: 100 }); // stands in for a rent already charisma-discounted upstream
    Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER1_R }), 'rent', '1', 'x');
    expect(G.duel.rent).toBe(90);
  });

  test('tier 2: -20% discount', () => {
    const G = withDuelOffer(freshG(), { rent: 100 });
    Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER2_R }), 'rent', '1', 'x');
    expect(G.duel.rent).toBe(80);
  });

  test('floors at 0 dollars for a small rent', () => {
    const G = withDuelOffer(freshG(), { rent: 2 });
    Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER2_R }), 'rent', '1', 'x'); // 2*0.8=1.6 -> floor 1
    expect(G.duel.rent).toBe(1);
    expect(G.duel.rent).toBeGreaterThanOrEqual(0);
  });

  test('the discounted rent actually flows to payRent (real downstream payment)', () => {
    const G = withDuelOffer(freshG(), { rent: 100 });
    Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER2_R }), 'rent', '1', 'x'); // -> 80
    const p0Before = G.players[0].money;
    const p1Before = G.players[1].money;
    const result = Monopoly.moves.payRent(G, makeCtx('0'));
    expect(result).not.toBe(INVALID_MOVE);
    expect(G.players[0].money).toBe(p0Before - 80);
    expect(G.players[1].money).toBe(p1Before + 80);
  });
});

describe('attemptPersuasion — duel kind effect + respondDuel consumption', () => {
  test('tier 0 (failure): stores a next-duel penalty on the actor, no activeModifier', () => {
    const G = withDuelResponse(freshG());
    Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER0_R }), 'duel', '1', 'x');
    expect(G.players[0].persuasionDuelPenalty).toBe(RULES.persuasion.duel.failureNextDuelPenalty);
    expect(G.persuasion.activeModifier).toBeNull();
    const resolved = G.events.find(e => e.type === 'persuasion_resolved');
    expect(resolved.data.effect).toEqual({ type: 'nextDuelPenalty', amount: RULES.persuasion.duel.failureNextDuelPenalty });
  });

  test('tier 1/2 (success): banks an activeModifier (targetMinus lever by default)', () => {
    const G = withDuelResponse(freshG());
    Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER2_R }), 'duel', '1', 'x');
    expect(G.persuasion.activeModifier).toEqual({
      kind: 'duel', tier: 2, actorSeat: '0', targetSeat: '1', lever: 'targetMinus', amount: 2,
    });
    expect(G.players[0].persuasionDuelPenalty).toBe(0);
  });

  test('respondDuel consumes the activeModifier exactly once (targetMinus reduces the defender roll)', () => {
    const G = withDuelResponse(freshG());
    Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER2_R }), 'duel', '1', 'x'); // amount 2, targetMinus
    expect(G.persuasion.activeModifier).not.toBeNull();

    // Fixed dice: challenger 3+4=7 (+stamina4+luckBonus2=13), defender 3+4=7 (+4+2=13) -> tie
    // before the modifier; targetMinus(2) drops the defender to 11 -> challenger wins.
    const dice = [valForDie(3), valForDie(4), valForDie(3), valForDie(4)];
    let i = 0;
    const ctx = { currentPlayer: '1', random: { Number: () => dice[i++] }, events: { setActivePlayers: jest.fn() } };
    const result = Monopoly.moves.respondDuel(G, ctx);
    expect(result).not.toBe(INVALID_MOVE);
    const resolved = G.events.find(e => e.type === 'duel_resolved');
    expect(resolved.data.defenderRoll.total).toBe(13 - 2);
    expect(resolved.data.challengerRoll.total).toBe(13);
    expect(resolved.data.winnerId).toBe('0'); // challenger wins because of the modifier
    expect(G.persuasion.activeModifier).toBeNull(); // consumed
  });

  test('respondDuel honors an ownPlus lever (adds to the challenger roll instead)', () => {
    const G = withDuelResponse(freshG());
    G.persuasion.activeModifier = { kind: 'duel', tier: 1, actorSeat: '0', targetSeat: '1', lever: 'ownPlus', amount: 3 };
    const dice = [valForDie(1), valForDie(1), valForDie(1), valForDie(1)]; // all 1s
    let i = 0;
    const ctx = { currentPlayer: '1', random: { Number: () => dice[i++] }, events: { setActivePlayers: jest.fn() } };
    Monopoly.moves.respondDuel(G, ctx);
    const resolved = G.events.find(e => e.type === 'duel_resolved');
    // challenger: 1+1+stamina4+luckBonus2=8, +3 ownPlus = 11; defender: 1+1+4+2=8 (untouched)
    expect(resolved.data.challengerRoll.total).toBe(11);
    expect(resolved.data.defenderRoll.total).toBe(8);
    expect(G.persuasion.activeModifier).toBeNull();
  });

  test('a modifier from a MISMATCHED duel (different actor/target) is never applied nor cleared', () => {
    const G = withDuelResponse(freshG(), { challengerId: '0', ownerId: '1' });
    G.persuasion.activeModifier = { kind: 'duel', tier: 1, actorSeat: '0', targetSeat: '2', lever: 'targetMinus', amount: 1 }; // stale/foreign
    const dice = [valForDie(3), valForDie(4), valForDie(3), valForDie(4)];
    let i = 0;
    const ctx = { currentPlayer: '1', random: { Number: () => dice[i++] }, events: { setActivePlayers: jest.fn() } };
    Monopoly.moves.respondDuel(G, ctx);
    const resolved = G.events.find(e => e.type === 'duel_resolved');
    expect(resolved.data.challengerRoll.total).toBe(resolved.data.defenderRoll.total); // unaffected -> tie
    expect(G.persuasion.activeModifier).not.toBeNull(); // left alone, not consumed
  });

  test('persuasionDuelPenalty is consumed exactly once (a second duel without a new failure is unaffected)', () => {
    const G = withDuelResponse(freshG());
    G.players[0].persuasionDuelPenalty = 1; // challenger P0 failed a taunt earlier
    const dice = [valForDie(3), valForDie(4), valForDie(3), valForDie(4)];
    let i = 0;
    const ctx1 = { currentPlayer: '1', random: { Number: () => dice[i++] }, events: { setActivePlayers: jest.fn() } };
    Monopoly.moves.respondDuel(G, ctx1);
    const first = G.events.find(e => e.type === 'duel_resolved');
    expect(first.data.challengerRoll.total).toBe(13 - 1); // penalty applied once
    expect(G.players[0].persuasionDuelPenalty).toBe(0);

    // A fresh duel for the SAME player, no new penalty banked -> unaffected this time.
    G.duel = responseDuel({ challengerId: '0', ownerId: '1' });
    let j = 0;
    const ctx2 = { currentPlayer: '1', random: { Number: () => dice[j++] }, events: { setActivePlayers: jest.fn() } };
    Monopoly.moves.respondDuel(G, ctx2);
    const second = G.events.filter(e => e.type === 'duel_resolved')[1];
    expect(second.data.challengerRoll.total).toBe(13); // no penalty this time
  });

  test('respondDuel is UNAFFECTED when G.persuasion.activeModifier is null (backward compatible)', () => {
    const G = withDuelResponse(freshG());
    expect(G.persuasion.activeModifier).toBeNull();
    const dice = [3 / 6 + 0.01, 4 / 6 + 0.01, 1 / 6 + 0.01, 2 / 6 + 0.01];
    let i = 0;
    const ctx = { currentPlayer: '1', random: { Number: () => dice[i++] }, events: { setActivePlayers: jest.fn() } };
    const result = Monopoly.moves.respondDuel(G, ctx);
    expect(result).not.toBe(INVALID_MOVE);
  });
});

describe('attemptPersuasion — trade kind effect + bot-driver.js consumption', () => {
  test('tier 0 (failure): no G.trade mutation, effect null', () => {
    const G = withTrade(freshG());
    Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER0_R }), 'trade', '1', 'x');
    expect(G.trade.persuasionThresholdShift).toBeUndefined();
    const resolved = G.events.find(e => e.type === 'persuasion_resolved');
    expect(resolved.data.effect).toBeNull();
  });

  test('tier 1: threshold shift -25 lands on G.trade', () => {
    const G = withTrade(freshG());
    Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER1_R }), 'trade', '1', 'x');
    expect(G.trade.persuasionThresholdShift).toBe(-25);
  });

  test('tier 2: threshold shift -50 lands on G.trade', () => {
    const G = withTrade(freshG());
    Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER2_R }), 'trade', '1', 'x');
    expect(G.trade.persuasionThresholdShift).toBe(-50);
  });

  test('decideTradeResponse (bot-driver.js): a shift tilts a bot from reject to accept', () => {
    // NOTE: the shift is bounded by the SAME lowerBound = min(baseThreshold, 0)
    // as attitude-trust (resolveEffectiveThreshold, src/bot-driver.js) — with
    // baseThreshold 0 no shift can ever push acceptance below net 0 (the
    // never-accept-a-loss floor, exercised separately below). To see the
    // shift actually MOVE a decision, use a policy with a POSITIVE base
    // threshold and a still-non-negative net: the bot normally wants net >=
    // 30 to accept a net-10 deal (reject); a tier-1 shift (-25) relaxes the
    // effective threshold to 5, which net 10 now clears.
    const policy = { tradeAcceptThreshold: 30 };
    const G = withTrade(freshG(), {
      proposerId: '0', targetPlayerId: '1', offeredMoney: 10, requestedMoney: 0, offeredProperties: [], requestedProperties: [],
    });
    expect(decideTradeResponse(G, '1', policy)).toEqual([['rejectTrade']]); // net 10 < 30
    G.trade.persuasionThresholdShift = -25; // tier 1
    expect(decideTradeResponse(G, '1', policy)).toEqual([['acceptTrade']]); // effective threshold 5, net 10 >= 5
  });

  test('the never-accept-a-strictly-losing-trade floor still holds under a persuasion shift', () => {
    const G = withTrade(freshG(), {
      proposerId: '0', targetPlayerId: '1', offeredMoney: 0, requestedMoney: 1000, offeredProperties: [], requestedProperties: [],
    });
    G.trade.persuasionThresholdShift = -50; // the max tier-2 shift
    expect(decideTradeResponse(G, '1')).toEqual([['rejectTrade']]); // net -1000 still far below any bound
  });

  test('a shift only applies when evaluating the TARGET side, not the proposer', () => {
    const G = withTrade(freshG(), {
      proposerId: '0', targetPlayerId: '1', offeredMoney: 0, requestedMoney: 30, offeredProperties: [], requestedProperties: [],
    });
    G.trade.persuasionThresholdShift = -50;
    // Evaluating for the PROPOSER's own seat: net to proposer = outgoing(0)-incoming... — regardless of the
    // number, the shift must not be applied (actingIsTarget is false for seat '0').
    const withShift = decideTradeResponse(G, '0');
    G.trade.persuasionThresholdShift = 0;
    const withoutShift = decideTradeResponse(G, '0');
    expect(withShift).toEqual(withoutShift);
  });

  test('absent persuasionThresholdShift is byte-identical to pre-T1 behavior (backward compatible)', () => {
    const G = withTrade(freshG(), {
      proposerId: '0', targetPlayerId: '1', offeredMoney: 50, requestedMoney: 0, offeredProperties: [], requestedProperties: [],
    });
    expect(decideTradeResponse(G, '1')).toEqual([['acceptTrade']]);
  });
});

// =============================================================================
// Part D — dialogue ledger reactions (src/dialogue/memory.js)
// =============================================================================

describe('AttitudeLedger.applyEvent — persuasion_resolved', () => {
  function ev(seq, turn, actor, data) {
    return { seq, turn, type: 'persuasion_resolved', actor, data };
  }

  test('rent kind, tier 0: target grudge toward actor increases by persuasionRentFailGrudge', () => {
    const state = createLedgerState();
    const e = ev(0, 1, '0', { kind: 'rent', tier: 0, score: null, actorSeat: '0', targetSeat: '1', effect: null });
    const next = applyEvent(state, e, RULES);
    expect(getAttitude(next, '1', '0')).toEqual({ grudge: RULES.dialogue.weights.persuasionRentFailGrudge, trust: 0 });
    expect(getAttitude(next, '0', '1')).toEqual({ grudge: 0, trust: 0 }); // one-directional
  });

  test('trade kind, tier 0: target trust toward actor DROPS by persuasionTradeFailTrust, floored at 0', () => {
    const state = createLedgerState();
    const e = ev(0, 1, '0', { kind: 'trade', tier: 0, score: null, actorSeat: '0', targetSeat: '1', effect: null });
    const next = applyEvent(state, e, RULES);
    expect(getAttitude(next, '1', '0')).toEqual({ grudge: 0, trust: 0 }); // already at floor, clamped
    // Start from a positive trust value to see the real decrement.
    const withTrust = { 1: { 0: { grudge: 0, trust: 5 } } };
    const after = applyEvent(withTrust, e, RULES);
    expect(getAttitude(after, '1', '0').trust).toBe(5 - RULES.dialogue.weights.persuasionTradeFailTrust);
  });

  test('duel kind, tier 0: NO ledger row (engine-mechanical cost only) — identity-stable no-op', () => {
    const state = createLedgerState();
    const e = ev(0, 1, '0', { kind: 'duel', tier: 0, score: null, actorSeat: '0', targetSeat: '1', effect: { type: 'nextDuelPenalty', amount: 1 } });
    expect(applyEvent(state, e, RULES)).toBe(state);
  });

  test('a SUCCESS (tier > 0) is not wired to the ledger in T1 — identity-stable no-op, every kind', () => {
    const state = createLedgerState();
    for (const kind of ['rent', 'duel', 'trade']) {
      const e = ev(0, 1, '0', { kind, tier: 1, score: null, actorSeat: '0', targetSeat: '1', effect: {} });
      expect(applyEvent(state, e, RULES)).toBe(state);
    }
  });

  test('malformed data (missing actorSeat/targetSeat, or self-target) no-ops rather than throwing', () => {
    const state = createLedgerState();
    expect(applyEvent(state, ev(0, 1, '0', { kind: 'rent', tier: 0, actorSeat: null, targetSeat: '1' }), RULES)).toBe(state);
    expect(applyEvent(state, ev(0, 1, '0', { kind: 'rent', tier: 0, actorSeat: '0', targetSeat: null }), RULES)).toBe(state);
    expect(applyEvent(state, ev(0, 1, '0', { kind: 'rent', tier: 0, actorSeat: '0', targetSeat: '0' }), RULES)).toBe(state);
  });
});

// =============================================================================
// Part E — determinism (same seed -> same outcome), through the REAL reducer
// =============================================================================

describe('determinism — same ctx.random sequence -> same tier/effect', () => {
  test('two independent attemptPersuasion calls with identical mocked randomness produce identical results', () => {
    const G1 = withDuelOffer(freshG(), { rent: 100 });
    const G2 = withDuelOffer(freshG(), { rent: 100 });
    Monopoly.moves.attemptPersuasion(G1, makeCtx('0', { randomValue: 0.62 }), 'rent', '1', 'same text');
    Monopoly.moves.attemptPersuasion(G2, makeCtx('0', { randomValue: 0.62 }), 'rent', '1', 'same text');
    const r1 = G1.events.find(e => e.type === 'persuasion_resolved').data;
    const r2 = G2.events.find(e => e.type === 'persuasion_resolved').data;
    expect(r1.tier).toBe(r2.tier);
    expect(r1.effect).toEqual(r2.effect);
    expect(G1.duel.rent).toBe(G2.duel.rent);
  });

  // End-to-end through the REAL seeded boardgame.io PRNG (not a mocked
  // ctx.random) — mirrors engine-duel-seats.test.js's seed-96 fixture
  // (marcus-grayline P0 buys Oriental Ave; sophia-ember P1 lands there next,
  // rent due -> a duel OFFER when RULES.duel.enabled). Two FRESH clients on
  // the identical seed + script must reach an identical persuasion outcome.
  describe('real seeded Client', () => {
    beforeEach(() => { RULES.duel.enabled = true; });
    afterEach(() => { RULES.duel.enabled = false; });

    function driveToOfferAndPersuade() {
      const client = makeClient(2, 96);
      client.moves.selectCharacter('marcus-grayline'); // P0, owner
      client.moves.selectCharacter('sophia-ember');     // P1, challenger
      client.moves.rollDice();
      client.moves.buyProperty();
      client.moves.endTurn();
      client.moves.rollDice(); // P1 lands on P0's property -> duel OFFER
      const preState = client.getState();
      expect(preState.G.duel).not.toBeNull();
      expect(preState.G.duel.phase).toBe('offer');
      client.moves.attemptPersuasion('rent', preState.G.duel.ownerId, 'have mercy');
      return client.getState().G;
    }

    test('identical seed + script -> byte-identical persuasion outcome across two fresh clients', () => {
      const G1 = driveToOfferAndPersuade();
      const G2 = driveToOfferAndPersuade();
      const r1 = G1.events.find(e => e.type === 'persuasion_resolved').data;
      const r2 = G2.events.find(e => e.type === 'persuasion_resolved').data;
      expect(r1.tier).toBe(r2.tier);
      expect(r1.effect).toEqual(r2.effect);
      expect(G1.duel.rent).toBe(G2.duel.rent);
    });
  });
});

// =============================================================================
// Part F — G.persuasion accounting survives Immer's produce() wrapping
// =============================================================================

// attemptPersuasion reassigns G.persuasion.attempts/globalUsed to brand-new
// plain objects (recordAttempt/recordGlobalAttempt are pure, immutable-style
// — see src/persuasion/engine.js) rather than mutating them in place. Proving
// that survives Immer's produce() (not just a hand-mutated G, same concern
// engine-duel.test.js's Task 3 landing-interception test calls out for
// G.turnPhase) needs the REAL boardgame.io Client, not direct move invocation.
describe('attemptPersuasion — accounting survives the REAL Client/Immer path', () => {
  beforeEach(() => { RULES.duel.enabled = true; });
  afterEach(() => { RULES.duel.enabled = false; });

  test('G.persuasion.attempts/globalUsed reassignment is visible after the move fully returns', () => {
    const client = makeClient(2, 96);
    client.moves.selectCharacter('marcus-grayline'); // P0, owner
    client.moves.selectCharacter('sophia-ember');     // P1, challenger
    client.moves.rollDice();
    client.moves.buyProperty();
    client.moves.endTurn();
    client.moves.rollDice(); // P1 lands on P0's property -> duel OFFER
    expect(client.getState().G.duel.phase).toBe('offer');

    client.moves.attemptPersuasion('rent', client.getState().G.duel.ownerId, 'have mercy');

    const G = client.getState().G;
    expect(attemptCount(G.persuasion.attempts, 'rent', '1', '0')).toBe(1);
    expect(globalAttemptCount(G.persuasion.globalUsed, '1')).toBe(1);
    expect(G.events.some(e => e.type === 'persuasion_resolved')).toBe(true);

    // A second attempt at the SAME (kind, actor, target) is rejected — the
    // dispatched move must be a genuine INVALID_MOVE no-op through the real
    // reducer (state byte-identical before/after).
    const before = JSON.stringify(client.getState().G);
    client.moves.attemptPersuasion('rent', '0', 'again');
    expect(JSON.stringify(client.getState().G)).toBe(before);
  });
});
