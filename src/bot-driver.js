// Local-bots — PURE core (Task 1). Seat derivation, bot personality styles,
// and a paced single-flight dispatch stepper for the INTERACTIVE app (as
// opposed to src/sim/match.js's headless, unpaced, synchronous-Client sim
// runner). This module is deliberately decoupled from boardgame.io's Client
// and from Game.js: everything the stepper needs to read state, dispatch a
// move, decide a move, or check UI readiness is INJECTED via `deps`, so it
// stays unit-testable with plain fixtures (mirrors src/sim/bot.js's own
// "PURE decision logic" discipline, extended here with a real-time pacing
// layer since a human is watching this run, unlike the sim).
//
// boardgame.io v0.45 OLD positional API note (CLAUDE.md): every move this
// module ends up dispatching is shaped move(G, ctx, ...args) on the engine
// side, but this module never calls a move directly — it only ever calls the
// injected `dispatch(name, ...args)`, which the wiring layer (a later task)
// binds to `client.moves[name](...args)`.

// === Seat derivation ==========================================================
// Mirrors match.js's own acting-seat special-case (match.js:126-129, auction
// only) and extends it to the two other genuine cross-seat blocking states
// Game.js exposes (duel response, pending trade) — verified against the real
// engine shapes, not invented:
//   - G.auction = { propertyId, currentBid, bidders: [{playerId, passed}],
//     currentBidderIndex } — Game.js:1621-1627 (created), 1846/1869 require
//     the CURRENT bidder as actor.
//   - G.duel = { phase: 'offer'|'response', propertyId, ownerId,
//     challengerId, rent } — Game.js:548-550 (created on landing, always
//     during the CHALLENGER's own turn, so 'offer' needs no special-casing:
//     ctx.currentPlayer already IS challengerId). Game.js:1934-1936
//     (respondDuel) / 1981-1983 (declineDuel) require the OWNER
//     (G.duel.ownerId) as actor once phase flips to 'response' — the
//     DEFENDER's fight/decline decision.
//   - G.trade = { proposerId, targetPlayerId, offeredProperties,
//     requestedProperties, offeredMoney, requestedMoney } — Game.js:1714-1721
//     (created by proposeTrade, always during the proposer's own turn).
//     Game.js:1741-1743 (acceptTrade) / 1813-1815 (rejectTrade) require the
//     TARGET (G.trade.targetPlayerId) as actor while the proposal is pending.
// Order doesn't matter in practice — the engine's own guards make
// auction/duel/trade mutually exclusive (e.g. proposeTrade rejects when
// G.duel is set, Game.js:1674) — but auction is checked first to mirror
// match.js's precedent exactly.
export function deriveActingSeat(G, ctx) {
  if (G.auction) {
    const bidderEntry = G.auction.bidders[G.auction.currentBidderIndex];
    return String(bidderEntry.playerId);
  }
  if (G.duel && G.duel.phase === 'response') {
    return String(G.duel.ownerId);
  }
  if (G.trade) {
    return String(G.trade.targetPlayerId);
  }
  return String(ctx.currentPlayer);
}

// === Bot personality styles ===================================================
// Named PARTIAL policy presets over sim/bot's DEFAULT_POLICY (src/sim/bot.js).
// Deliberately kept as plain data (not an import of sim/bot's DEFAULT_POLICY)
// so this module has zero runtime coupling to the sim/engine module graph —
// a partial policy composes correctly with sim/bot's own resolvePolicy()
// (`Object.assign({}, DEFAULT_POLICY, policy)`) purely by virtue of only
// setting a subset of known keys, exactly like sim/bot.js's own doc comment
// describes partial policies being merged. The wiring layer (a later task)
// is expected to pass `policyForSeat(seat)` straight into
// decideMoves(G, ctx, seat, policyForSeat(seat)) (or its own decide()
// closure that does the same) — decideMoves' resolvePolicy() call does the
// actual merge, so this module never needs to know DEFAULT_POLICY's shape.
export const BOT_STYLES = Object.freeze([
  Object.freeze({
    id: 'builder',
    // Aggressive developer: spends down to a thin cash buffer to keep
    // building, and tours the map (routeStrategy) to grow its footprint.
    policy: Object.freeze({ cashBuffer: 100, buildAggression: 0.75, routeStrategy: 'tourer' }),
  }),
  Object.freeze({
    id: 'hoarder',
    // Risk-averse: sits on a large cash buffer, builds reluctantly
    // (buildAggression > 1 raises the bar), bids conservatively at auction,
    // stays near its own cluster (camper), and never escalates a rent duel.
    policy: Object.freeze({
      cashBuffer: 400, buildAggression: 1.5, auctionMaxFraction: 0.4,
      routeStrategy: 'camper', duelPolicy: 'never',
    }),
  }),
  Object.freeze({
    id: 'duelist',
    // Confrontational: always escalates a rent duel when challenging, bids
    // aggressively at auction, and tours for more duel opportunities.
    policy: Object.freeze({
      cashBuffer: 150, auctionMaxFraction: 0.75, duelPolicy: 'always', routeStrategy: 'tourer',
    }),
  }),
]);

// Deterministic round-robin: seat '0' -> BOT_STYLES[0], seat '1' ->
// BOT_STYLES[1], ... wrapping. Never random, so two calls for the same seat
// (or a re-run) always agree — required for reproducible bot behavior and
// for tests.
export function policyForSeat(seat) {
  const n = parseInt(seat, 10);
  const idx = Number.isNaN(n) ? 0 : Math.abs(n) % BOT_STYLES.length;
  return BOT_STYLES[idx].policy;
}

// === Pacing constants ==========================================================
// Frozen; every delay the stepper uses lives here (CLAUDE.md: no inline
// magic numbers). Values are the brief's exact spec.
//   think:     default pause before a bot dispatches its next decision.
//   postRoll:  pause used for the step immediately following a roll
//              (rollDice/rollOnly) — longer than `think` so a dice/roll
//              animation in the app has time to visually resolve before the
//              bot's very next action (e.g. committing a route, or buying).
//   charPick:  pause before a bot auto-selects a character.
//   animPoll:  re-check interval while animBusy() holds the stepper.
export const BOT_DELAYS = Object.freeze({
  think: 700,
  postRoll: 1100,
  charPick: 600,
  animPoll: 150,
});

// === Paced dispatch stepper ====================================================
// createBotDriver(deps) -> { onUpdate(), stop() }
//
// deps (dependency-injected so this stays engine-decoupled and unit-testable):
//   getState()             -> { G, ctx } — mirrors client.getState()'s shape.
//   dispatch(name, ...args)-> forwards to client.moves[name](...args); no
//                             seat argument (local hot-seat play has
//                             G.enforceSeats=false, so requireActor(Game.js:
//                             159-161) short-circuits true for any seat —
//                             seat ROUTING for online play is a later task's
//                             concern, out of scope here).
//   decide(G, ctx, seat)    -> ordered move-tuple array for `seat`, already
//                             bound to that seat's resolved policy by the
//                             caller (mirrors sim/bot.js's decideMoves, minus
//                             the policy plumbing — the caller is expected to
//                             close over policyForSeat(seat)).
//   decideRoute(G, ctx, seat) -> a route array for commitRoute (mirrors
//                             sim/bot.js's decideRoute, same seat-bound
//                             convention as `decide`).
//   isBot(seat)             -> true if `seat` is a bot-controlled player.
//   animBusy()              -> true while a UI animation should hold the
//                             stepper before it dispatches.
//   setTimeoutImpl / clearTimeoutImpl (optional) -> default to the global
//                             setTimeout/clearTimeout; injectable so tests
//                             can use jest.useFakeTimers() transparently (or
//                             swap a custom scheduler).
//   getCharacterIds() (optional) -> full roster of selectable character ids
//                             for the ACTIVE mod. NOT in the brief's literal
//                             deps list, but required to implement
//                             "auto-pick a random UNTAKEN character" at all —
//                             this module is mod-agnostic (the engine now
//                             hosts 7 mods with different rosters; see
//                             Game.js's `_activeMod` indirection), so the
//                             roster can only come from the caller. Omitting
//                             it is safe: character-select auto-pick simply
//                             no-ops (graceful fallback, same idiom as this
//                             codebase's "no AI API key = game still works"
//                             pattern in character-ai.js) rather than
//                             throwing.
//   rngImpl (optional)      -> defaults to Math.random; the ONE extra dep the
//                             task brief itself calls out by name, so tests
//                             can make character auto-pick deterministic.
//
// Behavior:
//   - single-flight: onUpdate() is a no-op while a step is already scheduled
//     for the current bot turn (only one pending timer chain at a time).
//   - epoch guard: stop() bumps an epoch counter and clears the pending
//     timer; any in-flight scheduled callback checks the epoch before doing
//     anything, so a stray already-fired-but-queued microtask can never
//     dispatch after stop().
//   - character-select phase (G.phase === 'characterSelect'): after a
//     charPick delay, auto-picks a random character id (via rngImpl) from
//     getCharacterIds() that no G.players[*].character has already claimed
//     (Game.js:1285's own duplicate-selection guard, mirrored read-only
//     here) for ctx.currentPlayer (selectCharacter's required actor —
//     Game.js:1278) — but only if isBot(ctx.currentPlayer).
//   - play phase: dispatches exactly ONE move tuple per step —
//     moves[0] from decide(G, ctx, seat), where seat comes from
//     deriveActingSeat. decide() can return more than one tuple in a single
//     call (e.g. sim/bot.js's rollMoves pairs ['rollOnly'] with a deferred
//     ['commitRoute', null] — src/sim/bot.js:259-264); this stepper never
//     drains that tail in the same tick (that's what "ONE move tuple per
//     step" means) — it re-evaluates from a FRESH state read on the next
//     step instead. The one state decide() genuinely cannot re-derive from
//     scratch is G.awaitingRoute (sim/bot.js's decideMoves has no branch for
//     it — see src/sim/bot.js:195-252), so this stepper checks
//     G.awaitingRoute BEFORE consulting decide() at all and, when true,
//     calls decideRoute() on freshly re-read state instead — the same
//     re-read-then-decideRoute move match.js performs inline at lines
//     139-148, just split across a paced tick instead of done synchronously.
//   - waits on animBusy(), re-polling every animPoll ms, before every step's
//     think/postRoll delay begins.
//   - gameover (ctx.gameover truthy): no-op, nothing is ever scheduled.
export function createBotDriver(deps) {
  const {
    getState,
    dispatch,
    decide,
    decideRoute,
    isBot,
    animBusy,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
    getCharacterIds,
    rngImpl = Math.random,
  } = deps;

  let epoch = 0;
  let scheduled = false; // single-flight guard
  let timerHandle = null;
  // Transient: was the most recently DISPATCHED move a roll? Drives the
  // postRoll-vs-think delay choice for the very next step only (not derived
  // from G.hasRolled, which stays true for the rest of the turn).
  let lastActionWasRoll = false;

  function schedule(delay, myEpoch, fn) {
    timerHandle = setTimeoutImpl(() => {
      timerHandle = null;
      if (myEpoch !== epoch) return; // stop() ran since this was queued
      fn();
    }, delay);
  }

  function finish() {
    scheduled = false;
  }

  // Seat that should act right now, for either phase.
  function currentActingSeat(G, ctx) {
    return G.phase === 'characterSelect' ? String(ctx.currentPlayer) : deriveActingSeat(G, ctx);
  }

  function waitForAnim(myEpoch, cb) {
    if (!animBusy()) {
      cb();
      return;
    }
    schedule(BOT_DELAYS.animPoll, myEpoch, () => waitForAnim(myEpoch, cb));
  }

  function beginStep(myEpoch) {
    waitForAnim(myEpoch, () => {
      const { G } = getState();
      const delay = G.phase === 'characterSelect'
        ? BOT_DELAYS.charPick
        : (lastActionWasRoll ? BOT_DELAYS.postRoll : BOT_DELAYS.think);
      schedule(delay, myEpoch, () => act(myEpoch));
    });
  }

  function actCharacterSelect(G, ctx) {
    const seat = String(ctx.currentPlayer);
    if (!isBot(seat)) { finish(); return; }
    if (typeof getCharacterIds !== 'function') { finish(); return; } // graceful no-op (no roster dep wired)
    const ids = getCharacterIds() || [];
    const taken = new Set(G.players.filter(p => p.character).map(p => p.character.id));
    const candidates = ids.filter(id => !taken.has(id));
    if (candidates.length === 0) { finish(); return; }
    const idx = Math.min(Math.floor(rngImpl() * candidates.length), candidates.length - 1);
    dispatch('selectCharacter', candidates[idx]);
    lastActionWasRoll = false;
    finish();
  }

  function act(myEpoch) {
    if (myEpoch !== epoch) return;
    const { G, ctx } = getState();
    if (ctx.gameover) { finish(); return; }

    if (G.phase === 'characterSelect') {
      actCharacterSelect(G, ctx);
      return;
    }

    const seat = deriveActingSeat(G, ctx);
    if (!isBot(seat)) { finish(); return; }

    // The one state decide() can't re-derive on its own (see file-header
    // comment) — resolve it directly instead of consulting decide().
    if (G.awaitingRoute) {
      const route = decideRoute(G, ctx, seat);
      dispatch('commitRoute', route);
      lastActionWasRoll = false;
      finish();
      return;
    }

    const moves = decide(G, ctx, seat);
    if (!moves || moves.length === 0) { finish(); return; } // stuck guard — no-op, releases single-flight
    const [name, ...args] = moves[0];
    dispatch(name, ...args);
    lastActionWasRoll = (name === 'rollDice' || name === 'rollOnly');
    finish();
  }

  return {
    onUpdate() {
      if (scheduled) return; // single-flight: a step is already in-flight
      const state = getState();
      if (!state) return;
      const { G, ctx } = state;
      if (!G || !ctx || ctx.gameover) return;
      const seat = currentActingSeat(G, ctx);
      if (!isBot(seat)) return;
      scheduled = true;
      beginStep(epoch);
    },
    stop() {
      epoch++; // invalidate any pending scheduled callback
      if (timerHandle !== null) {
        clearTimeoutImpl(timerHandle);
        timerHandle = null;
      }
      scheduled = false;
    },
  };
}
