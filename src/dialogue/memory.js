// src/dialogue/memory.js — pure, deterministic memory core for the dialogue
// system (MT2-SP4, direction B "记忆宿敌"). Spec:
// docs/superpowers/specs/2026-07-17-dialogue-system-design.md
// Plan: docs/superpowers/plans/2026-07-17-dialogue-b-plan.md (task T1)
//
// Consumes ONLY the engine's typed event stream (src/events.js — G.events,
// see ENGINE_EVENTS) — never reads or mutates G, never blocks a move, never
// throws into the render/move path. Lives entirely client-side; persisted in
// the save envelope alongside botSeats (T2 concern), NOT in G.
//
// Two independent pieces:
//  - buildTurnDigest(events, charId, windowSpec): a structured, deterministic
//    recap of recent history relevant to one character — designed to be
//    embedded directly in an LLM prompt (T2) AND consumed by UI/tests as-is.
//  - AttitudeLedger: pure functions over a plain
//    { [charId]: { [opponentId]: {grudge, trust} } } state object — per-pair
//    scores updated by a small rule table (applyEvent), decayed each season,
//    capped, JSON-round-trippable for the save envelope.
//
// All weights/caps/thresholds/windows come from RULES.dialogue (see
// mods/dominion/rules.js and src/mod-loader.js's DEFAULT_RULES — the same
// deepMerge(pristine, DEFAULT_RULES) precedent stat-mechanics established:
// src/Game.js setActiveModObject, ~line 96). DEFAULT_DIALOGUE_RULES below is
// a SECOND, independent line of defense so this module never NaNs even if
// called directly with a partial/missing/undefined rules object — the
// NaN-hole lesson from stat-mechanics (src/mod-loader.js DEFAULT_RULES.stats
// comment): every field defaulted, here twice over (RULES.dialogue fallback
// in the engine config, AND this module's own resolveDialogueRules()).

import { deepMerge } from '../mod-loader';

export const DEFAULT_DIALOGUE_RULES = {
  digestWindow: {
    maxEvents: 60,
    maxSeasons: 2,
  },
  weights: {
    duelLostGrudge: 2,
    bankruptedByGrudge: 3,
    tradeAcceptedTrust: 1,
    bigRentGrudge: 1,
    forceBuyVictimGrudge: 2,
  },
  caps: {
    grudge: 10,
    trust: 10,
  },
  decayPerSeason: {
    grudge: 1,
    trust: 1,
  },
  rentGrudgeThreshold: 200,
  attitudeDisplay: {
    // Chip tiers (T3 consumes read-only): value >= tiers[0] => ▲,
    // >= tiers[1] => ▲▲, >= tiers[2] => ▲▲▲.
    grudgeTiers: [3, 6, 9],
    trustTiers: [3, 6, 9],
  },
  // T3 (speech bubbles): how long an already-shown bubble lingers before
  // auto-dismissing, in ms. Bubbles reuse the SAME isEnabled()/verbosity
  // gate reactions already use — this field only controls dwell time.
  bubbleMs: 6000,
  // Gates for T2/T4 to consume; T1 does not read these itself.
  botAttitudeEnabled: true,
  banterEnabled: true,
  diaryEnabled: true,
  // T2 (season diaries): how many of a character's own most-recent diary
  // entries are fed into a prompt (formatDiaryLines, character-ai.js) vs how
  // many are RETAINED in the diary store (appendDiaryEntry below, save-
  // envelope-bound). Kept as two separate knobs — a long game may want to
  // retain more history than it re-feeds into every prompt.
  diaryPromptLines: 3,
  diaryHistoryCap: 12,
  // T2 ($3 hard cap, owner decision item 0): a per-session spend guard in
  // character-ai.js's SOLE fetch() choke point (_callApi) — checked BEFORE
  // any network call. costBudgetUSD is the primary fuse (cumulative
  // estimated USD spend, from the conservative/over-estimate-only
  // callPriceUSD table below); maxCallsPerSession is an INDEPENDENT second
  // fuse (absolute call count) so a misconfigured/zeroed price table can
  // never defeat the cap. Neither fuse affects the attitude ledger, turn
  // digest, or any keyless/code-driven feature — only LLM calls stop.
  costBudgetUSD: 3.0,
  maxCallsPerSession: 400,
  // Deliberately conservative (rounds UP, never down) flat-rate USD
  // estimates per call TYPE — not a token-accurate cost reconciliation
  // (OpenAI's real per-call cost depends on prompt length, which this table
  // does not measure). Purpose is solely to trip costBudgetUSD before the
  // owner's real bill could ever exceed it, not to mirror an invoice.
  // 'reaction'/'diary'/'banter'/'intro' all use the mini model
  // (max_tokens 150); 'chat' uses the pricier chat model with a longer
  // system prompt + history, hence the higher flat rate.
  callPriceUSD: {
    reaction: 0.001,
    diary: 0.001,
    banter: 0.001,
    intro: 0.001,
    chat: 0.01,
  },
};

// Recognized RULES.dialogue field names — used ONLY to detect "this object is
// itself dialogue-rules-shaped" below, so a full RULES object with no
// `.dialogue` key yet (the missing-RULES.dialogue fallback case) isn't
// mistaken for a bare dialogue object and doesn't leak unrelated keys
// (core/buildings/...) into the resolved output.
const DIALOGUE_RULE_KEYS = [
  'digestWindow', 'weights', 'caps', 'decayPerSeason', 'rentGrudgeThreshold',
  'attitudeDisplay', 'bubbleMs', 'botAttitudeEnabled', 'banterEnabled', 'diaryEnabled',
  'diaryPromptLines', 'diaryHistoryCap', 'costBudgetUSD', 'maxCallsPerSession',
  'callPriceUSD',
];

// Accepts: the full RULES object (reads .dialogue off it), a RULES.dialogue-
// shaped (or partial-dialogue-shaped) object directly, an unrelated/empty
// object, or null/undefined. Always returns a fully-populated dialogue rules
// object (read-only by convention — never mutated by this module).
export function resolveDialogueRules(rulesLike) {
  if (!rulesLike || typeof rulesLike !== 'object') return deepMerge({}, DEFAULT_DIALOGUE_RULES);
  if (rulesLike.dialogue && typeof rulesLike.dialogue === 'object') {
    return deepMerge(rulesLike.dialogue, DEFAULT_DIALOGUE_RULES);
  }
  const looksDialogueShaped = DIALOGUE_RULE_KEYS.some(k => Object.prototype.hasOwnProperty.call(rulesLike, k));
  return deepMerge(looksDialogueShaped ? rulesLike : {}, DEFAULT_DIALOGUE_RULES);
}

function clamp(value, lo, hi) {
  if (!Number.isFinite(value)) return lo; // NaN-hole guard
  return Math.min(hi, Math.max(lo, value));
}

// ---------------------------------------------------------------------------
// Attitude ledger — plain state, pure update functions.
// ---------------------------------------------------------------------------

export function createLedgerState() {
  return {};
}

// Read-only accessor; never creates entries. Missing pair => zeros.
export function getAttitude(state, charId, opponentId) {
  const pair = state && state[charId] && state[charId][opponentId];
  return { grudge: pair ? pair.grudge : 0, trust: pair ? pair.trust : 0 };
}

// Returns a NEW state object with (charId -> opponentId)'s grudge/trust
// shifted by the given deltas and clamped to [0, cap]. Returns the SAME
// state reference (identity-stable) when the deltas produce no observable
// change (already at cap, or zero deltas) — keeps determinism assertions and
// unknown-event no-op checks cheap (`applyEvent(...) === state`).
function withDelta(state, charId, opponentId, dGrudge, dTrust, caps) {
  const cur = getAttitude(state, charId, opponentId);
  const nextGrudge = clamp(cur.grudge + dGrudge, 0, caps.grudge);
  const nextTrust = clamp(cur.trust + dTrust, 0, caps.trust);
  if (nextGrudge === cur.grudge && nextTrust === cur.trust) return state;
  const nextCharBucket = { ...(state[charId] || {}), [opponentId]: { grudge: nextGrudge, trust: nextTrust } };
  return { ...state, [charId]: nextCharBucket };
}

function decayTowardZero(value, amount) {
  if (!Number.isFinite(value) || value === 0) return 0;
  if (value > 0) return Math.max(0, value - amount);
  return Math.min(0, value + amount);
}

// Decays every tracked pair's grudge/trust toward 0 by rules.decayPerSeason.
// Exported standalone (in addition to being wired into applyEvent's
// 'season_changed' branch) so T2/T3 or tests can invoke it directly.
export function decayLedger(state, rulesLike) {
  const rules = resolveDialogueRules(rulesLike);
  if (!state) return state;
  const charIds = Object.keys(state);
  if (charIds.length === 0) return state;
  let changed = false;
  const next = {};
  for (const charId of charIds) {
    const bucket = state[charId];
    const nextBucket = {};
    for (const opponentId of Object.keys(bucket)) {
      const pair = bucket[opponentId];
      const g = decayTowardZero(pair.grudge, rules.decayPerSeason.grudge);
      const t = decayTowardZero(pair.trust, rules.decayPerSeason.trust);
      if (g !== pair.grudge || t !== pair.trust) changed = true;
      nextBucket[opponentId] = { grudge: g, trust: t };
    }
    next[charId] = nextBucket;
  }
  return changed ? next : state;
}

// Rule table (spec direction B). Each row is keyed by event.type and reads
// ONLY that single event's own data (no cross-event correlation — see
// buildTurnDigest below for the batch-level correlations, e.g. auction
// bidder tracking, that a single event's data cannot support). Unknown types
// AND known-but-ledger-irrelevant types (dice_rolled, moved, property_bought,
// ...) fall through the default case and no-op, returning the SAME state
// reference — the registry (src/events.js ENGINE_EVENTS) will keep growing,
// this must never throw.
export function applyEvent(state, event, rulesLike) {
  if (!state) state = createLedgerState();
  if (!event || !event.type) return state;
  const rules = resolveDialogueRules(rulesLike);
  const data = event.data || {};
  const actor = event.actor;

  switch (event.type) {
    // Rent >= threshold paid to an opponent: grudge+bigRentGrudge on the
    // payer toward the owner. src/Game.js payRentAmount (~line 579-587):
    // actor = payerId, data = { propertyId, ownerId, amount }.
    case 'rent_paid': {
      if (!(data.amount >= rules.rentGrudgeThreshold)) return state;
      if (actor == null || data.ownerId == null || actor === data.ownerId) return state;
      return withDelta(state, actor, data.ownerId, rules.weights.bigRentGrudge, 0, rules.caps);
    }

    // Duel lost: the LOSER's grudge toward the winner rises. src/Game.js
    // respondDuel (~line 2079-2091): actor = challengerId, data =
    // { propertyId, ownerId, rent, challengerRoll, defenderRoll, winnerId, outcome }.
    case 'duel_resolved': {
      const { ownerId, winnerId } = data;
      if (actor == null || ownerId == null || winnerId == null) return state;
      const loserId = winnerId === actor ? ownerId : actor;
      if (loserId === winnerId) return state;
      return withDelta(state, loserId, winnerId, rules.weights.duelLostGrudge, 0, rules.caps);
    }

    // Bankrupted BY a specific creditor: grudge+bankruptedByGrudge on the
    // bankrupt player toward the creditor. src/Game.js handleBankruptcy
    // (~line 438-441): actor = player.id (the bankrupt player), data =
    // { creditorId } — null when bankrupt via tax/card (no attributable
    // actor; correctly no-ops below).
    case 'bankruptcy': {
      const creditorId = data.creditorId;
      if (creditorId == null || actor == null || actor === creditorId) return state;
      return withDelta(state, actor, creditorId, rules.weights.bankruptedByGrudge, 0, rules.caps);
    }

    // Completed trade: trust+tradeAcceptedTrust, SYMMETRIC both ways.
    // src/Game.js acceptTrade (~line 1931): actor = targetPlayerId, data =
    // { proposerId }.
    //
    // FLAGGED (see T1 report): the spec transcript reads "fair trade
    // accepted: trust+1", but trade_accepted's own data carries no valuation
    // — offeredMoney/requestedMoney/offeredProperties/requestedProperties
    // live on the EARLIER, separate trade_proposed event, and G.trade is
    // already nulled by the time trade_accepted fires (Game.js comment at
    // the acceptTrade site: "data mirrors G.trade's real field names...
    // (already nulled out by the time this logs)" is about trade_accepted's
    // sibling trade_proposed, not this event). A single-event rule cannot
    // compute "fair value" from trade_accepted alone, and even correlating
    // back to trade_proposed would still lack property PRICES (only IDs are
    // carried) to value the property side of the trade. This rule therefore
    // treats every completed trade as trust-building, dropping the
    // "fairness" qualifier rather than faking a valuation.
    case 'trade_accepted': {
      const proposerId = data.proposerId;
      if (proposerId == null || actor == null || actor === proposerId) return state;
      const s1 = withDelta(state, actor, proposerId, 0, rules.weights.tradeAcceptedTrust, rules.caps);
      return withDelta(s1, proposerId, actor, 0, rules.weights.tradeAcceptedTrust, rules.caps);
    }

    // Hostile takeover (forceBuy card): the VICTIM's grudge toward the taker
    // rises. src/Game.js applyCard forceBuy 'bought' branch (~line 1006):
    // actor = player.id (the taker/beneficiary), data = { deck, cardIndex,
    // action: 'forceBuy', text, effect: { outcome: 'bought', propertyId,
    // targetSpaceName, targetOwnerId, cost } }.
    //
    // The other card_applied actions (pay/payPercent/gainAll/downgrade/
    // freeUpgrade/gainPerProperty/moveTo/goToJail) settle with "the bank",
    // not a specific opposing character — their data carries no opponent id
    // at all, so they have no ledger rule (flagged in the T1 report; still
    // surfaced in buildTurnDigest's cardsSuffered for prompt color).
    case 'card_applied': {
      if (data.action !== 'forceBuy' || !data.effect || data.effect.outcome !== 'bought') return state;
      const victimId = data.effect.targetOwnerId;
      if (victimId == null || actor == null || actor === victimId) return state;
      return withDelta(state, victimId, actor, rules.weights.forceBuyVictimGrudge, 0, rules.caps);
    }

    // Season boundary: decay EVERY tracked pair toward 0. src/Game.js
    // turn.onBegin season rollover (~line 1384): actor = null, data =
    // { seasonIndex, seasonName }. Global and self-contained in `state` — no
    // other event's data is needed to apply this row.
    case 'season_changed':
      return decayLedger(state, rules);

    // trade_proposed / trade_rejected / trade_cancelled: intentionally NOT a
    // ledger-mutating row. The spec's own transcript shows grudge/trust
    // being READ to decide whether a proposal is rejected ("就凭你？先把陈留
    // 还回来再谈"), not written BY the rejection itself — rejection is a
    // symptom of existing attitude, not a new cause. Falls through to the
    // default no-op below, same as a genuinely-unknown type.
    default:
      return state;
  }
}

// Batch reducer over an ordered event list (caller's responsibility to pass
// events in chronological/seq order — the same order G.events always holds
// them in). Resolves `rulesLike` ONCE up front so repeated calls into
// applyEvent don't re-merge defaults per event.
export function applyEvents(state, events, rulesLike) {
  let s = state || createLedgerState();
  const rules = resolveDialogueRules(rulesLike);
  for (const event of (events || [])) {
    s = applyEvent(s, event, rules);
  }
  return s;
}

// JSON-safe defensive deep clone for the save envelope (avoids aliasing live
// in-memory state into the persisted snapshot — state produced by this
// module is already plain-JSON-safe, but this guards against future fields
// that might not be).
export function serializeLedger(state) {
  return JSON.parse(JSON.stringify(state || {}));
}

// Tolerant of missing/partial/unknown fields (old-save forward-compat): any
// non-object bucket/pair, non-finite grudge/trust, or extra unknown key is
// dropped or zero-filled rather than thrown. A save with NO dialogueMemory
// field at all should be handled by the caller passing `undefined`/`null`
// here, which yields a fresh empty ledger.
export function deserializeLedger(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const charId of Object.keys(raw)) {
    const bucket = raw[charId];
    if (!bucket || typeof bucket !== 'object') continue;
    const nextBucket = {};
    for (const opponentId of Object.keys(bucket)) {
      const pair = bucket[opponentId];
      if (!pair || typeof pair !== 'object') continue;
      const grudge = Number.isFinite(pair.grudge) ? pair.grudge : 0;
      const trust = Number.isFinite(pair.trust) ? pair.trust : 0;
      nextBucket[opponentId] = { grudge, trust };
    }
    // Drop buckets that end up with zero valid pairs (e.g. a junk top-level
    // key whose "pairs" were all malformed) rather than keeping an empty
    // object — functionally identical under getAttitude either way, but
    // keeps a rehydrated ledger's own key set honest.
    if (Object.keys(nextBucket).length > 0) out[charId] = nextBucket;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Diary store (T2, "season diaries") — per-character array of
// {turn, seasonIndex, seasonName, text} entries, one written per
// season_changed the character was voiced through (character-ai.js
// writeDiaryEntry + App.js's season-change trigger). Pure state + pure
// updaters, same JSON-plain-object discipline as the ledger above, extending
// the save-envelope-facing store this module owns (see serializeDialogueMemory
// below) rather than a second, parallel storage mechanism.
// ---------------------------------------------------------------------------

export function createDiaryState() {
  return {};
}

// Appends one entry for charId, trimming to RULES.dialogue.diaryHistoryCap
// (oldest dropped first) so an unbounded diary can't grow forever inside the
// save envelope across a very long game. No-ops (returns state unchanged,
// falling back to a fresh store if state itself was missing) on a
// missing charId or entry.
export function appendDiaryEntry(diaryState, charId, entry, rulesLike) {
  const state = diaryState || createDiaryState();
  if (charId == null || !entry) return state;
  const rules = resolveDialogueRules(rulesLike);
  const cap = Number.isFinite(rules.diaryHistoryCap) && rules.diaryHistoryCap > 0
    ? rules.diaryHistoryCap : DEFAULT_DIALOGUE_RULES.diaryHistoryCap;
  const prior = state[charId] || [];
  const nextEntry = {
    turn: Number.isFinite(entry.turn) ? entry.turn : 0,
    seasonIndex: Number.isFinite(entry.seasonIndex) ? entry.seasonIndex : null,
    seasonName: typeof entry.seasonName === 'string' ? entry.seasonName : '',
    text: String(entry.text || ''),
  };
  const nextList = [...prior, nextEntry];
  const trimmed = nextList.length > cap ? nextList.slice(nextList.length - cap) : nextList;
  return { ...state, [charId]: trimmed };
}

// Most recent `n` entries for charId, OLDEST FIRST (chronological reading
// order — see formatDiaryLines in character-ai.js, which renders them as a
// first-person arc, most recent last). Missing charId/state, or n<=0/absent,
// returns [] rather than throwing.
export function getRecentDiaryLines(diaryState, charId, n) {
  if (!diaryState || charId == null || !Array.isArray(diaryState[charId])) return [];
  const count = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  if (count === 0) return [];
  const list = diaryState[charId];
  return list.length > count ? list.slice(list.length - count) : list.slice();
}

// JSON-safe defensive deep clone, mirroring serializeLedger's contract.
export function serializeDiaries(diaryState) {
  return JSON.parse(JSON.stringify(diaryState || {}));
}

// Tolerant of missing/partial/malformed entries (old-save forward-compat),
// same posture as deserializeLedger: non-array buckets are dropped, entries
// missing a non-empty `text` are dropped (a diary entry IS its text — no
// text, no entry), numeric fields fall back to safe defaults rather than
// propagating NaN/undefined.
export function deserializeDiaries(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const charId of Object.keys(raw)) {
    const list = raw[charId];
    if (!Array.isArray(list)) continue;
    const cleaned = list
      .filter(e => e && typeof e === 'object' && typeof e.text === 'string' && e.text.length > 0)
      .map(e => ({
        turn: Number.isFinite(e.turn) ? e.turn : 0,
        seasonIndex: Number.isFinite(e.seasonIndex) ? e.seasonIndex : null,
        seasonName: typeof e.seasonName === 'string' ? e.seasonName : '',
        text: e.text,
      }));
    if (cleaned.length > 0) out[charId] = cleaned;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Save-envelope-level combined serialize/deserialize (T2 persistence). This
// is the SINGLE function App.js's saveGame/loadGame call — a thin wrapper
// composing serializeLedger/deserializeLedger (T1) and
// serializeDiaries/deserializeDiaries (above) plus the LLM cost-cap's
// {spentUSD, callCount} counters (character-ai.js owns the counters
// themselves; this module only knows how to round-trip the plain numbers
// tolerantly — see the T2 report for the "persist across save/load" decision).
// Extends T1's serialize format COMPATIBLY: an old save with no
// `dialogueMemory` field at all is the caller's job to detect (App.js passes
// `undefined` here in that case), which — same as deserializeLedger's own
// "absent field -> fresh ledger" contract — yields a fully fresh, empty
// memory rather than throwing.
// ---------------------------------------------------------------------------

export function serializeDialogueMemory(memory) {
  const m = memory || {};
  const spent = m.spentEstimate || {};
  return {
    ledger: serializeLedger(m.ledger),
    diaries: serializeDiaries(m.diaries),
    spentEstimate: {
      spentUSD: Number.isFinite(spent.spentUSD) ? spent.spentUSD : 0,
      callCount: Number.isFinite(spent.callCount) ? spent.callCount : 0,
    },
  };
}

export function deserializeDialogueMemory(raw) {
  const r = (raw && typeof raw === 'object') ? raw : {};
  const spent = (r.spentEstimate && typeof r.spentEstimate === 'object') ? r.spentEstimate : {};
  return {
    ledger: deserializeLedger(r.ledger),
    diaries: deserializeDiaries(r.diaries),
    spentEstimate: {
      spentUSD: Number.isFinite(spent.spentUSD) ? spent.spentUSD : 0,
      callCount: Number.isFinite(spent.callCount) ? spent.callCount : 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Turn digest
// ---------------------------------------------------------------------------

// Splits `events` into the windowed slice a digest should consider, applying
// BOTH a hard count cap (maxEvents) and a season-boundary cap (maxSeasons —
// "rolling ~2 season cycles" per spec) and taking whichever is MORE
// restrictive (larger start index = smaller window). maxSeasons <= 0
// disables the season-side restriction entirely (count window alone
// applies). Returns raw indices in `meta` rather than derived booleans so
// tests can assert on the exact boundary without re-deriving this logic.
function windowEvents(events, windowSpec) {
  const list = Array.isArray(events) ? events : [];
  const spec = windowSpec || {};
  const maxEvents = Number.isFinite(spec.maxEvents) && spec.maxEvents > 0
    ? spec.maxEvents : DEFAULT_DIALOGUE_RULES.digestWindow.maxEvents;
  const maxSeasons = Number.isFinite(spec.maxSeasons) && spec.maxSeasons >= 0
    ? spec.maxSeasons : DEFAULT_DIALOGUE_RULES.digestWindow.maxSeasons;

  const countStart = Math.max(0, list.length - maxEvents);

  // Walk back from the end counting season_changed boundaries crossed; once
  // MORE than maxSeasons boundaries have been crossed, cut immediately AFTER
  // that (maxSeasons+1)-th boundary event (exclude it and everything before
  // it). If fewer than maxSeasons boundaries exist at all, the loop runs out
  // without ever cutting — seasonStart stays 0 (keep everything; graceful
  // degradation when there isn't maxSeasons worth of history yet).
  let seasonStart = 0;
  if (maxSeasons > 0) {
    let crossed = 0;
    let idx = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].type === 'season_changed') {
        crossed += 1;
        if (crossed > maxSeasons) { idx = i + 1; break; }
      }
      idx = i;
    }
    seasonStart = idx;
  }

  const start = Math.max(countStart, seasonStart);
  return {
    slice: list.slice(start),
    meta: {
      totalEvents: list.length,
      consideredEvents: list.length - start,
      start,
      countStart,
      seasonStart,
      requestedMaxEvents: maxEvents,
      requestedMaxSeasons: maxSeasons,
    },
  };
}

// trade_cancelled carries the "other party" under different field names
// depending on which of the three Game.js call sites fired it:
//  - cancelTrade (proposer-initiated, normal path): { targetPlayerId }
//  - acceptTrade's stale-trade auto-cancel: { targetPlayerId, reason: 'stale' }
//  - handleBankruptcy's pending-trade cleanup (actor may be EITHER party):
//    { otherPartyId, reason: 'bankruptcy' }
function tradeCancelOpponentId(data) {
  if (data.targetPlayerId != null) return data.targetPlayerId;
  if (data.otherPartyId != null) return data.otherPartyId;
  return null;
}

// Pure, deterministic, structured digest of recent history relevant to ONE
// character, built from the raw event stream. `windowSpec` is expected to be
// RULES.dialogue.digestWindow (or compatible {maxEvents, maxSeasons}
// shape) — missing/partial values fall back to DEFAULT_DIALOGUE_RULES.
// Output is plain, JSON-serializable, and designed to be embedded directly
// in an LLM prompt (T2) as well as read by UI/tests.
export function buildTurnDigest(events, charId, windowSpec) {
  const { slice, meta } = windowEvents(events, windowSpec);

  const digest = {
    charId,
    window: meta,
    generatedAtTurn: slice.length ? slice[slice.length - 1].turn : 0,
    rentsPaid: [],
    rentsCollected: [],
    duelsWon: [],
    duelsLost: [],
    tradesCompleted: [],
    tradesRejected: [],
    tradesCancelled: [],
    auctionsWon: [],
    auctionsLost: [],
    cardsSuffered: [],
    propertiesTakenFrom: [],
    propertiesTaken: [],
    bankruptciesCaused: [],
    wasBankrupted: [],
    bankruptciesObserved: [],
  };

  if (charId == null) return digest;

  // Scratch, batch-only correlation: which players have placed at least one
  // bid in the CURRENT auction lifecycle for a given propertyId. Auction
  // events themselves (auction_ended) carry only winnerId, not the losing
  // bidders — this is exactly the kind of cross-event correlation
  // AttitudeLedger.applyEvent (single-event contract) deliberately does NOT
  // attempt; buildTurnDigest is a batch function by design, so it can.
  const activeBidders = {};

  for (const event of slice) {
    const { type, actor, turn } = event;
    const data = event.data || {};
    switch (type) {
      case 'rent_paid': {
        if (actor === charId && data.ownerId !== charId) {
          digest.rentsPaid.push({ turn, opponentId: data.ownerId, propertyId: data.propertyId, amount: data.amount });
        } else if (data.ownerId === charId && actor !== charId) {
          digest.rentsCollected.push({ turn, opponentId: actor, propertyId: data.propertyId, amount: data.amount });
        }
        break;
      }

      case 'duel_resolved': {
        if (actor !== charId && data.ownerId !== charId) break;
        const winnerId = data.winnerId;
        const loserId = winnerId === actor ? data.ownerId : actor;
        const opponentId = charId === winnerId ? loserId : winnerId;
        const entry = { turn, opponentId, propertyId: data.propertyId, rent: data.rent };
        if (charId === winnerId) digest.duelsWon.push(entry);
        else if (charId === loserId) digest.duelsLost.push(entry);
        break;
      }

      case 'trade_accepted':
      case 'trade_rejected': {
        if (actor !== charId && data.proposerId !== charId) break;
        const opponentId = actor === charId ? data.proposerId : actor;
        const role = actor === charId ? 'target' : 'proposer';
        const entry = { turn, opponentId, role };
        if (type === 'trade_accepted') digest.tradesCompleted.push(entry);
        else digest.tradesRejected.push(entry);
        break;
      }

      case 'trade_cancelled': {
        const otherParty = tradeCancelOpponentId(data);
        if (actor !== charId && otherParty !== charId) break;
        const opponentId = actor === charId ? otherParty : actor;
        digest.tradesCancelled.push({ turn, opponentId, reason: data.reason || 'manual' });
        break;
      }

      case 'auction_started': {
        activeBidders[data.propertyId] = new Set();
        break;
      }

      case 'bid_placed': {
        if (!activeBidders[data.propertyId]) activeBidders[data.propertyId] = new Set();
        activeBidders[data.propertyId].add(actor);
        break;
      }

      case 'auction_ended': {
        const bidders = activeBidders[data.propertyId];
        if (data.winnerId === charId) {
          digest.auctionsWon.push({ turn, propertyId: data.propertyId, amount: data.amount });
        } else if (bidders && bidders.has(charId)) {
          digest.auctionsLost.push({ turn, propertyId: data.propertyId, winnerId: data.winnerId, amount: data.amount });
        }
        delete activeBidders[data.propertyId];
        break;
      }

      case 'card_applied': {
        if (actor === charId && (data.action === 'pay' || data.action === 'payPercent')) {
          digest.cardsSuffered.push({ turn, action: data.action, amount: data.effect ? data.effect.amount : undefined });
        }
        if (data.action === 'forceBuy' && data.effect && data.effect.outcome === 'bought') {
          if (data.effect.targetOwnerId === charId) {
            digest.propertiesTakenFrom.push({ turn, propertyId: data.effect.propertyId, byId: actor, cost: data.effect.cost });
          } else if (actor === charId) {
            digest.propertiesTaken.push({ turn, propertyId: data.effect.propertyId, fromId: data.effect.targetOwnerId, cost: data.effect.cost });
          }
        }
        break;
      }

      case 'bankruptcy': {
        if (actor === charId) {
          digest.wasBankrupted.push({ turn, creditorId: data.creditorId != null ? data.creditorId : null });
        } else if (data.creditorId === charId) {
          digest.bankruptciesCaused.push({ turn, victimId: actor });
        } else {
          digest.bankruptciesObserved.push({ turn, playerId: actor, creditorId: data.creditorId != null ? data.creditorId : null });
        }
        break;
      }

      default:
        break;
    }
  }

  return digest;
}
