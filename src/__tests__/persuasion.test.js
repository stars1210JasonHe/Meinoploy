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
  rollTier, scoreToTier, rentRefundPctForTier, computeRentRefund, duelEffectForTier, tradeShiftForTier,
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
// T1.5 (追回制/refund model): a G.lastRentPayment fixture — the rent seam's
// window predicate (src/persuasion/engine.js canAttempt) no longer touches
// G.duel at all; it opens purely off this record. `turn` defaults to the
// fresh G's own G.totalTurns (0) so canAttempt's same-turn check passes
// out of the box.
function rentPayment(overrides) {
  return { payerSeat: '0', ownerSeat: '1', amount: 100, turn: 0, ...overrides };
}
function withRentPayment(G, overrides) {
  G.lastRentPayment = rentPayment({ turn: G.totalTurns, ...overrides });
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
  // T2 (judge + fallback) — persuasion.judge is already covered by the
  // whole-object equality assertions above (it's a field of the same
  // `persuasion` block), this just pins the new sub-fields explicitly for
  // readability, mirroring the dialogue.weights precedent right above.
  test('persuasion.judge fields present + in sync across all three copies', () => {
    expect(RULES.persuasion.judge).toEqual(DEFAULT_PERSUASION_RULES.judge);
    expect(DominionRules.persuasion.judge).toEqual(DEFAULT_PERSUASION_RULES.judge);
    expect(DEFAULT_RULES.persuasion.judge).toEqual(DEFAULT_PERSUASION_RULES.judge);
    expect(RULES.persuasion.judge.tierBands).toEqual([[0, 4], [5, 7], [8, 10]]);
  });
  // callPriceUSD.judge (character-ai.js judgeCall's price entry) lives
  // under RULES.dialogue, not RULES.persuasion — dialogue-memory.test.js's
  // own "defaults drift guard" already covers full-object equality across
  // its three copies; this just pins the new field for readability here,
  // next to the rest of this task's additions.
  test('dialogue.callPriceUSD.judge present + in sync across all three copies', () => {
    expect(RULES.dialogue.callPriceUSD.judge).toBe(DEFAULT_DIALOGUE_RULES.callPriceUSD.judge);
    expect(DEFAULT_RULES.dialogue.callPriceUSD.judge).toBe(DEFAULT_DIALOGUE_RULES.callPriceUSD.judge);
  });
  // T3 (bot pleas, owner-as-judge) — persuasion.botPlea is already covered
  // by the whole-object equality assertions above (same `persuasion` block);
  // pins the new sub-fields explicitly for readability, same precedent as
  // persuasion.judge right above.
  test('persuasion.botPlea fields present + in sync across all three copies', () => {
    expect(RULES.persuasion.botPlea).toEqual(DEFAULT_PERSUASION_RULES.botPlea);
    expect(DominionRules.persuasion.botPlea).toEqual(DEFAULT_PERSUASION_RULES.botPlea);
    expect(DEFAULT_RULES.persuasion.botPlea).toEqual(DEFAULT_PERSUASION_RULES.botPlea);
    expect(RULES.persuasion.botPlea).toEqual({ enabled: true, probability: 0.35, timeoutSeconds: 12 });
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

describe('scoreToTier — T2 code-side score->tier map', () => {
  test('every score maps to the DEFAULT tierBands exactly (0-4 / 5-7 / 8-10)', () => {
    expect(scoreToTier(0, RULES)).toBe(0);
    expect(scoreToTier(4, RULES)).toBe(0);
    expect(scoreToTier(5, RULES)).toBe(1);
    expect(scoreToTier(7, RULES)).toBe(1);
    expect(scoreToTier(8, RULES)).toBe(2);
    expect(scoreToTier(10, RULES)).toBe(2);
  });

  test('boundaries land on the HIGHER tier, exactly at the cut (4/5 and 7/8)', () => {
    expect(scoreToTier(4, RULES)).toBe(0);
    expect(scoreToTier(5, RULES)).toBe(1);
    expect(scoreToTier(7, RULES)).toBe(1);
    expect(scoreToTier(8, RULES)).toBe(2);
  });

  test('non-finite/negative/out-of-range input never throws, degrades to tier 0', () => {
    expect(() => scoreToTier(NaN, RULES)).not.toThrow();
    expect(scoreToTier(NaN, RULES)).toBe(0);
    expect(scoreToTier(-5, RULES)).toBe(0);
    expect(scoreToTier(undefined, RULES)).toBe(0);
  });

  test('a score ABOVE the top band still resolves to the top tier (defensive, not a throw)', () => {
    expect(scoreToTier(999, RULES)).toBe(2);
  });

  test('a custom tierBands override is honored', () => {
    const custom = resolvePersuasionRules({ persuasion: { judge: { tierBands: [[0, 2], [3, 6], [7, 10]] } } });
    expect(scoreToTier(2, custom)).toBe(0);
    expect(scoreToTier(3, custom)).toBe(1);
    expect(scoreToTier(7, custom)).toBe(2);
  });
});

describe('tier -> effect calculators', () => {
  test('rentRefundPctForTier / computeRentRefund: tiers 0/1/2 under RULES defaults', () => {
    expect(rentRefundPctForTier(0, RULES)).toBe(0);
    expect(rentRefundPctForTier(1, RULES)).toBe(0.10);
    expect(rentRefundPctForTier(2, RULES)).toBe(0.20);
    expect(computeRentRefund(100, 0, RULES)).toBe(0);
    expect(computeRentRefund(100, 1, RULES)).toBe(10);
    expect(computeRentRefund(100, 2, RULES)).toBe(20);
  });

  test('computeRentRefund rounds (not floors) and floors at 0 dollars', () => {
    expect(computeRentRefund(15, 1, RULES)).toBe(2); // 15*0.10=1.5 -> round 2
    expect(computeRentRefund(3, 2, RULES)).toBe(1);  // 3*0.20=0.6 -> round 1
    expect(computeRentRefund(0, 2, RULES)).toBe(0);
    expect(computeRentRefund(-5, 1, RULES)).toBe(0); // never negative
  });

  test('computeRentRefund is NaN-safe', () => {
    expect(computeRentRefund(NaN, 1, RULES)).toBe(0);
  });

  test('computeRentRefund does NOT itself cap against any live balance — that is Game.js\'s job', () => {
    // A refund larger than any plausible balance is still returned uncapped
    // — this pure function has no G to read the owner's current cash from.
    expect(computeRentRefund(1000000, 2, RULES)).toBe(200000);
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
    const G = withRentPayment(freshG());
    const disabledRules = resolvePersuasionRules({ persuasion: { enabled: false } });
    expect(canAttempt(G, {}, 'rent', '0', '1', disabledRules)).toEqual({ ok: false, reason: 'disabled' });
  });

  test('unknown kind -> reason unknown_kind', () => {
    const G = withRentPayment(freshG());
    expect(canAttempt(G, {}, 'bribery', '0', '1', RULES)).toEqual({ ok: false, reason: 'unknown_kind' });
  });

  test('wrong G.phase -> window_closed', () => {
    const G = withRentPayment(freshG());
    G.phase = 'characterSelect';
    expect(canAttempt(G, {}, 'rent', '0', '1', RULES)).toEqual({ ok: false, reason: 'window_closed' });
  });

  test('self-target -> reason self_target', () => {
    const G = withRentPayment(freshG());
    expect(canAttempt(G, {}, 'rent', '0', '0', RULES).reason).toBe('self_target');
  });

  test('missing/bankrupt target -> reason invalid_target', () => {
    const G = withRentPayment(freshG());
    expect(canAttempt(G, {}, 'rent', '0', null, RULES).reason).toBe('invalid_target');
    expect(canAttempt(G, {}, 'rent', '0', '9', RULES).reason).toBe('invalid_target'); // no such seat
    G.players[1].bankrupt = true;
    expect(canAttempt(G, {}, 'rent', '0', '1', RULES).reason).toBe('invalid_target');
  });

  // T1.5 (追回制/refund model): the rent window no longer touches G.duel at
  // all — it opens purely off G.lastRentPayment, uniformly across every mod
  // config (duel enabled or not).
  describe('rent kind window', () => {
    test('no G.lastRentPayment at all -> window_closed', () => {
      const G = freshG();
      expect(canAttempt(G, {}, 'rent', '0', '1', RULES).reason).toBe('window_closed');
    });
    test('a G.lastRentPayment from an EARLIER turn -> window_closed', () => {
      const G = withRentPayment(freshG(), { turn: 0 });
      G.totalTurns = 3; // the payer's turn has since ended (multiple turns later)
      expect(canAttempt(G, {}, 'rent', '0', '1', RULES).reason).toBe('window_closed');
    });
    test('turnPhase is IRRELEVANT to the rent window now (unlike duel/trade)', () => {
      const G = withRentPayment(freshG());
      G.turnPhase = 'roll'; // whatever it happens to be after landing/auto-pay
      expect(canAttempt(G, {}, 'rent', '0', '1', RULES)).toEqual({ ok: true, reason: null });
    });
    test('wrong actor (not the payer) -> wrong_actor', () => {
      const G = withRentPayment(freshG());
      expect(canAttempt(G, {}, 'rent', '2', '1', RULES).reason).toBe('wrong_actor');
    });
    test('wrong target (not the owner) -> wrong_target', () => {
      const G = withRentPayment(freshG());
      expect(canAttempt(G, {}, 'rent', '0', '2', RULES).reason).toBe('wrong_target');
    });
    test('open window, correct actor/target, same turn -> ok', () => {
      const G = withRentPayment(freshG());
      expect(canAttempt(G, {}, 'rent', '0', '1', RULES)).toEqual({ ok: true, reason: null });
    });
    test('a pending G.duel (duel-enabled mod) has NO bearing on the rent window either way', () => {
      const G = withRentPayment(freshG());
      G.duel = { phase: 'response', propertyId: 9, ownerId: '2', challengerId: '2' }; // unrelated, stale-shaped duel
      expect(canAttempt(G, {}, 'rent', '0', '1', RULES)).toEqual({ ok: true, reason: null });
    });
  });

  describe('duel kind window (unchanged from T1 — still G.duel-based)', () => {
    test('G.duel.phase offer (not yet escalated) -> window_closed', () => {
      const G = freshG();
      G.duel = { phase: 'offer', propertyId: 3, ownerId: '1', challengerId: '0', rent: 100 };
      G.turnPhase = 'duel';
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
      const G = withRentPayment(freshG());
      G.persuasion.attempts = recordAttempt(G.persuasion.attempts, 'rent', '0', '1');
      expect(canAttempt(G, {}, 'rent', '0', '1', RULES).reason).toBe('seam_exhausted');
    });
    test('a DIFFERENT kind/target pair is unaffected by another pair being exhausted', () => {
      const G = withRentPayment(freshG());
      G.persuasion.attempts = recordAttempt(G.persuasion.attempts, 'trade', '0', '1');
      expect(canAttempt(G, {}, 'rent', '0', '1', RULES)).toEqual({ ok: true, reason: null });
    });
    test('perOpponentSeamLimit is a REAL configurable count, not just boolean', () => {
      const G = withRentPayment(freshG());
      const looser = resolvePersuasionRules({ persuasion: { perOpponentSeamLimit: 2 } });
      G.persuasion.attempts = recordAttempt(G.persuasion.attempts, 'rent', '0', '1');
      expect(canAttempt(G, {}, 'rent', '0', '1', looser)).toEqual({ ok: true, reason: null }); // 1 < 2, still ok
      G.persuasion.attempts = recordAttempt(G.persuasion.attempts, 'rent', '0', '1');
      expect(canAttempt(G, {}, 'rent', '0', '1', looser).reason).toBe('seam_exhausted'); // 2 >= 2
    });
    test('global cap reached -> global_cap_reached, even on a fresh seam', () => {
      const G = withRentPayment(freshG());
      G.persuasion.globalUsed = { 0: RULES.persuasion.globalCapPerGame };
      expect(canAttempt(G, {}, 'rent', '0', '1', RULES).reason).toBe('global_cap_reached');
    });
    test('below global cap -> ok', () => {
      const G = withRentPayment(freshG());
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

  // T1.5 (追回制/refund model) — G.lastRentPayment.
  describe('G.lastRentPayment', () => {
    test('setup() seeds it to null', () => {
      const G = freshG();
      expect(G.lastRentPayment).toBeNull();
    });

    test('rehydrateSavedG: old save with NO lastRentPayment field at all -> null', () => {
      const G = freshG();
      const savedG = JSON.parse(JSON.stringify(G));
      delete savedG.lastRentPayment;
      expect(rehydrateSavedG(savedG).lastRentPayment).toBeNull();
    });

    test('rehydrateSavedG: a save with lastRentPayment explicitly null -> stays null', () => {
      const G = freshG();
      const savedG = JSON.parse(JSON.stringify(G));
      expect(savedG.lastRentPayment).toBeNull();
      expect(rehydrateSavedG(savedG).lastRentPayment).toBeNull();
    });

    test('rehydrateSavedG: a LIVE lastRentPayment round-trips exactly (JSON-plain, lossless)', () => {
      const G = withRentPayment(freshG(), { payerSeat: '0', ownerSeat: '1', amount: 42, turn: 3 });
      G.totalTurns = 3;
      const savedG = JSON.parse(JSON.stringify(G));
      const rehydrated = rehydrateSavedG(savedG);
      expect(rehydrated.lastRentPayment).toEqual({ payerSeat: '0', ownerSeat: '1', amount: 42, turn: 3 });
      // And the round-tripped window is still genuinely usable — canAttempt
      // agrees the window is open against the rehydrated G.
      expect(canAttempt(rehydrated, {}, 'rent', '0', '1', RULES)).toEqual({ ok: true, reason: null });
    });

    test('rehydrateSavedG: a malformed (non-object) lastRentPayment falls back to null rather than throwing', () => {
      const G = freshG();
      const savedG = JSON.parse(JSON.stringify(G));
      savedG.lastRentPayment = 'not an object';
      expect(() => rehydrateSavedG(savedG)).not.toThrow();
      expect(rehydrateSavedG(savedG).lastRentPayment).toBeNull();
    });
  });
});

// =============================================================================
// Part C — Monopoly.moves.attemptPersuasion (direct invocation)
// =============================================================================

describe('attemptPersuasion — malformed args (blind-dispatch safety)', () => {
  test('no args at all -> INVALID_MOVE, no G mutation, ctx.random never called', () => {
    const G = withRentPayment(freshG());
    const before = JSON.parse(JSON.stringify(G));
    const ctx = makeCtx('0');
    const result = Monopoly.moves.attemptPersuasion(G, ctx);
    expect(result).toBe(INVALID_MOVE);
    expect(JSON.parse(JSON.stringify(G))).toEqual(before);
    expect(ctx._calls.count).toBe(0);
  });

  test('unknown kind -> INVALID_MOVE', () => {
    const G = withRentPayment(freshG());
    expect(Monopoly.moves.attemptPersuasion(G, makeCtx('0'), 'bribery', '1', 'text')).toBe(INVALID_MOVE);
  });

  test('missing targetSeat -> INVALID_MOVE', () => {
    const G = withRentPayment(freshG());
    expect(Monopoly.moves.attemptPersuasion(G, makeCtx('0'), 'rent', undefined, 'text')).toBe(INVALID_MOVE);
    expect(Monopoly.moves.attemptPersuasion(G, makeCtx('0'), 'rent', null, 'text')).toBe(INVALID_MOVE);
  });
});

// T2 (judge + fallback) — the optional 6th `score` arg. Malformed-args
// discipline first (mirrors the kind/targetSeat block right above): a bad
// score is rejected before touching G or ctx.random, exactly like every
// other guard in this move.
describe('attemptPersuasion — score arg validation (T2 judged path, malformed-args-first)', () => {
  test.each([
    ['NaN', NaN],
    ['negative', -1],
    ['above 10', 10.0001],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['a string', '7'],
    ['an object', {}],
    ['a boolean', true],
  ])('score = %s -> INVALID_MOVE, no G mutation, ctx.random never called', (label, badScore) => {
    const G = withRentPayment(freshG());
    const before = JSON.parse(JSON.stringify(G));
    const ctx = makeCtx('0');
    const result = Monopoly.moves.attemptPersuasion(G, ctx, 'rent', '1', 'please', badScore);
    expect(result).toBe(INVALID_MOVE);
    expect(JSON.parse(JSON.stringify(G))).toEqual(before);
    expect(ctx._calls.count).toBe(0);
  });

  test('score = undefined -> the T1 keyless path, unaffected (ctx.random IS called)', () => {
    const G = withRentPayment(freshG());
    const ctx = makeCtx('0', { randomValue: TIER1_R });
    const result = Monopoly.moves.attemptPersuasion(G, ctx, 'rent', '1', 'please', undefined);
    expect(result).not.toBe(INVALID_MOVE);
    expect(ctx._calls.count).toBe(1);
    expect(G.events.find(e => e.type === 'persuasion_resolved').data.score).toBeNull();
  });

  test('score = null -> the T1 keyless path, unaffected (ctx.random IS called)', () => {
    const G = withRentPayment(freshG());
    const ctx = makeCtx('0', { randomValue: TIER1_R });
    const result = Monopoly.moves.attemptPersuasion(G, ctx, 'rent', '1', 'please', null);
    expect(result).not.toBe(INVALID_MOVE);
    expect(ctx._calls.count).toBe(1);
  });

  test('score = 0 (a legitimately awful attempt) is honored, NOT treated as falsy/missing', () => {
    const G = withRentPayment(freshG());
    const ctx = makeCtx('0');
    const result = Monopoly.moves.attemptPersuasion(G, ctx, 'rent', '1', 'please', 0);
    expect(result).not.toBe(INVALID_MOVE);
    expect(ctx._calls.count).toBe(0); // judged path never draws ctx.random
    const resolved = G.events.find(e => e.type === 'persuasion_resolved');
    expect(resolved.data.score).toBe(0);
    expect(resolved.data.tier).toBe(0);
  });

  test('a valid score (0-10 finite) NEVER calls ctx.random.Number() — the judge already supplied it', () => {
    const G = withRentPayment(freshG());
    const ctx = makeCtx('0');
    Monopoly.moves.attemptPersuasion(G, ctx, 'rent', '1', 'please', 7);
    expect(ctx._calls.count).toBe(0);
  });
});

describe('attemptPersuasion — score honored end-to-end (score->tier->effect, every band boundary)', () => {
  test.each([
    [0, 0], [4, 0], // tier 0 band
    [5, 1], [7, 1], // tier 1 band
    [8, 2], [10, 2], // tier 2 band
  ])('score %i -> tier %i, and the rent refund matches that tier exactly', (score, expectedTier) => {
    const G = withRentPayment(freshG(), { amount: 100 });
    const payerBefore = G.players[0].money;
    const ownerBefore = G.players[1].money;
    Monopoly.moves.attemptPersuasion(G, makeCtx('0'), 'rent', '1', 'please', score);
    const resolved = G.events.find(e => e.type === 'persuasion_resolved');
    expect(resolved.data.tier).toBe(expectedTier);
    expect(resolved.data.score).toBe(score);
    const expectedRefund = Math.round(100 * RULES.persuasion.rent.tierRefundPct[expectedTier]);
    expect(G.players[0].money).toBe(payerBefore + expectedRefund);
    expect(G.players[1].money).toBe(ownerBefore - expectedRefund);
  });

  test('the judged path applies the SAME accounting caps as the keyless path (seam exhausted, global cap)', () => {
    const G = withRentPayment(freshG());
    const first = Monopoly.moves.attemptPersuasion(G, makeCtx('0'), 'rent', '1', 'please', 6);
    expect(first).not.toBe(INVALID_MOVE);
    withRentPayment(G);
    const second = Monopoly.moves.attemptPersuasion(G, makeCtx('0'), 'rent', '1', 'again', 6);
    expect(second).toBe(INVALID_MOVE); // seam_exhausted, same as the keyless path
  });

  test('the judged path still routes through canAttempt — window guards apply identically', () => {
    const G = freshG(); // no G.lastRentPayment at all
    expect(Monopoly.moves.attemptPersuasion(G, makeCtx('0'), 'rent', '1', 'x', 9)).toBe(INVALID_MOVE);
  });

  test('duel kind: a judged tier-2 score banks the SAME activeModifier shape as the keyless path', () => {
    const G = withDuelResponse(freshG());
    Monopoly.moves.attemptPersuasion(G, makeCtx('0'), 'duel', '1', 'x', 10);
    expect(G.persuasion.activeModifier).toEqual({
      kind: 'duel', tier: 2, actorSeat: '0', targetSeat: '1', lever: 'targetMinus', amount: 2,
    });
  });

  test('duel kind: a judged tier-0 score applies the SAME engine-mechanical failure cost', () => {
    const G = withDuelResponse(freshG());
    Monopoly.moves.attemptPersuasion(G, makeCtx('0'), 'duel', '1', 'x', 2);
    expect(G.players[0].persuasionDuelPenalty).toBe(RULES.persuasion.duel.failureNextDuelPenalty);
    expect(G.persuasion.activeModifier).toBeNull();
  });

  test('trade kind: a judged tier-1 score applies the SAME threshold shift as the keyless path', () => {
    const G = withTrade(freshG());
    Monopoly.moves.attemptPersuasion(G, makeCtx('0'), 'trade', '1', 'x', 5);
    expect(G.trade.persuasionThresholdShift).toBe(-25);
  });
});

describe('attemptPersuasion — seat authorization', () => {
  test('enforceSeats off (hot-seat): any ctx.playerID accepted', () => {
    const G = withRentPayment(freshG());
    G.enforceSeats = false;
    const ctx = makeCtx('0', { playerID: '9', randomValue: TIER1_R });
    expect(Monopoly.moves.attemptPersuasion(G, ctx, 'rent', '1', 'please')).not.toBe(INVALID_MOVE);
  });

  test('enforceSeats on: ctx.playerID must match ctx.currentPlayer (the actor)', () => {
    const G = withRentPayment(freshG());
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
    const G = withRentPayment(freshG());
    expect(Monopoly.moves.attemptPersuasion(G, makeCtx('0'), 'rent', '1', 'please')).toBe(INVALID_MOVE);
  });
});

describe('attemptPersuasion — window guards route through canAttempt (INVALID_MOVE end-to-end)', () => {
  test('rent kind outside its window -> INVALID_MOVE', () => {
    const G = freshG(); // no G.lastRentPayment at all
    expect(Monopoly.moves.attemptPersuasion(G, makeCtx('0'), 'rent', '1', 'x')).toBe(INVALID_MOVE);
  });
  test('duel kind outside its window (still offer phase) -> INVALID_MOVE', () => {
    const G = freshG();
    G.duel = { phase: 'offer', propertyId: 3, ownerId: '1', challengerId: '0', rent: 100 };
    G.turnPhase = 'duel';
    expect(Monopoly.moves.attemptPersuasion(G, makeCtx('0'), 'duel', '1', 'x')).toBe(INVALID_MOVE);
  });
  test('trade kind outside its window -> INVALID_MOVE', () => {
    const G = freshG(); // no G.trade
    expect(Monopoly.moves.attemptPersuasion(G, makeCtx('0'), 'trade', '1', 'x')).toBe(INVALID_MOVE);
  });
  test('wrong target seat -> INVALID_MOVE, no G mutation', () => {
    const G = withRentPayment(freshG());
    const before = JSON.parse(JSON.stringify(G));
    expect(Monopoly.moves.attemptPersuasion(G, makeCtx('0'), 'rent', '2', 'x')).toBe(INVALID_MOVE);
    expect(JSON.parse(JSON.stringify(G))).toEqual(before);
  });
});

describe('attemptPersuasion — accounting caps enforced end-to-end', () => {
  test('a second attempt at the SAME (kind, actor, target) is rejected (seam exhausted)', () => {
    const G = withRentPayment(freshG());
    const first = Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER0_R }), 'rent', '1', 'please');
    expect(first).not.toBe(INVALID_MOVE);
    // Re-open an identical window (as if paying rent to the same owner AGAIN later, same turn).
    withRentPayment(G);
    const second = Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER1_R }), 'rent', '1', 'again');
    expect(second).toBe(INVALID_MOVE);
  });

  test('global cap (default 3) blocks a 4th attempt across different kinds/targets', () => {
    const G = freshG();
    withRentPayment(G, { payerSeat: '0', ownerSeat: '1' });
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
    const G = withRentPayment(freshG());
    Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER0_R }), 'rent', '1', 'please'); // tier 0
    expect(attemptCount(G.persuasion.attempts, 'rent', '0', '1')).toBe(1);
    expect(globalAttemptCount(G.persuasion.globalUsed, '0')).toBe(1);
  });
});

describe('attemptPersuasion — event payloads', () => {
  test('persuasion_attempted carries {kind, targetSeat, text} and is emitted BEFORE resolution', () => {
    const G = withRentPayment(freshG());
    Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER1_R }), 'rent', '1', '  please, my lord  ');
    const attempted = G.events.filter(e => e.type === 'persuasion_attempted');
    expect(attempted).toHaveLength(1);
    expect(attempted[0].actor).toBe('0');
    expect(attempted[0].data).toEqual({ kind: 'rent', targetSeat: '1', text: 'please, my lord' });
    const resolved = G.events.filter(e => e.type === 'persuasion_resolved');
    expect(attempted[0].seq).toBeLessThan(resolved[0].seq);
  });

  test('text is sanitized (trimmed + capped) before landing on the event', () => {
    const G = withRentPayment(freshG());
    const long = 'z'.repeat(500);
    Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER1_R }), 'rent', '1', long);
    const attempted = G.events.find(e => e.type === 'persuasion_attempted');
    expect(attempted.data.text).toHaveLength(RULES.persuasion.maxTextLength);
  });

  test('persuasion_resolved carries {kind, tier, score: null, actorSeat, targetSeat, effect}', () => {
    const G = withRentPayment(freshG());
    Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER2_R }), 'rent', '1', 'please');
    const resolved = G.events.find(e => e.type === 'persuasion_resolved');
    expect(resolved.actor).toBe('0');
    expect(resolved.data.kind).toBe('rent');
    expect(resolved.data.tier).toBe(2);
    expect(resolved.data.score).toBeNull();
    expect(resolved.data.actorSeat).toBe('0');
    expect(resolved.data.targetSeat).toBe('1');
    expect(resolved.data.effect).toEqual({ type: 'rentRefund', pct: 0.20, originalPaid: 100, refunded: 20 });
  });

  test('an omitted text arg resolves to an empty string, not a crash', () => {
    const G = withRentPayment(freshG());
    expect(() => Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER1_R }), 'rent', '1')).not.toThrow();
    expect(G.events.find(e => e.type === 'persuasion_attempted').data.text).toBe('');
  });
});

// T1.5 (追回制/refund model): rent already transferred payer -> owner in
// full (G.lastRentPayment.amount) BEFORE any of these tests begin — a
// success here refunds owner -> payer, a fraction of that already-paid
// amount, capped at the owner's CURRENT cash.
describe('attemptPersuasion — rent kind effect math (refund model)', () => {
  test('tier 0 (failure): no money moves, effect null', () => {
    const G = withRentPayment(freshG(), { amount: 100 });
    const payerBefore = G.players[0].money;
    const ownerBefore = G.players[1].money;
    Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER0_R }), 'rent', '1', 'x');
    expect(G.players[0].money).toBe(payerBefore);
    expect(G.players[1].money).toBe(ownerBefore);
    const resolved = G.events.find(e => e.type === 'persuasion_resolved');
    expect(resolved.data.tier).toBe(0);
    expect(resolved.data.effect).toBeNull();
  });

  test('tier 1: refunds round(amount * 0.10), owner -> payer', () => {
    const G = withRentPayment(freshG(), { amount: 100 });
    const payerBefore = G.players[0].money;
    const ownerBefore = G.players[1].money;
    Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER1_R }), 'rent', '1', 'x');
    expect(G.players[0].money).toBe(payerBefore + 10);
    expect(G.players[1].money).toBe(ownerBefore - 10);
    const resolved = G.events.find(e => e.type === 'persuasion_resolved');
    expect(resolved.data.effect).toEqual({ type: 'rentRefund', pct: 0.10, originalPaid: 100, refunded: 10 });
  });

  test('tier 2: refunds round(amount * 0.20), owner -> payer', () => {
    const G = withRentPayment(freshG(), { amount: 100 });
    const payerBefore = G.players[0].money;
    const ownerBefore = G.players[1].money;
    Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER2_R }), 'rent', '1', 'x');
    expect(G.players[0].money).toBe(payerBefore + 20);
    expect(G.players[1].money).toBe(ownerBefore - 20);
    const resolved = G.events.find(e => e.type === 'persuasion_resolved');
    expect(resolved.data.effect).toEqual({ type: 'rentRefund', pct: 0.20, originalPaid: 100, refunded: 20 });
  });

  test('exact rounding: round(), not floor (15 * 0.10 = 1.5 -> 2)', () => {
    const G = withRentPayment(freshG(), { amount: 15 });
    Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER1_R }), 'rent', '1', 'x');
    const resolved = G.events.find(e => e.type === 'persuasion_resolved');
    expect(resolved.data.effect.refunded).toBe(2);
  });

  test('refund capped at the owner\'s CURRENT cash — never driven negative', () => {
    const G = withRentPayment(freshG(), { amount: 100 }); // raw tier-2 refund would be 20
    G.players[1].money = 12; // owner has since spent most of it — only 12 left
    Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER2_R }), 'rent', '1', 'x');
    expect(G.players[1].money).toBe(0); // capped, floored at 0 — never negative
    expect(G.players[0].money).toBe(RULES.core.baseStartingMoney + 12); // payer got only what was available
    const resolved = G.events.find(e => e.type === 'persuasion_resolved');
    expect(resolved.data.effect).toEqual({ type: 'rentRefund', pct: 0.20, originalPaid: 100, refunded: 12 });
  });

  test('window closes after the payer\'s endTurn — a later attempt is INVALID_MOVE', () => {
    const G = withRentPayment(freshG());
    G.hasRolled = true; // endTurn's own precondition
    const endResult = Monopoly.moves.endTurn(G, makeCtx('0'));
    expect(endResult).not.toBe(INVALID_MOVE);
    expect(G.lastRentPayment).toBeNull();
    const attemptResult = Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER1_R }), 'rent', '1', 'too late');
    expect(attemptResult).toBe(INVALID_MOVE);
  });

  test('window closes once G.totalTurns advances even WITHOUT an explicit endTurn (belt-and-braces same-turn guard)', () => {
    const G = withRentPayment(freshG(), { turn: 0 });
    G.totalTurns = 1; // simulates a later turn's onBegin having incremented it
    expect(Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER1_R }), 'rent', '1', 'x')).toBe(INVALID_MOVE);
  });

  test('a fresh attempt after the SAME turn\'s SECOND rent payment (to a different owner) targets the LATEST payment only', () => {
    const G = withRentPayment(freshG(), { payerSeat: '0', ownerSeat: '1', amount: 50 });
    withRentPayment(G, { payerSeat: '0', ownerSeat: '2', amount: 200 }); // a second, later payment overwrites it
    // The FIRST (owner 1) payment's window is gone — overwritten, not stacked.
    expect(Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER1_R }), 'rent', '1', 'x')).toBe(INVALID_MOVE);
    // The SECOND (owner 2) payment's window is open.
    expect(Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER1_R }), 'rent', '2', 'x')).not.toBe(INVALID_MOVE);
  });

  test('uniform across mods: the refund window ALSO opens when rent is paid via payRent (duel-enabled path)', () => {
    // payRentAmount is the ONE shared choke point for every rent-shaped
    // transfer — auto-pay-at-landing, payRent (after a duel OFFER is
    // accepted-as-paid), AND declineDuel all route through it, so a
    // duel-enabled mod gets the identical refund window, not a special case.
    const G = freshG();
    G.duel = { phase: 'offer', propertyId: 3, ownerId: '1', challengerId: '0', rent: 100 };
    G.turnPhase = 'duel';
    const result = Monopoly.moves.payRent(G, makeCtx('0'));
    expect(result).not.toBe(INVALID_MOVE);
    expect(G.lastRentPayment).toEqual({ payerSeat: '0', ownerSeat: '1', amount: 100, turn: 0 });
    expect(Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER1_R }), 'rent', '1', 'x')).not.toBe(INVALID_MOVE);
  });

  test('uniform across mods: the refund window ALSO opens when rent is paid via declineDuel', () => {
    const G = freshG();
    G.duel = { phase: 'response', propertyId: 3, ownerId: '1', challengerId: '0', rent: 100 };
    G.turnPhase = 'duel';
    const result = Monopoly.moves.declineDuel(G, makeCtx('1'));
    expect(result).not.toBe(INVALID_MOVE);
    expect(G.lastRentPayment).toEqual({ payerSeat: '0', ownerSeat: '1', amount: 100, turn: 0 });
    expect(Monopoly.moves.attemptPersuasion(G, makeCtx('0', { randomValue: TIER1_R }), 'rent', '1', 'x')).not.toBe(INVALID_MOVE);
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
    const G1 = withRentPayment(freshG(), { amount: 100 });
    const G2 = withRentPayment(freshG(), { amount: 100 });
    Monopoly.moves.attemptPersuasion(G1, makeCtx('0', { randomValue: 0.62 }), 'rent', '1', 'same text');
    Monopoly.moves.attemptPersuasion(G2, makeCtx('0', { randomValue: 0.62 }), 'rent', '1', 'same text');
    const r1 = G1.events.find(e => e.type === 'persuasion_resolved').data;
    const r2 = G2.events.find(e => e.type === 'persuasion_resolved').data;
    expect(r1.tier).toBe(r2.tier);
    expect(r1.effect).toEqual(r2.effect);
    expect(G1.players[0].money).toBe(G2.players[0].money);
  });

  // End-to-end through the REAL seeded boardgame.io PRNG (not a mocked
  // ctx.random) — mirrors engine-duel-seats.test.js's seed-96 fixture
  // (marcus-grayline P0 buys Oriental Ave; sophia-ember P1 lands there next,
  // rent due -> auto-pays atomically at landing, RULES.duel left at its
  // dominion DEFAULT of disabled — the refund window no longer needs the
  // duel mechanism at all, T1.5's whole point). Two FRESH clients on the
  // identical seed + script must reach an identical persuasion outcome.
  describe('real seeded Client', () => {
    function driveToPaymentAndPersuade() {
      const client = makeClient(2, 96);
      client.moves.selectCharacter('marcus-grayline'); // P0, owner
      client.moves.selectCharacter('sophia-ember');     // P1, challenger/payer
      client.moves.rollDice();
      client.moves.buyProperty();
      client.moves.endTurn();
      client.moves.rollDice(); // P1 lands on P0's property -> rent auto-pays
      const preState = client.getState();
      expect(preState.G.lastRentPayment).not.toBeNull();
      client.moves.attemptPersuasion('rent', preState.G.lastRentPayment.ownerSeat, 'have mercy');
      return client.getState().G;
    }

    test('identical seed + script -> byte-identical persuasion outcome across two fresh clients', () => {
      const G1 = driveToPaymentAndPersuade();
      const G2 = driveToPaymentAndPersuade();
      const r1 = G1.events.find(e => e.type === 'persuasion_resolved').data;
      const r2 = G2.events.find(e => e.type === 'persuasion_resolved').data;
      expect(r1.tier).toBe(r2.tier);
      expect(r1.effect).toEqual(r2.effect);
      expect(G1.players[1].money).toBe(G2.players[1].money); // payer's final money
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
  test('G.persuasion.attempts/globalUsed reassignment is visible after the move fully returns', () => {
    const client = makeClient(2, 96);
    client.moves.selectCharacter('marcus-grayline'); // P0, owner
    client.moves.selectCharacter('sophia-ember');     // P1, challenger/payer
    client.moves.rollDice();
    client.moves.buyProperty();
    client.moves.endTurn();
    client.moves.rollDice(); // P1 lands on P0's property -> rent auto-pays
    expect(client.getState().G.lastRentPayment).not.toBeNull();

    client.moves.attemptPersuasion('rent', client.getState().G.lastRentPayment.ownerSeat, 'have mercy');

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

  // Proves the refund window ALSO survives Immer's produce() when reached
  // through the deferred payRent path in a duel-enabled mod (not just the
  // direct-landing auto-pay above) — the same "uniform across mods" claim
  // as the direct-move-invocation tests above, over the REAL reducer.
  test('the refund window opens identically when duel-enabled rent flows through payRent', () => {
    const restore = RULES.duel.enabled;
    RULES.duel.enabled = true;
    try {
      const client = makeClient(2, 96);
      client.moves.selectCharacter('marcus-grayline'); // P0, owner
      client.moves.selectCharacter('sophia-ember');     // P1, challenger/payer
      client.moves.rollDice();
      client.moves.buyProperty();
      client.moves.endTurn();
      client.moves.rollDice(); // P1 lands on P0's property -> duel OFFER (duel enabled)
      expect(client.getState().G.duel.phase).toBe('offer');
      expect(client.getState().G.lastRentPayment).toBeNull(); // not paid yet — still an offer

      client.moves.payRent(); // P1 pays normally instead of dueling
      const G = client.getState().G;
      expect(G.duel).toBeNull();
      expect(G.lastRentPayment).not.toBeNull();
      expect(G.lastRentPayment.payerSeat).toBe('1');
      expect(G.lastRentPayment.ownerSeat).toBe('0');

      const result = client.moves.attemptPersuasion('rent', '0', 'have mercy');
      expect(result).not.toBe('INVALID_MOVE'); // dispatch doesn't throw/no-op
      expect(client.getState().G.events.some(e => e.type === 'persuasion_resolved')).toBe(true);
    } finally {
      RULES.duel.enabled = restore;
    }
  });
});
