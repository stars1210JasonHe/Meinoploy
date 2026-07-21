// src/persuasion/engine.js — pure core for MT2-SP5 direction C2 "舌战群儒"
// (dialogue produces small, bounded, rate-limited gameplay modifiers). Spec:
// docs/superpowers/specs/2026-07-18-dialogue-c-design.md
// Plan: docs/superpowers/plans/2026-07-21-dialogue-c2-plan.md (task T1)
//
// Zero boardgame.io imports (mirrors src/dialogue/memory.js's own "pure
// core" discipline) — G/ctx are accepted as plain parameters, never as the
// `boardgame.io/core` module itself. Every function here is a CALCULATOR:
// given a state fragment (or a plain description of one), it returns a
// verdict or a new value. It never mutates G — src/Game.js's attemptPersuasion
// move (an Immer draft, like every other move in that file) is the ONLY
// place G is actually written, exactly the same division of labor
// calculateRent (pure) / payRentAmount (mutates G) already established.
//
// Three anti-abuse pillars this module implements (see the design doc's
// "threat model" section):
//   1. Attempt accounting — once per (kind, actor, target) + a global
//      per-actor cap per game. Both RULES.persuasion-configurable.
//   2. A code-side tier table — the keyless charisma check (and, later, T2's
//      LLM judge score) never picks an effect directly; it only ever
//      produces a tier index (0/1/2), and RULES.persuasion.<kind> maps tier
//      -> a bounded numeric effect. A compromised judge can at worst
//      mis-score, never mis-effect.
//   3. Deterministic RNG — rollTier takes an injected `rng` (Game.js passes
//      `() => ctx.random.Number()`), NEVER Math.random, so outcomes replay
//      identically for a given seed (sim fairness gates, T4, depend on this).

import { deepMerge } from '../mod-loader';

export const ATTEMPT_KINDS = ['rent', 'duel', 'trade'];

// ---------------------------------------------------------------------------
// RULES.persuasion — three-layer default (this module's own copy is the
// THIRD independent fallback layer, same precedent as
// src/dialogue/memory.js's DEFAULT_DIALOGUE_RULES; the other two copies are
// mods/dominion/rules.js's `persuasion` block and src/mod-loader.js's
// DEFAULT_RULES.persuasion — a drift-guard test (persuasion.test.js) asserts
// all three stay byte-identical, mirroring dialogue-memory.test.js's own
// "defaults drift guard" describe block).
// ---------------------------------------------------------------------------

export const DEFAULT_PERSUASION_RULES = {
  enabled: true,
  // Player-supplied flavor text is capped to this length before it is ever
  // logged onto an event (sanitizeText below). T1 never judges the text
  // itself (that's T2's LLM judge, inside a fenced data block) — the cap
  // exists purely so a malicious/huge string can't bloat G.events.
  maxTextLength: 200,
  // Accounting caps (design doc "Economic bounds"): once per (kind, actor,
  // target) for the whole game, PLUS a global per-actor cap across every
  // kind/target combined — attempts are not free rerolls; both consume the
  // cap regardless of whether the attempt succeeds or fails.
  perOpponentSeamLimit: 1,
  globalCapPerGame: 3,
  // Keyless fallback curve (T1's ONLY resolution path — T2 adds the LLM
  // judge alongside this, same caps/tiers either way per the design doc's
  // "fairness without a key" pillar). A single ctx.random.Number() draw `r`
  // in [0,1) is compared against two cutpoints derived from an "edge" —
  // (persuader charisma - target charisma), clamped and scaled — so a more
  // charismatic persuader (relative to their target) shifts probability mass
  // toward the higher tiers without ever exceeding the RULES-capped ceiling.
  charismaCheck: {
    baseTier1Chance: 0.45,
    baseTier2Chance: 0.15,
    perPointDiffBonus: 0.02,
    maxDiffBonus: 0.30,
  },
  // 求情 (rent mercy) — T1.5 REFUND model (追回制, owner decision superseding
  // T1's pre-payment discount): rent transfers atomically at landing, in
  // EVERY mod, exactly as before this feature ever existed; the payer then
  // has the rest of THEIR turn to ask the owner to refund a fraction of what
  // was already paid. tierRefundPct is that fraction, indexed by tier (index
  // 0 unused — tier 0 is the failure branch, no refund).
  rent: {
    tierRefundPct: [0, 0.10, 0.20],
  },
  // 叫阵 (duel taunt): a this-duel-only dice adjustment, indexed by tier.
  // `lever` picks ONE side to move (design brief: "pick ONE lever") —
  // 'targetMinus' (default) subtracts from the TARGET's (the property
  // owner's) roll total; 'ownPlus' would add to the actor's own roll
  // instead. failureNextDuelPenalty is the engine-mechanical failure cost
  // (a next-duel dice debuff on the actor themselves), consumed once by
  // whichever duel they're next in.
  duel: {
    lever: 'targetMinus',
    tierAmounts: [0, 1, 2],
    failureNextDuelPenalty: 1,
  },
  // 游说 (trade lobby): a shift applied to the TARGET's bot acceptance
  // threshold for the current G.trade proposal, indexed by tier (negative =
  // easier to accept). Vs a human target this rides G.trade as pure flavor
  // (T3 can surface it; nothing forces a human's decision).
  trade: {
    tierShifts: [0, -25, -50],
  },
  // T2 (MT2-SP5 direction C2, judge + fallback) — the OPTIONAL judged-score
  // path. attemptPersuasion's 6th arg (`score`) is undefined/null on the
  // T1 keyless path (unchanged, this block is unread then); when a caller
  // supplies a finite 0-10 score (src/persuasion/judge.js's client-side LLM
  // judge, or a future non-LLM scorer), scoreToTier below maps it to the
  // SAME tier 0/1/2 the keyless dice-like check already produces — every
  // downstream consumer (effect math, accounting, failure costs) is tier-
  // only and cannot tell which path produced it. Consumed by BOTH this
  // engine (scoreToTier, server/engine-side — "tier mapping is code-side"
  // per the design doc's anti-injection pillar) AND src/persuasion/judge.js
  // (clampScore reads the SAME tierBands to find "the highest score still
  // inside a tier's band" — one table, two readers, never two numbers that
  // could drift apart).
  judge: {
    // [minScore, maxScore] inclusive, one pair per tier index. A score
    // lands in the tier whose band it falls in; scoreToTier walks tiers
    // HIGH-to-low and returns the first whose band[0] <= score, so gaps or
    // a truncated/malformed override degrade to tier 0 rather than
    // throwing. Design doc's own table, verbatim: specs/2026-07-18-
    // dialogue-c-design.md's C2 section ("判定: score 7 ... tier 1").
    tierBands: [[0, 4], [5, 7], [8, 10]],
    // Attitude clamp (design doc "Prompt injection" pillar #1: "Score is
    // CLAMPED by attitude ... at 宿怨▲▲▲ the best possible outcome is
    // capped low regardless of eloquence"). Thresholds are RAW grudge
    // values (ledger range 0-RULES.dialogue.caps.grudge, default cap 10) —
    // calibrated directly off RULES.dialogue.attitudeDisplay.grudgeTiers
    // ([3, 6, 9], the SAME thresholds that already draw a player's ▲/▲▲/▲▲▲
    // grudge chip, MT2-SP4 direction B) so "the number a player can already
    // see on the target" is the number that governs the ceiling — but
    // deliberately engages ONE tier later than the first glyph: a single ▲
    // (mild irritation, grudge 3-5) does not yet clamp anything; only once
    // grudge crosses the ▲▲ ("hostile") threshold does eloquence stop being
    // enough to reach tier 2, and only past ▲▲▲ ("hatred") does it stop
    // being enough to reach tier 1 either. See src/persuasion/judge.js's
    // clampScore for the exact algorithm (owner decision item, this task's
    // T2 brief) — trust is intentionally NOT a field here: high trust never
    // RAISES the achievable tier past its natural ceiling, it only ever
    // refrains from clamping (i.e. contributes nothing either way), a
    // deliberate design choice pinned by that module's own test suite.
    clamp: {
      grudgeHostileThreshold: 6, // >= this (▲▲) -> max achievable tier 1
      grudgeHatredThreshold: 9,  // >= this (▲▲▲) -> max achievable tier 0
    },
    // Client-side judge call timeout (ms, src/persuasion/judge.js's
    // judgePersuasion) — a slow/hung LLM call is treated exactly like any
    // other soft failure (bad JSON, no key): the orchestrator returns null,
    // the caller dispatches attemptPersuasion with NO score, and the SAME
    // keyless charisma check resolves the attempt. No engine-side meaning
    // whatsoever (the move itself has no concept of "pending" or "timeout"
    // — see this task's report for why that's safe).
    timeoutMs: 8000,
  },
};

const PERSUASION_RULE_KEYS = Object.keys(DEFAULT_PERSUASION_RULES);

// Accepts: the full RULES object (reads .persuasion off it), a
// RULES.persuasion-shaped (or partial) object directly, an unrelated/empty
// object, or null/undefined. Always returns a fully-populated persuasion
// rules object — mirrors src/dialogue/memory.js's resolveDialogueRules
// exactly (same NaN-hole discipline: every field defaulted, twice over).
export function resolvePersuasionRules(rulesLike) {
  if (!rulesLike || typeof rulesLike !== 'object') return deepMerge({}, DEFAULT_PERSUASION_RULES);
  if (rulesLike.persuasion && typeof rulesLike.persuasion === 'object') {
    return deepMerge(rulesLike.persuasion, DEFAULT_PERSUASION_RULES);
  }
  const looksShaped = PERSUASION_RULE_KEYS.some(k => Object.prototype.hasOwnProperty.call(rulesLike, k));
  return deepMerge(looksShaped ? rulesLike : {}, DEFAULT_PERSUASION_RULES);
}

function clamp(value, lo, hi) {
  if (!Number.isFinite(value)) return lo; // NaN-hole guard
  return Math.min(hi, Math.max(lo, value));
}

// ---------------------------------------------------------------------------
// Text sanitization (brief: "the text arg is ACCEPTED and carries on the
// emitted event ... but does NOT influence the keyless outcome" — T2's judge
// is the first consumer that actually reads it, inside a fenced data block).
// ---------------------------------------------------------------------------

export function sanitizeText(text, maxLen) {
  const limit = Number.isFinite(maxLen) && maxLen > 0 ? maxLen : DEFAULT_PERSUASION_RULES.maxTextLength;
  if (typeof text !== 'string') return '';
  return text.trim().slice(0, limit);
}

// ---------------------------------------------------------------------------
// Attempt accounting over G.persuasion's own fragments. G.persuasion.attempts
// is { rent: {[actorSeat]: {[targetSeat]: count}}, duel: {...}, trade: {...} }
// (a COUNT per pair, not a boolean — see attemptCount below);
// G.persuasion.globalUsed is { [actorSeat]: count }.
// ---------------------------------------------------------------------------

export function freshAttemptsState() {
  return { rent: {}, duel: {}, trade: {} };
}

// Count-based (not boolean) so RULES.persuasion.perOpponentSeamLimit is a
// REAL configurable limit, not just an on/off flag — the default (1) means
// "once per game" exactly as the design doc specifies, but a mod that wants
// e.g. 2 attempts per opponent per seam only has to change this one number.
export function attemptCount(attempts, kind, actorSeat, targetSeat) {
  const bucket = attempts && attempts[kind] && attempts[kind][actorSeat];
  const n = bucket && bucket[targetSeat];
  return Number.isFinite(n) ? n : 0;
}

export function recordAttempt(attempts, kind, actorSeat, targetSeat) {
  const state = attempts || freshAttemptsState();
  const kindBucket = state[kind] || {};
  const actorBucket = kindBucket[actorSeat] || {};
  const current = Number.isFinite(actorBucket[targetSeat]) ? actorBucket[targetSeat] : 0;
  return {
    ...state,
    [kind]: {
      ...kindBucket,
      [actorSeat]: { ...actorBucket, [targetSeat]: current + 1 },
    },
  };
}

export function globalAttemptCount(globalUsed, actorSeat) {
  return (globalUsed && globalUsed[actorSeat]) || 0;
}

export function recordGlobalAttempt(globalUsed, actorSeat) {
  const state = globalUsed || {};
  const next = (Number.isFinite(state[actorSeat]) ? state[actorSeat] : 0) + 1;
  return { ...state, [actorSeat]: next };
}

// ---------------------------------------------------------------------------
// canAttempt — the window predicate. Returns { ok: true } or
// { ok: false, reason: <code> }; NEVER throws on malformed input (an
// external/MCP caller can send arbitrary shapes). Structural window checks
// are keyed off the SAME G fields the real seams already use (G.duel/
// G.trade/G.turnPhase) rather than a parallel state machine, so this can
// never drift out of sync with when those seams actually open/close.
// ---------------------------------------------------------------------------

export function canAttempt(G, ctx, kind, actorSeat, targetSeat, rulesLike) {
  const rules = resolvePersuasionRules(rulesLike);
  if (!rules.enabled) return { ok: false, reason: 'disabled' };
  if (!ATTEMPT_KINDS.includes(kind)) return { ok: false, reason: 'unknown_kind' };
  if (!G || G.phase !== 'play') return { ok: false, reason: 'window_closed' };
  if (actorSeat == null || targetSeat == null) return { ok: false, reason: 'invalid_target' };
  if (String(actorSeat) === String(targetSeat)) return { ok: false, reason: 'self_target' };

  const targetPlayer = G.players && G.players[targetSeat];
  if (!targetPlayer || targetPlayer.bankrupt) return { ok: false, reason: 'invalid_target' };

  if (kind === 'rent') {
    // T1.5 (追回制/refund model, owner decision — supersedes T1's
    // pre-payment discount): rent already transferred atomically at
    // landing, in every mod uniformly (payRentAmount, unconditionally, no
    // duel-enabled special case) — this window is "ask for a refund of what
    // you already paid, for the rest of THIS turn". G.lastRentPayment is
    // set/overwritten by every payRentAmount call (src/Game.js); `turn`
    // pins it to the SAME G.totalTurns the payment happened on, so it
    // closes automatically once the payer's turn ends (endTurn also clears
    // it explicitly — see Game.js's own comment there).
    const lrp = G.lastRentPayment;
    if (!lrp || lrp.turn !== G.totalTurns) return { ok: false, reason: 'window_closed' };
    if (String(lrp.payerSeat) !== String(actorSeat)) return { ok: false, reason: 'wrong_actor' };
    if (String(lrp.ownerSeat) !== String(targetSeat)) return { ok: false, reason: 'wrong_target' };
  } else if (kind === 'duel') {
    if (!G.duel || G.duel.phase !== 'response' || G.turnPhase !== 'duel') return { ok: false, reason: 'window_closed' };
    if (String(G.duel.challengerId) !== String(actorSeat)) return { ok: false, reason: 'wrong_actor' };
    if (String(G.duel.ownerId) !== String(targetSeat)) return { ok: false, reason: 'wrong_target' };
  } else if (kind === 'trade') {
    if (!G.trade || G.turnPhase !== 'trade') return { ok: false, reason: 'window_closed' };
    if (String(G.trade.proposerId) !== String(actorSeat)) return { ok: false, reason: 'wrong_actor' };
    if (String(G.trade.targetPlayerId) !== String(targetSeat)) return { ok: false, reason: 'wrong_target' };
  }

  const persuasion = G.persuasion || {};
  if (attemptCount(persuasion.attempts, kind, actorSeat, targetSeat) >= rules.perOpponentSeamLimit) {
    return { ok: false, reason: 'seam_exhausted' };
  }
  if (globalAttemptCount(persuasion.globalUsed, actorSeat) >= rules.globalCapPerGame) {
    return { ok: false, reason: 'global_cap_reached' };
  }

  return { ok: true, reason: null };
}

// ---------------------------------------------------------------------------
// Keyless resolution — a deterministic charisma check. ONE rng() draw per
// attempt (same call-count discipline as respondDuel's pinned dice order) so
// "same seed -> same outcome" holds trivially. `rng` must return a value in
// [0, 1) — Game.js passes `() => ctx.random.Number()`, NEVER Math.random.
// ---------------------------------------------------------------------------

export function rollTier(rng, actorCharisma, targetCharisma, rulesLike) {
  const rules = resolvePersuasionRules(rulesLike);
  const cc = rules.charismaCheck;
  const diff = (Number.isFinite(actorCharisma) ? actorCharisma : 0) - (Number.isFinite(targetCharisma) ? targetCharisma : 0);
  const edge = clamp(diff * cc.perPointDiffBonus, -cc.maxDiffBonus, cc.maxDiffBonus);
  const tier2Chance = clamp(cc.baseTier2Chance + edge, 0, 1);
  const tier1ChanceRaw = clamp(cc.baseTier1Chance + edge, 0, 1);
  const tier2Cut = clamp(1 - tier2Chance, 0, 1);
  const tier1Cut = clamp(tier2Cut - tier1ChanceRaw, 0, tier2Cut);
  const r = typeof rng === 'function' ? rng() : 0.5;
  if (r >= tier2Cut) return 2;
  if (r >= tier1Cut) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// T2 — score -> tier mapping (the CODE-SIDE half of the anti-injection
// pillar: the LLM judge only ever produces a 0-10 score; this function,
// never the judge, decides which tier that becomes). Walks tiers HIGH to
// low and returns the first whose band lower-bound the score clears, so a
// score sitting in a gap between bands (a malformed override) still lands
// on a definite, defensible tier rather than falling through to undefined.
// Out-of-range/non-finite scores are Game.js's job to reject BEFORE this is
// ever called (attemptPersuasion's malformed-args guard) — this function
// itself still degrades to tier 0 rather than throwing, for any caller
// (tests, a future non-move consumer) that invokes it directly.
// ---------------------------------------------------------------------------

export function scoreToTier(score, rulesLike) {
  const rules = resolvePersuasionRules(rulesLike);
  const judgeRules = (rules.judge && typeof rules.judge === 'object') ? rules.judge : DEFAULT_PERSUASION_RULES.judge;
  const bands = Array.isArray(judgeRules.tierBands) && judgeRules.tierBands.length
    ? judgeRules.tierBands : DEFAULT_PERSUASION_RULES.judge.tierBands;
  const s = Number.isFinite(score) ? score : 0;
  for (let tier = bands.length - 1; tier >= 0; tier--) {
    const band = bands[tier];
    if (Array.isArray(band) && Number.isFinite(band[0]) && s >= band[0]) return tier;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Tier -> effect calculators (pure; Game.js applies the returned numbers to
// G itself). Each is defensive against an out-of-range tier (falls back to
// the tier-0/no-effect value) so a future score-driven tier (T2) can never
// index out of bounds into a malformed/partial RULES override.
// ---------------------------------------------------------------------------

export function rentRefundPctForTier(tier, rulesLike) {
  const rules = resolvePersuasionRules(rulesLike);
  const arr = rules.rent.tierRefundPct;
  return Number.isFinite(arr[tier]) ? arr[tier] : 0;
}

// T1.5: raw refund owed on `originalPaid` (G.lastRentPayment.amount) at this
// tier — round() per the owner's spec (NOT floor, unlike the old discount
// math), floored at 0 dollars as a defensive lower bound (originalPaid/pct
// are both always >= 0 in practice, so this is belt-and-braces). This is the
// UNCAPPED figure — Game.js's attemptPersuasion additionally caps it against
// the owner's CURRENT cash (which may have dropped since the rent was paid)
// before actually moving any money; this pure function has no access to
// live G state to apply that cap itself.
export function computeRentRefund(originalPaid, tier, rulesLike) {
  const pct = rentRefundPctForTier(tier, rulesLike);
  const raw = Math.round((Number.isFinite(originalPaid) ? originalPaid : 0) * pct);
  return Math.max(0, raw);
}

export function duelEffectForTier(tier, rulesLike) {
  const rules = resolvePersuasionRules(rulesLike);
  const amount = Number.isFinite(rules.duel.tierAmounts[tier]) ? rules.duel.tierAmounts[tier] : 0;
  return { lever: rules.duel.lever === 'ownPlus' ? 'ownPlus' : 'targetMinus', amount };
}

export function tradeShiftForTier(tier, rulesLike) {
  const rules = resolvePersuasionRules(rulesLike);
  const arr = rules.trade.tierShifts;
  return Number.isFinite(arr[tier]) ? arr[tier] : 0;
}
