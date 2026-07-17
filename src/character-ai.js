// CharacterAI — AI integration module for character responses and chat
// Calls OpenAI API to generate in-character dialogue based on lore + game state
import { playerName } from './events';
// MT2-SP4 direction B (T2): memory-aware prompt assembly. resolveDialogueRules/
// getAttitude are T1's pure core (src/dialogue/memory.js) — read-only here,
// never mutated. getLocale is the i18n singleton (src/i18n.js) — read directly
// rather than threaded through every call site, matching i18n.js's own
// documented "small pure helper imported everywhere" convention.
import { resolveDialogueRules, getAttitude } from './dialogue/memory';
import { getLocale } from './i18n';

// Event types that trigger AI responses
export const EVENT_TYPES = {
  ROLL_DICE: 'roll_dice',
  LAND_PROPERTY_BUY: 'land_property_buy',
  LAND_PROPERTY_RENT: 'land_property_rent',
  PAY_TAX: 'pay_tax',
  DRAW_CARD: 'draw_card',
  GO_TO_JAIL: 'go_to_jail',
  PASS_GO: 'pass_go',
  BUY_PROPERTY: 'buy_property',
  UPGRADE_PROPERTY: 'upgrade_property',
  AUCTION_START: 'auction_start',
  TRADE_PROPOSED: 'trade_proposed',
  BANKRUPTCY: 'bankruptcy',
  SEASON_CHANGE: 'season_change',
  GAME_OVER: 'game_over',
  DUEL: 'duel',
};

// Events considered "major" for the "Major events only" verbosity mode
const MAJOR_EVENTS = new Set([
  EVENT_TYPES.LAND_PROPERTY_BUY,
  EVENT_TYPES.LAND_PROPERTY_RENT,
  EVENT_TYPES.DRAW_CARD,
  EVENT_TYPES.GO_TO_JAIL,
  EVENT_TYPES.BUY_PROPERTY,
  EVENT_TYPES.UPGRADE_PROPERTY,
  EVENT_TYPES.AUCTION_START,
  EVENT_TYPES.TRADE_PROPOSED,
  EVENT_TYPES.BANKRUPTCY,
  EVENT_TYPES.SEASON_CHANGE,
  EVENT_TYPES.GAME_OVER,
  EVENT_TYPES.DUEL,
]);

// Verbosity modes
export const VERBOSITY = {
  OFF: 'off',
  MAJOR: 'major',
  ALL: 'all',
};

// Human-readable labels for went_to_jail's data.reason ('space'/'triples'/'card')
// — read by mapEngineEventToAi, not by the engine's own formatter (events.js
// already has its own byte-identical G.messages strings for these reasons;
// this is a separate, AI-prompt-facing phrasing).
const JAIL_REASON_LABELS = {
  space: 'Go To Jail space',
  triples: 'Triple doubles',
  card: 'a Chance/Community Chest card',
};

// Pure adapter: engine event (from G.events, shape {seq,turn,type,actor,data})
// -> { eventType, eventData } for the AI's own EVENT_TYPES/​_formatEventContext,
// or null when the engine type has no AI reaction (unmapped, or filtered by a
// sub-condition like landing_notice's note or salary_collected's source).
// G is read-only here — only used to resolve names/space labels off ids
// already carried in the payload (never re-derives amounts from live state).
export function mapEngineEventToAi(event, G) {
  if (!event) return null;
  const { type, actor, data } = event;

  switch (type) {
    case 'dice_rolled':
      return {
        eventType: EVENT_TYPES.ROLL_DICE,
        eventData: { d1: data.d1, d2: data.d2, total: data.total, isDoubles: data.doubles },
      };

    // Only the 'available' note is a buy prompt — 'unaffordable'/'owned'/
    // 'visiting_jail'/'parking_relax' carry no buy decision and must not
    // trigger a LAND_PROPERTY_BUY reaction.
    case 'landing_notice': {
      if (data.note !== 'available') return null;
      const space = G.board.spaces[data.propertyId];
      const player = G.players[actor];
      return {
        eventType: EVENT_TYPES.LAND_PROPERTY_BUY,
        eventData: { spaceName: space.name, price: data.effectivePrice, money: player ? player.money : 0 },
      };
    }

    case 'rent_paid': {
      const space = G.board.spaces[data.propertyId];
      return {
        eventType: EVENT_TYPES.LAND_PROPERTY_RENT,
        eventData: { spaceName: space.name, ownerName: playerName(G.players[data.ownerId]), rent: data.amount },
      };
    }

    case 'tax_paid':
      return { eventType: EVENT_TYPES.PAY_TAX, eventData: { amount: data.amount } };

    // data.empty (deck exhausted) -> no AI reaction (parity with old string sniffer)
    case 'card_drawn':
      if (data.empty) return null;
      return {
        eventType: EVENT_TYPES.DRAW_CARD,
        eventData: { cardText: data.text },
      };

    case 'went_to_jail':
      return {
        eventType: EVENT_TYPES.GO_TO_JAIL,
        eventData: { reason: JAIL_REASON_LABELS[data.reason] || data.reason },
      };

    // Only the GO-crossing salary is a "passed GO" moment — hub/parking/card
    // salary sources are real money but not this specific reaction.
    case 'salary_collected': {
      if (data.source !== 'go') return null;
      return { eventType: EVENT_TYPES.PASS_GO, eventData: { amount: data.amount } };
    }

    case 'property_bought': {
      const space = G.board.spaces[data.propertyId];
      return { eventType: EVENT_TYPES.BUY_PROPERTY, eventData: { spaceName: space.name, price: data.paidPrice } };
    }

    case 'property_upgraded': {
      const space = G.board.spaces[data.propertyId];
      return {
        eventType: EVENT_TYPES.UPGRADE_PROPERTY,
        eventData: { spaceName: space.name, levelName: data.newLevelName, cost: data.cost },
      };
    }

    case 'auction_started': {
      const space = G.board.spaces[data.propertyId];
      return { eventType: EVENT_TYPES.AUCTION_START, eventData: { spaceName: space.name } };
    }

    case 'trade_proposed':
      return {
        eventType: EVENT_TYPES.TRADE_PROPOSED,
        eventData: { targetName: playerName(G.players[data.targetPlayerId]) },
      };

    case 'bankruptcy':
      return {
        eventType: EVENT_TYPES.BANKRUPTCY,
        eventData: { playerName: playerName(G.players[actor]) },
      };

    case 'season_changed':
      return { eventType: EVENT_TYPES.SEASON_CHANGE, eventData: { newSeason: data.seasonName } };

    case 'game_over': {
      const winnerId = data.result && data.result.winner;
      const winnerName = (winnerId !== undefined && winnerId !== null) ? playerName(G.players[winnerId]) : '';
      return { eventType: EVENT_TYPES.GAME_OVER, eventData: { winnerName } };
    }

    case 'duel_resolved': {
      const space = G.board.spaces[data.propertyId];
      const challengerName = playerName(G.players[actor]);
      const defenderName = playerName(G.players[data.ownerId]);
      const winnerName = playerName(G.players[data.winnerId]);
      return {
        eventType: EVENT_TYPES.DUEL,
        eventData: { challengerName, defenderName, winnerName, outcome: data.outcome, propertyName: space.name },
      };
    }

    default:
      return null;
  }
}

// Pure cursor-advance helper for detectAndTriggerAI's lazy seq cursor
// (App.js — a DOM-bound class method, so the cursor arithmetic is extracted
// here to stay unit-testable). `events` is G.events (seq-monotonic, front-
// trimmed at the cap); `lastSeq` is the caller's last-seen seq.
//
// lastSeq === undefined (first sight of G.events — new game, load, exit-to-
// menu restart, mid-match online join) -> lazy-init: absorb everything
// already present WITHOUT firing (newEvents: []), cursor set to the current
// max seq (-1 if there are no events yet, so seq 0 is still "new" next call).
//
// Otherwise -> incremental: return events with seq > lastSeq, in order.
// Trim-gap (lastSeq older than the oldest remaining seq, because the cap
// trimmed everything in between) needs no special case: filtering by
// seq > lastSeq already returns every event still present, which IS "skip to
// oldest available" — there is nothing older left to skip past.
export function consumeNewEvents(events, lastSeq) {
  const list = events || [];
  if (lastSeq === undefined) {
    const nextSeq = list.length ? list[list.length - 1].seq : -1;
    return { newEvents: [], nextSeq };
  }
  const newEvents = list.filter(e => e.seq > lastSeq);
  const nextSeq = newEvents.length ? newEvents[newEvents.length - 1].seq : lastSeq;
  return { newEvents, nextSeq };
}

// ---------------------------------------------------------------------------
// Banter (MT2-SP4 direction B, T2 — merges direction A's "ambient table-talk"
// into B per the spec's recommendation). Pure event-shape helpers that
// App.js's event-driven dispatch loop (same lazy-cursor pattern as
// mapEngineEventToAi above) uses to decide WHO banters and about WHAT,
// before making any LLM call. Kept pure/exported for the same reason as
// mapEngineEventToAi/consumeNewEvents: unit-testable with hand-built event
// fixtures, no DOM/G required.
// ---------------------------------------------------------------------------

// auction_ended carries only {propertyId, winnerId, amount} — no losing
// bidders. Scans backward from the matching auction_ended event (found by
// seq) to the auction's own auction_started boundary, collecting bid_placed
// actors for that propertyId, and returns the CLOSEST (most recent) losing
// bidder found — i.e. whoever was outbid last, the most natural "rival" for
// a grumble. Returns null when no other bidder exists (solo-bidder auction,
// or winnerId absent) — banter needs a genuine pair, not a lone gloat line.
export function findAuctionRival(events, endEvent) {
  if (!endEvent || endEvent.type !== 'auction_ended') return null;
  const data = endEvent.data || {};
  const { propertyId, winnerId } = data;
  if (winnerId == null || propertyId == null) return null;
  const list = events || [];
  const endIdx = list.findIndex(e => e.seq === endEvent.seq);
  if (endIdx === -1) return null;
  for (let i = endIdx - 1; i >= 0; i--) {
    const e = list[i];
    if (e.type === 'auction_started' && e.data && e.data.propertyId === propertyId) break;
    if (e.type === 'bid_placed' && e.data && e.data.propertyId === propertyId && e.actor !== winnerId) {
      return e.actor;
    }
  }
  return null;
}

// Resolves a triggering engine event into a banter pair — {firstId,
// secondId, situation} — or null when no valid two-sided exchange can be
// formed (a "reply-pair" per spec; App.js skips banter entirely rather than
// firing a lone half-pair). `firstId` speaks first (the winner/proposer
// side); `secondId` replies. `events` is the full G.events array, needed
// only for the auction case (findAuctionRival's backward scan).
export function resolveBanterPair(event, events) {
  if (!event) return null;
  const data = event.data || {};
  switch (event.type) {
    case 'duel_resolved': {
      const { ownerId, winnerId } = data;
      const actor = event.actor;
      if (actor == null || ownerId == null || winnerId == null) return null;
      const loserId = winnerId === actor ? ownerId : actor;
      if (loserId === winnerId) return null;
      return { firstId: winnerId, secondId: loserId, situation: 'duel' };
    }
    case 'trade_accepted': {
      const proposerId = data.proposerId;
      const actor = event.actor;
      if (proposerId == null || actor == null || actor === proposerId) return null;
      return { firstId: proposerId, secondId: actor, situation: 'trade' };
    }
    case 'auction_ended': {
      const rival = findAuctionRival(events, event);
      if (rival == null) return null;
      return { firstId: data.winnerId, secondId: rival, situation: 'auction' };
    }
    default:
      return null;
  }
}

// The two user-turn prompts for a banter pair's first/second line — plain
// situational framing (not a "Game event: ..." reaction context), since
// banter is a direct address between two characters rather than a comment on
// one's own turn. `event` supplies the auction's final bid amount when
// relevant; unused for duel/trade.
export function banterSituationText(situation, firstName, secondName, event) {
  const amount = event && event.data && event.data.amount;
  switch (situation) {
    case 'duel':
      return {
        first: `You just won a duel over a property against ${secondName}.`,
        second: `You just lost a duel over a property to ${firstName}.`,
      };
    case 'trade':
      return {
        first: `You just completed a trade with ${secondName}.`,
        second: `You just completed a trade with ${firstName}.`,
      };
    case 'auction':
      return {
        first: `You just won an auction against ${secondName}${amount != null ? ` (final bid $${amount})` : ''}.`,
        second: `You just lost an auction to ${firstName}${amount != null ? ` (final bid $${amount})` : ''}.`,
      };
    default:
      return { first: '', second: '' };
  }
}

// ---------------------------------------------------------------------------
// Dialogue-memory prompt assembly (MT2-SP4 direction B, T2). Pure formatters
// that turn T1's structured memory core (attitude ledger + turn digest) plus
// this task's diary lines into short, LLM-legible prompt text blocks. Kept
// pure/exported so prompt CONTENT can be asserted directly in tests without
// calling any API (spec requirement — "verify by asserting prompt content in
// tests, not by calling any API").
// ---------------------------------------------------------------------------

// Repeated-glyph "tier word" for a value against a 3-step threshold array
// (RULES.dialogue.attitudeDisplay.{grudge,trust}Tiers) — e.g. value 6 against
// [3,6,9] crosses 2 thresholds -> glyph repeated twice. Distinct glyphs per
// axis (grudge ▲, trust ●) so the two numbers next to each other in a table
// row stay visually distinguishable; independent of T3's own UI chip glyphs
// (a separate, later concern — T3 renders its own chips off the same RULES
// thresholds but is not required to reuse this exact formatting).
function tierGlyphs(value, tiers, glyph) {
  if (!Array.isArray(tiers) || !(value > 0)) return '';
  let n = 0;
  for (const t of tiers) if (value >= t) n++;
  return n > 0 ? ' ' + glyph.repeat(n) : '';
}

// One line per opponent this character has ANY non-neutral standing with
// (grudge>0 or trust>0) — neutral (0/0) pairs are omitted to keep the prompt
// compact; a freshly-started game with no history yet correctly produces ''
// (block omitted entirely by buildDialoguePromptExtras). `opponents` is
// [{id, name}], typically every OTHER character currently in the match.
export function formatAttitudeTable(charId, ledgerState, opponents, dialogueRules) {
  if (charId == null || !Array.isArray(opponents) || opponents.length === 0) return '';
  const rules = resolveDialogueRules(dialogueRules);
  const lines = [];
  for (const opp of opponents) {
    if (!opp || opp.id == null || opp.id === charId) continue;
    const { grudge, trust } = getAttitude(ledgerState, charId, opp.id);
    if (grudge <= 0 && trust <= 0) continue;
    const gGlyph = tierGlyphs(grudge, rules.attitudeDisplay.grudgeTiers, '▲');
    const tGlyph = tierGlyphs(trust, rules.attitudeDisplay.trustTiers, '●');
    lines.push(`- ${opp.name}: grudge ${grudge}${gGlyph}, trust ${trust}${tGlyph}`);
  }
  if (lines.length === 0) return '';
  return 'Your standing with other council members (grudge = resentment, trust = goodwill; both 0-10):\n' + lines.join('\n');
}

// Turns T1's buildTurnDigest() output into short, citable prose lines —
// amounts, opponent NAMES (resolved via nameById, {id: name}), and counts, so
// a character can reference real history ("paid $310 to X three times")
// rather than vague generalities. Categories with zero entries are omitted;
// an entirely-empty/fresh digest correctly returns ''.
export function formatTurnDigest(digest, nameById) {
  if (!digest) return '';
  const name = (id) => (id != null && nameById && nameById[id]) || 'someone';
  const names = (ids) => [...new Set(ids.map(name))].join(', ');
  const sum = (arr, key) => arr.reduce((s, e) => s + (e[key] || 0), 0);
  const lines = [];

  if (digest.rentsPaid.length) {
    lines.push(`Paid ${digest.rentsPaid.length} rent payment(s) totaling $${sum(digest.rentsPaid, 'amount')} to ${names(digest.rentsPaid.map(r => r.opponentId))}.`);
  }
  if (digest.rentsCollected.length) {
    lines.push(`Collected ${digest.rentsCollected.length} rent payment(s) totaling $${sum(digest.rentsCollected, 'amount')} from ${names(digest.rentsCollected.map(r => r.opponentId))}.`);
  }
  if (digest.duelsWon.length) {
    lines.push(`Won ${digest.duelsWon.length} duel(s) against ${names(digest.duelsWon.map(d => d.opponentId))}.`);
  }
  if (digest.duelsLost.length) {
    lines.push(`Lost ${digest.duelsLost.length} duel(s) to ${names(digest.duelsLost.map(d => d.opponentId))}.`);
  }
  if (digest.tradesCompleted.length) {
    lines.push(`Completed ${digest.tradesCompleted.length} trade(s) with ${names(digest.tradesCompleted.map(t => t.opponentId))}.`);
  }
  if (digest.tradesRejected.length) {
    lines.push(`Had ${digest.tradesRejected.length} trade(s) rejected involving ${names(digest.tradesRejected.map(t => t.opponentId))}.`);
  }
  if (digest.auctionsWon.length) {
    lines.push(`Won ${digest.auctionsWon.length} auction(s) for $${sum(digest.auctionsWon, 'amount')} total.`);
  }
  if (digest.auctionsLost.length) {
    lines.push(`Lost ${digest.auctionsLost.length} auction(s) to ${names(digest.auctionsLost.map(a => a.winnerId))}.`);
  }
  if (digest.propertiesTakenFrom.length) {
    lines.push(`Had ${digest.propertiesTakenFrom.length} propert${digest.propertiesTakenFrom.length === 1 ? 'y' : 'ies'} taken by ${names(digest.propertiesTakenFrom.map(p => p.byId))}.`);
  }
  if (digest.propertiesTaken.length) {
    lines.push(`Took ${digest.propertiesTaken.length} propert${digest.propertiesTaken.length === 1 ? 'y' : 'ies'} from ${names(digest.propertiesTaken.map(p => p.fromId))}.`);
  }
  if (digest.wasBankrupted.length) {
    const creditors = digest.wasBankrupted.map(b => b.creditorId).filter(id => id != null);
    lines.push(creditors.length ? `Went bankrupt, creditor: ${names(creditors)}.` : 'Went bankrupt.');
  }
  if (digest.bankruptciesCaused.length) {
    lines.push(`Bankrupted ${names(digest.bankruptciesCaused.map(b => b.victimId))}.`);
  }
  if (digest.cardsSuffered.length) {
    lines.push(`Paid $${sum(digest.cardsSuffered, 'amount')} from ${digest.cardsSuffered.length} card event(s).`);
  }

  if (lines.length === 0) return '';
  return 'Recent history (this season and last):\n' + lines.map(l => '- ' + l).join('\n');
}

// `diaryLines`: [{turn, seasonName, text}, ...] — already capped/ordered by
// the caller (App.js, via T1-extended getRecentDiaryLines). Oldest-first so
// the LLM reads them as a chronological arc, most recent last.
export function formatDiaryLines(diaryLines) {
  if (!Array.isArray(diaryLines) || diaryLines.length === 0) return '';
  return 'Your own past diary entries (oldest first):\n' + diaryLines.map(d => `- "${d.text}"`).join('\n');
}

// Reply-language instruction, read from the live i18n locale unless a caller
// passes an explicit override (e.g. a future server-side/test context that
// isn't the DOM singleton). Always returns non-empty — this line is always
// appended, never conditionally omitted.
export function localeInstruction(locale) {
  const loc = (locale === 'zh' || locale === 'en') ? locale : getLocale();
  return loc === 'zh'
    ? 'Reply in Simplified Chinese (中文), in character.'
    : 'Reply in English, in character.';
}

export class CharacterAI {
  constructor(apiKey, options = {}) {
    this.apiKey = apiKey || '';
    this.model = options.model || 'gpt-4o-mini';
    this.chatModel = options.chatModel || 'gpt-4o';
    this.verbosity = options.verbosity || VERBOSITY.MAJOR;
    this._pendingRequests = 0;
    this.maxConcurrent = 2;
    // MT2-SP4 direction B (T2): resolved once at construction (and whenever
    // setDialogueRules is called, e.g. after a mod switch) via T1's own
    // fallback layer — resolveDialogueRules(undefined) yields a fully
    // populated, NaN-free config even if the caller (a standalone unit test,
    // or App.js before RULES is ready) never passes one.
    this.dialogueRules = resolveDialogueRules(options.dialogueRules);
    // $3 session cost hard-cap (owner decision item 0, T2). Two INDEPENDENT
    // fuses checked together by _budgetExhausted(): cumulative estimated
    // USD spend vs costBudgetUSD, and raw call count vs
    // maxCallsPerSession — either alone can trip the cap, so a
    // misconfigured/zeroed price table can never defeat the count fuse.
    // Both counters are pre-charged in _callApi BEFORE the network call is
    // made (see its doc comment) — monotonic, never decreases except via
    // resetCostEstimate()/setCostEstimate().
    this._spentEstimateUSD = 0;
    this._callCount = 0;
  }

  setDialogueRules(rulesLike) {
    this.dialogueRules = resolveDialogueRules(rulesLike);
  }

  // Conservative (over-estimate only) flat USD price for one call of
  // `callType`, from RULES.dialogue.callPriceUSD. An unrecognized callType
  // (future call site that forgets to register a price) falls back to the
  // most expensive KNOWN tier rather than 0 — silently under-pricing an
  // unknown call type would be the one way this guard could fail open.
  _priceFor(callType) {
    const table = this.dialogueRules.callPriceUSD || {};
    const price = table[callType];
    if (Number.isFinite(price)) return price;
    const known = Object.values(table).filter(Number.isFinite);
    return known.length ? Math.max(...known) : 0.01;
  }

  // Either fuse tripping is sufficient — see the constructor's doc comment.
  // Number.isFinite guards a misconfigured (missing/NaN) limit from ever
  // silently disabling its OWN fuse (a non-finite limit just makes that one
  // comparison always false, falling through to the other fuse).
  _budgetExhausted() {
    const { costBudgetUSD, maxCallsPerSession } = this.dialogueRules;
    if (Number.isFinite(costBudgetUSD) && this._spentEstimateUSD >= costBudgetUSD) return true;
    if (Number.isFinite(maxCallsPerSession) && this._callCount >= maxCallsPerSession) return true;
    return false;
  }

  // Read-only snapshot for the AI settings modal (App.js showAISettings).
  getCostEstimate() {
    return {
      spentUSD: this._spentEstimateUSD,
      callCount: this._callCount,
      budgetUSD: this.dialogueRules.costBudgetUSD,
      maxCalls: this.dialogueRules.maxCallsPerSession,
      capped: this._budgetExhausted(),
    };
  }

  // New GAME (not new boot) — the budget is per-game (T2 persistence
  // decision), so App.js calls this at exitToMenu/fresh-game start, and
  // setCostEstimate (below) to RESTORE a value on load instead.
  resetCostEstimate() {
    this._spentEstimateUSD = 0;
    this._callCount = 0;
  }

  // Restores a persisted {spentUSD, callCount} (save-envelope load path).
  // Tolerant of a missing/malformed estimate (old saves, corrupt data) —
  // falls back to 0/0 rather than propagating NaN into the cap check.
  //
  // T2-review Fix 2 — SESSION-SCOPED MONOTONICITY: within one browser
  // session the in-memory counters can only ever INCREASE via this method
  // (Math.max clamp per field). An unconditional overwrite let loading an
  // EARLIER save roll the spend counter backward, so checkpoint-cycling
  // (spend → load older save → spend again → repeat) could bill real
  // dollars far past the owner's $3 hard cap while the counter kept
  // resetting — the exact bypass the cap exists to prevent. The two scopes
  // compose as: per-game PERSISTENCE (the envelope carries the counter
  // across save/load so a resumed game continues its own budget) +
  // per-session MONOTONICITY (no load within a running session can lower
  // what this session has already been charged for — real API calls
  // already happened; a save file can't un-spend them). A genuinely NEW
  // budget comes only from resetCostEstimate() above (exitToMenu / fresh
  // game). Side effect, deliberately fail-closed: loading a DIFFERENT
  // match's save mid-session without exiting to menu first keeps
  // max(current, loaded) — conservative over-counting, never under.
  setCostEstimate(est) {
    const e = est || {};
    const loadedSpent = Number.isFinite(e.spentUSD) ? e.spentUSD : 0;
    const loadedCount = Number.isFinite(e.callCount) ? e.callCount : 0;
    this._spentEstimateUSD = Math.max(this._spentEstimateUSD, loadedSpent);
    this._callCount = Math.max(this._callCount, loadedCount);
  }

  isEnabled() {
    return this.apiKey && this.verbosity !== VERBOSITY.OFF;
  }

  shouldRespond(eventType) {
    if (!this.isEnabled()) return false;
    if (this.verbosity === VERBOSITY.ALL) return true;
    if (this.verbosity === VERBOSITY.MAJOR) return MAJOR_EVENTS.has(eventType);
    return false;
  }

  setApiKey(key) {
    this.apiKey = key || '';
  }

  setVerbosity(mode) {
    if (Object.values(VERBOSITY).includes(mode)) {
      this.verbosity = mode;
    }
  }

  // Build a system prompt from character data + lore, plus (MT2-SP4 T2) the
  // memory-aware dialogue extras — attitude table, turn digest, diary lines,
  // reply-language instruction — appended at the end. `dialogueContext` is
  // optional and defaults to {} (locale instruction still always appended;
  // the other three blocks degrade to '' when their inputs are absent, e.g.
  // introduce() at character-select time has no live G/ledger yet).
  buildSystemPrompt(character, lore, dialogueContext) {
    const parts = [];

    parts.push(`You are ${character.name}, ${character.title}.`);

    if (lore) {
      if (lore.titleZh) parts.push(`Chinese title: ${lore.titleZh}`);
      if (lore.identity) parts.push(`Identity: ${lore.identity}`);
      if (lore.alignment) parts.push(`Alignment: ${lore.alignment}`);

      if (lore.background) {
        // Take first paragraph as concise background
        const firstPara = lore.background.split('\n\n')[0];
        parts.push(`\nBackground: ${firstPara}`);
      }

      if (lore.style && lore.style.length > 0) {
        parts.push('\nYour philosophy:');
        lore.style.forEach((s, i) => {
          // Strip markdown bold markers
          parts.push(`${i + 1}. ${s.replace(/\*\*/g, '')}`);
        });
      }

      if (lore.relationships && lore.relationships.length > 0) {
        parts.push('\nYour relationships with other council members:');
        lore.relationships.forEach(r => {
          parts.push(`- ${r.target}: ${r.description}`);
        });
      }

      if (lore.themeSummary) {
        parts.push(`\nCore theme: ${lore.themeSummary.replace(/\n/g, ' ')}`);
      }
    }

    const s = character.stats;
    parts.push(`\nYour game stats: Capital ${s.capital}, Luck ${s.luck}, Negotiation ${s.negotiation}, Charisma ${s.charisma}, Tech ${s.tech}, Stamina ${s.stamina}.`);
    parts.push(`Your ability: ${character.passive.name} — ${character.passive.description}`);

    parts.push('\nRules for your responses:');
    parts.push('- Keep responses to 1-2 sentences max');
    parts.push('- Stay in character always');
    parts.push('- React based on your personality and philosophy');
    parts.push('- Reference your relationships with other characters when relevant');
    parts.push('- Use your character\'s speaking style (formal/casual/cryptic/bold as fits your personality)');
    parts.push('- You may use Chinese expressions or mix languages to reflect your identity');

    return parts.join('\n') + this.buildDialoguePromptExtras(character.id, dialogueContext || {});
  }

  // Assembles the three memory blocks (attitude table / turn digest / diary
  // lines) plus the reply-language instruction into one appended string.
  // `ctx`: { ledgerState, opponents: [{id,name}], digest, diaryLines, locale }.
  // Every field is optional — missing inputs simply omit that block rather
  // than erroring, so this is safe to call with `{}` (no dialogue context
  // available yet, e.g. character-select intro chat).
  buildDialoguePromptExtras(charId, ctx) {
    const c = ctx || {};
    const blocks = [
      formatAttitudeTable(charId, c.ledgerState, c.opponents, this.dialogueRules),
      formatTurnDigest(c.digest, (c.opponents || []).reduce((m, o) => { m[o.id] = o.name; return m; }, {})),
      formatDiaryLines(c.diaryLines),
    ].filter(Boolean);
    const sections = blocks.length ? [blocks.join('\n\n')] : [];
    sections.push(localeInstruction(c.locale));
    return '\n\n' + sections.join('\n\n');
  }

  // Format game event context for the AI
  _formatEventContext(eventType, eventData, gameState) {
    const parts = [];

    if (gameState) {
      if (gameState.turnNumber !== undefined) parts.push(`Turn ${gameState.turnNumber}`);
      if (gameState.season) parts.push(`Season: ${gameState.season}`);
      if (gameState.money !== undefined) parts.push(`Your money: $${gameState.money}`);
      if (gameState.propertyCount !== undefined) parts.push(`Your properties: ${gameState.propertyCount}`);
    }

    switch (eventType) {
      case EVENT_TYPES.ROLL_DICE:
        parts.push(`You rolled ${eventData.d1} + ${eventData.d2} = ${eventData.total}${eventData.isDoubles ? ' (doubles!)' : ''}`);
        break;
      case EVENT_TYPES.LAND_PROPERTY_BUY:
        parts.push(`You landed on ${eventData.spaceName} (unowned, costs $${eventData.price}). You have $${eventData.money}.`);
        break;
      case EVENT_TYPES.LAND_PROPERTY_RENT:
        parts.push(`You landed on ${eventData.spaceName}, owned by ${eventData.ownerName}. You paid $${eventData.rent} in rent.`);
        break;
      case EVENT_TYPES.PAY_TAX:
        parts.push(`You paid $${eventData.amount} in tax.`);
        break;
      case EVENT_TYPES.DRAW_CARD:
        parts.push(`You drew a card: "${eventData.cardText}"`);
        break;
      case EVENT_TYPES.GO_TO_JAIL:
        parts.push(`You were sent to jail! Reason: ${eventData.reason || 'Go To Jail space'}`);
        break;
      case EVENT_TYPES.PASS_GO:
        parts.push(`You passed GO and collected $${eventData.amount}.`);
        break;
      case EVENT_TYPES.BUY_PROPERTY:
        parts.push(`You bought ${eventData.spaceName} for $${eventData.price}.`);
        break;
      case EVENT_TYPES.UPGRADE_PROPERTY:
        parts.push(`You upgraded ${eventData.spaceName} to ${eventData.levelName} for $${eventData.cost}.`);
        break;
      case EVENT_TYPES.AUCTION_START:
        parts.push(`Auction started for ${eventData.spaceName}!`);
        break;
      case EVENT_TYPES.TRADE_PROPOSED:
        parts.push(`A trade was proposed with ${eventData.targetName}.`);
        break;
      case EVENT_TYPES.BANKRUPTCY:
        parts.push(`${eventData.playerName} went bankrupt!`);
        break;
      case EVENT_TYPES.SEASON_CHANGE:
        parts.push(`Season changed to ${eventData.newSeason}.`);
        break;
      case EVENT_TYPES.GAME_OVER:
        parts.push(`Game over! ${eventData.winnerName} wins!`);
        break;
      case EVENT_TYPES.DUEL:
        parts.push(`Duel at ${eventData.propertyName}: ${eventData.challengerName} challenged ${eventData.defenderName} — ${eventData.winnerName} won (${eventData.outcome === 'waived' ? 'rent waived' : 'double rent'}).`);
        break;
    }

    return parts.join(' | ');
  }

  // Format game state for chat context
  _formatGameStateContext(gameState) {
    if (!gameState) return '';
    const parts = [];
    if (gameState.turnNumber !== undefined) parts.push(`Turn ${gameState.turnNumber}`);
    if (gameState.season) parts.push(`Season: ${gameState.season}`);
    if (gameState.money !== undefined) parts.push(`You have $${gameState.money}`);
    if (gameState.propertyCount !== undefined) parts.push(`You own ${gameState.propertyCount} properties`);
    if (gameState.otherPlayers) parts.push(`Other players: ${gameState.otherPlayers}`);
    if (gameState.lastEvent) parts.push(`Last event: ${gameState.lastEvent}`);
    return parts.length > 0 ? '\n\nCurrent game state: ' + parts.join(', ') + '.' : '';
  }

  // Call OpenAI API. `callType` (T2, $3 hard cap — owner decision item 0)
  // prices this call against RULES.dialogue.callPriceUSD; every public
  // method funnels through this SINGLE choke point, so gating here covers
  // every LLM call site (reactions/chat/intro/diary/banter) uniformly.
  async _callApi(messages, model, callType = 'reaction') {
    if (!this.apiKey) throw new Error('No API key configured');

    // Hard cap: checked BEFORE any client/network work — a capped session
    // makes literally zero further fetch() calls. Ledger/digest/chip logic
    // (T1's pure core) is entirely unaffected; only this one choke point is
    // gated. Deliberately ahead of the concurrency guard below: the budget
    // fuse is the more fundamental limit and must win regardless of
    // in-flight request count.
    if (this._budgetExhausted()) return null;

    // Simple concurrency guard (unchanged, pre-existing) — a
    // concurrency-rejected call never reaches the network, so it is NOT
    // pre-charged below (no real spend risk to account for).
    if (this._pendingRequests >= this.maxConcurrent) return null;

    // Pre-charge: booked the instant a call is committed to (not on
    // success), so the estimate/count are monotonic and the hard cap holds
    // even if fetch() itself throws or hangs — "before client invocation"
    // protects the ATTEMPT, matching the owner's intent that the cap can
    // never be exceeded by construction, not merely by accounting after
    // the fact.
    this._spentEstimateUSD += this._priceFor(callType);
    this._callCount += 1;

    this._pendingRequests++;

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: model || this.model,
          messages: messages,
          max_tokens: 150,
          temperature: 0.8,
        }),
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`OpenAI API error ${res.status}: ${errBody}`);
      }

      const data = await res.json();
      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        throw new Error('Unexpected OpenAI response structure');
      }
      return data.choices[0].message.content.trim();
    } finally {
      this._pendingRequests--;
    }
  }

  // Generate an event response (1-2 sentences, fast model). `dialogueContext`
  // (MT2-SP4 T2, optional, 6th param — backward compatible with all existing
  // 5-arg call sites/tests) feeds buildSystemPrompt's memory blocks.
  async respondToEvent(character, lore, eventType, eventData, gameState, dialogueContext) {
    if (!this.shouldRespond(eventType)) return null;

    const systemPrompt = this.buildSystemPrompt(character, lore, dialogueContext);
    const eventContext = this._formatEventContext(eventType, eventData, gameState);

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Game event: ${eventContext}\n\nRespond briefly in character (1-2 sentences).` },
    ];

    try {
      return await this._callApi(messages, this.model, 'reaction');
    } catch (e) {
      console.warn('CharacterAI event response failed:', e.message);
      return null;
    }
  }

  // Season diary (T2): ONE first-person sentence per AI-voiced character per
  // season_changed, mini model. Gated independently on both apiKey AND
  // RULES.dialogue.diaryEnabled (defense in depth — App.js's caller already
  // checks diaryEnabled before invoking this, but this method must also be
  // safe to call directly/standalone, matching chat/introduce's own
  // independent apiKey guards). Failures are caught and return null, never
  // thrown — App.js's fire-and-forget diary trigger relies on that.
  async writeDiaryEntry(character, lore, dialogueContext) {
    if (!this.apiKey) return null;
    if (!this.dialogueRules.diaryEnabled) return null;

    const systemPrompt = this.buildSystemPrompt(character, lore, dialogueContext);
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Write ONE first-person diary sentence reflecting on your recent fortunes and rivalries this season, drawing on your standing and recent history above where relevant. Output only the sentence — no quotes, no preamble.' },
    ];

    try {
      return await this._callApi(messages, this.model, 'diary');
    } catch (e) {
      console.warn('CharacterAI diary entry failed:', e.message);
      return null;
    }
  }

  // Banter line (T2): one side of a reply-pair (see resolveBanterPair),
  // mini model, gated on RULES.dialogue.banterEnabled + apiKey. `situationText`
  // is one of banterSituationText's two strings (already resolved by the
  // caller — this method doesn't know which side of the pair it's voicing).
  async banterLine(character, lore, dialogueContext, situationText) {
    if (!this.apiKey) return null;
    if (!this.dialogueRules.banterEnabled) return null;

    const systemPrompt = this.buildSystemPrompt(character, lore, dialogueContext);
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `${situationText}\n\nRespond briefly and in character, directly addressing the other party (1 sentence).` },
    ];

    try {
      return await this._callApi(messages, this.model, 'banter');
    } catch (e) {
      console.warn('CharacterAI banter line failed:', e.message);
      return null;
    }
  }

  // Multi-turn chat conversation (uses better model). `dialogueContext`
  // (MT2-SP4 T2, optional, 6th param) — same memory blocks as respondToEvent,
  // so chat replies can cite the same real history as event reactions.
  async chat(character, lore, userMessage, history, gameState, dialogueContext) {
    if (!this.apiKey) return null;

    const systemPrompt = this.buildSystemPrompt(character, lore, dialogueContext) +
      this._formatGameStateContext(gameState) +
      '\n\nThe player is chatting with you. Respond conversationally but in-character. You can give game advice based on your personality and strategy style.';

    const messages = [{ role: 'system', content: systemPrompt }];

    // Add conversation history (keep last 10 exchanges = 20 messages)
    const recentHistory = (history || []).slice(-20);
    recentHistory.forEach(msg => {
      messages.push({ role: msg.role, content: msg.content });
    });

    messages.push({ role: 'user', content: userMessage });

    try {
      return await this._callApi(messages, this.chatModel, 'chat');
    } catch (e) {
      console.warn('CharacterAI chat failed:', e.message);
      return null;
    }
  }

  // Quick intro chat for character selection
  async introduce(character, lore) {
    if (!this.apiKey) return null;

    const systemPrompt = this.buildSystemPrompt(character, lore);
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Introduce yourself briefly. Who are you and what\'s your strategy?' },
    ];

    try {
      return await this._callApi(messages, this.model, 'intro');
    } catch (e) {
      console.warn('CharacterAI intro failed:', e.message);
      return null;
    }
  }
}
