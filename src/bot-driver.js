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

// === State-modal bot gate =====================================================
// (Adversarial-review scope fix for the "manage/modal gates during bot turns"
// ticket.) Pure decision for how App.js's renderStateModal treats a blocking
// state whose ACTING seat (per deriveActingSeat above) is bot-controlled:
//
//   'full'              — acting seat is human: render everything as normal.
//   'trade-cancel-only' — acting seat is a bot AND the blocking state is a
//                         pending trade proposed by a HUMAN. The trade target
//                         (the bot) owns accept/reject — its driver dispatches
//                         those — but Cancel belongs to the PROPOSER (Game.js
//                         cancelTrade requires proposerId === ctx.currentPlayer).
//                         Hiding the whole modal here would strand the human
//                         proposer with zero UI for the pending window — and
//                         with NO cancel path at all if the bot driver ever
//                         wedged (e.g. animBusy stuck true) — so the modal
//                         stays up with only the bot's accept/reject hidden.
//   'hidden'            — acting seat is a bot in any other blocking state
//                         (bot's own card prompt, bot bidder's auction turn),
//                         or a bot-proposed trade pending on a bot target:
//                         nothing in the modal belongs to a human, hide it.
//
// Same injected-predicate convention as createBotDriver's deps.isBot — this
// module never reads App state directly, so the decision stays unit-testable
// with plain fixtures.
export function stateModalBotMode(G, ctx, isBot) {
  if (!isBot(deriveActingSeat(G, ctx))) return 'full';
  if (G.trade && G.turnPhase === 'trade') {
    // Cancel is the proposer's move — if the proposer is ALSO a bot (no such
    // flow exists today: sim/bot's decideMoves never proposes trades — but
    // cheap to be exact), no human owns anything in the modal either.
    return isBot(String(G.trade.proposerId)) ? 'hidden' : 'trade-cancel-only';
  }
  return 'hidden';
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

// === Trade response (Finding 2 fix) ===========================================
// sim/bot.js's decideMoves (src/sim/bot.js:195-252) has NO branch for G.trade
// — it was never taught about the trade mechanism at all (verified by reading
// the whole function). Without this, a bot targeted by a pending trade (see
// deriveActingSeat above: G.trade always resolves the acting seat to
// G.trade.targetPlayerId) would fall through decide()'s priority chain all
// the way to endTurn, which the engine unconditionally rejects while a trade
// is pending (Game.js's move-guard list keeps G.turnPhase === 'trade' pinned
// until acceptTrade/rejectTrade/cancelTrade resolves it — proposeTrade sets
// G.turnPhase = 'trade' at Game.js:1722) — an INVALID_MOVE dispatched forever
// on every paced step, freezing that seat's turn.
//
// G.trade shape (created by proposeTrade, Game.js:1714-1721):
//   { proposerId, targetPlayerId, offeredProperties, requestedProperties,
//     offeredMoney, requestedMoney }
// offeredProperties/offeredMoney flow proposer -> target; requestedProperties/
// requestedMoney flow target -> proposer (see the transfer loops inside
// acceptTrade, Game.js:1782-1803). acceptTrade/rejectTrade take NO extra
// move args beyond (G, ctx) — both moves resolve everything from G.trade
// itself (Game.js:1741 acceptTrade, Game.js:1813 rejectTrade) — so the move
// tuples below are single-element (['acceptTrade'] / ['rejectTrade']), same
// convention as sim/bot.js's own zero-arg move tuples (e.g. ['endTurn']).
export const DEFAULT_TRADE_POLICY = Object.freeze({
  // Accept when net value to the acting seat >= this threshold; reject
  // otherwise. 0 = accept anything at least break-even. Policy-tunable
  // (CLAUDE.md: no inline magic numbers) rather than a hardcoded 0 check.
  tradeAcceptThreshold: 0,
  // Fraction of face price a MORTGAGED property counts for in the net-value
  // sum (on either side of the trade). Mirrors the engine's own mortgaged-
  // property valuation convention in getTotalAssets (Game.js:644-659,
  // specifically 647-652: "A mortgaged property is worth its mortgage value
  // ... not its full price") which uses RULES.core.mortgageRate (0.5 in the
  // dominion mod, mods/dominion/rules.js:16). Kept as a local policy default
  // here instead of importing RULES — bot-driver.js deliberately has zero
  // import-time coupling to any mods/ package (Design Decision 2,
  // task-1-report.md), since the repo hosts multiple mods with their own
  // rules modules. If no engine convention existed this would just be a
  // bare 0.5; one does exist, so this value mirrors it exactly.
  mortgagedPropertyRate: 0.5,
});

// Face-value price of a board space, discounted per mortgagedPropertyRate if
// currently mortgaged. Reads G.board.spaces[pid].price the same way sim/
// bot.js resolves space prices (see buyDecision/auctionDecision above,
// src/sim/bot.js:279/293: `G.board.spaces[...].price`), and G.mortgaged[pid]
// the same way calculateRent/getTotalAssets read it in Game.js.
function tradePropertyValue(G, pid, rate) {
  const space = G.board.spaces[pid];
  const price = space ? space.price : 0;
  return G.mortgaged && G.mortgaged[pid] ? Math.floor(price * rate) : price;
}

// Pure: decides how the acting `seat` should respond to a pending G.trade.
// Net value TO `seat` = (incoming money + incoming properties' price sum)
// - (outgoing money + outgoing properties' price sum); accepts when net >=
// policy.tradeAcceptThreshold, else rejects. "Incoming"/"outgoing" are
// resolved relative to `seat` (not hardcoded to the target side) so the
// function stays correct even if ever called for the proposer's seat —
// though in practice only the target can dispatch acceptTrade/rejectTrade
// (Game.js:1743/1815 requireActor(..., G.trade.targetPlayerId)), so
// createBotDriver only ever calls this once it has confirmed
// seat === G.trade.targetPlayerId.
export function decideTradeResponse(G, seat, policy) {
  const pol = Object.assign({}, DEFAULT_TRADE_POLICY, policy || {});
  const trade = G.trade;
  const actingIsTarget = String(seat) === String(trade.targetPlayerId);
  const incomingProperties = actingIsTarget ? trade.offeredProperties : trade.requestedProperties;
  const outgoingProperties = actingIsTarget ? trade.requestedProperties : trade.offeredProperties;
  const incomingMoney = actingIsTarget ? trade.offeredMoney : trade.requestedMoney;
  const outgoingMoney = actingIsTarget ? trade.requestedMoney : trade.offeredMoney;

  const incomingValue = (incomingMoney || 0) + (incomingProperties || [])
    .reduce((sum, pid) => sum + tradePropertyValue(G, pid, pol.mortgagedPropertyRate), 0);
  const outgoingValue = (outgoingMoney || 0) + (outgoingProperties || [])
    .reduce((sum, pid) => sum + tradePropertyValue(G, pid, pol.mortgagedPropertyRate), 0);

  const net = incomingValue - outgoingValue;
  return net >= pol.tradeAcceptThreshold ? [['acceptTrade']] : [['rejectTrade']];
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
//   onError(err) (optional) -> defaults to console.error. Called whenever a
//                             step throws (see "error recovery" below) INSTEAD
//                             of the error being swallowed — same "no API key
//                             = game still works, but errors aren't silently
//                             eaten" idiom as character-ai.js.
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
//   - pending trade targeting the acting bot (G.trade, seat ===
//     G.trade.targetPlayerId per deriveActingSeat): resolved via
//     decideTradeResponse() BEFORE decide() is ever consulted, same reason
//     and same pattern as the G.awaitingRoute special-case above — sim/
//     bot.js's decideMoves has no G.trade branch at all (see
//     decideTradeResponse's file comment for the full explanation), so
//     calling decide() here would eventually dispatch a rejected endTurn
//     forever instead of ever resolving the trade.
//   - error recovery (fix wave 2 — see guardedStep() below): the ENTIRE
//     scheduled chain is error-guarded, not just act()/actCharacterSelect().
//     A throw from ANY injected dep this module calls while a step is
//     in-flight — decide/decideRoute/dispatch/getCharacterIds/getState/
//     animBusy, at ANY point in the chain (the synchronous prefix that runs
//     inside onUpdate(), a deferred animPoll recheck, or the final paced
//     act() timer) — is reported via onError(err) instead of propagating,
//     and ALWAYS releases the single-flight `scheduled` flag, so the NEXT
//     onUpdate() (fired by the app's normal client.subscribe on the next
//     state change, or the bot's own already-scheduled following turn) can
//     always schedule a fresh step regardless of whether the previous one
//     threw partway through, at any hop.
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
    onError = console.error,
  } = deps;

  let epoch = 0;
  let scheduled = false; // single-flight guard
  let timerHandle = null;
  // Transient: was the most recently DISPATCHED move a roll? Drives the
  // postRoll-vs-think delay choice for the very next step only (not derived
  // from G.hasRolled, which stays true for the rest of the turn).
  let lastActionWasRoll = false;

  function finish() {
    scheduled = false;
  }

  // === Fix wave 2: ONE error boundary for the WHOLE scheduled chain ==========
  // Fix wave 1 (d2b5416) wrapped act()'s and actCharacterSelect()'s own
  // bodies in try/catch/finally, but left waitForAnim() and beginStep()
  // themselves completely unguarded — both run OUTSIDE any try/catch, once
  // as the synchronous prefix onUpdate() calls directly, and again as the
  // body of every animPoll recheck timer. animBusy() throwing (at the first
  // synchronous check, or inside a later animPoll recheck) or getState()
  // throwing (inside beginStep's own delay-choosing callback) therefore
  // escaped uncaught, never reached act()'s try/catch at all, and
  // permanently wedged `scheduled = true` — the exact bug this wave exists
  // to close (re-review PROVED it with reproductions; see task-1-report.md
  // "Fix wave 2").
  //
  // guardedStep(myEpoch, fn, terminal) is now the ONLY place in this module
  // that (a) checks the epoch guard, (b) catches a throw from `fn`, (c)
  // reports it via onError, and (d) releases the single-flight `scheduled`
  // flag. EVERY timer callback in the chain (an animPoll recheck, or the
  // final think/postRoll/charPick-delayed act() call) and the ONE
  // synchronous prefix that runs inside onUpdate() (the initial call into
  // beginStep()) funnel through this single helper — replacing fix wave 1's
  // per-function try/catch/finally, which also produced a "double-finish"
  // smell: actCharacterSelect() had its own nested try/catch/finally INSIDE
  // act()'s try/catch/finally, so a throw in actCharacterSelect() called
  // finish() twice for the same error (harmless since finish() is
  // idempotent, but exactly the kind of sprinkled-guard confusion this
  // rewrite eliminates — actCharacterSelect() no longer has any try/catch of
  // its own; act()'s wrapping guardedStep call is now the only guard on that
  // path too).
  //
  // `terminal` distinguishes the two kinds of guarded hop in this chain:
  //   - non-terminal (false): a CONTINUATION step — on SUCCESS it schedules
  //     more work of its own (another animPoll recheck, or the final act()
  //     timer) and must NOT release `scheduled` yet, since the chain isn't
  //     done. On FAILURE it still must release `scheduled` — nothing further
  //     in the chain will ever run to do it otherwise (that's the wedge).
  //   - terminal (true): the chain's actual last hop — act() itself, which
  //     performs the one dispatch this step ever makes (or legitimately
  //     no-ops, e.g. the stuck guard or a non-bot seat). On success OR
  //     failure this is always the end of the chain, so `scheduled` is
  //     released either way.
  // A stray callback whose epoch no longer matches the current `epoch`
  // (stop() ran, or it fired after a newer chain already started) is a pure
  // no-op: it must not call onError, and must not call finish() either —
  // doing so could incorrectly release a DIFFERENT, currently in-flight
  // chain's single-flight flag.
  function guardedStep(myEpoch, fn, terminal) {
    if (myEpoch !== epoch) return; // stale: stop() ran, or a newer chain superseded this hop
    try {
      fn();
      if (terminal) finish();
    } catch (err) {
      onError(err);
      finish();
    }
  }

  function schedule(delay, myEpoch, fn, terminal) {
    timerHandle = setTimeoutImpl(() => {
      timerHandle = null;
      guardedStep(myEpoch, fn, terminal);
    }, delay);
  }

  // Seat that should act right now, for either phase.
  function currentActingSeat(G, ctx) {
    return G.phase === 'characterSelect' ? String(ctx.currentPlayer) : deriveActingSeat(G, ctx);
  }

  // Continuation step: animBusy() throwing here (first synchronous check OR
  // a later deferred recheck) is caught by whichever guardedStep call is
  // currently running this function (the onUpdate-entry guard for the first
  // synchronous check, or the animPoll timer's own guard for a recheck).
  function waitForAnim(myEpoch, cb) {
    if (!animBusy()) {
      cb();
      return;
    }
    schedule(BOT_DELAYS.animPoll, myEpoch, () => waitForAnim(myEpoch, cb), false);
  }

  // Continuation step: getState() throwing inside the delay-choosing
  // callback is caught by whichever guardedStep call is currently running
  // this function, same as waitForAnim above.
  function beginStep(myEpoch) {
    waitForAnim(myEpoch, () => {
      const { G } = getState();
      const delay = G.phase === 'characterSelect'
        ? BOT_DELAYS.charPick
        : (lastActionWasRoll ? BOT_DELAYS.postRoll : BOT_DELAYS.think);
      schedule(delay, myEpoch, () => act(), true);
    });
  }

  // Plain function, no try/catch of its own — guardedStep (above) is the
  // sole error boundary and sole owner of finish() for every path that
  // reaches this body (called only from inside act(), which itself only
  // ever runs as the terminal hop of a guardedStep call; see guardedStep's
  // own comment for why a second, nested guard here would double-finish).
  function actCharacterSelect(G, ctx) {
    const seat = String(ctx.currentPlayer);
    if (!isBot(seat)) return;
    if (typeof getCharacterIds !== 'function') return; // graceful no-op (no roster dep wired)
    const ids = getCharacterIds() || [];
    const taken = new Set(G.players.filter(p => p.character).map(p => p.character.id));
    const candidates = ids.filter(id => !taken.has(id));
    if (candidates.length === 0) return;
    const idx = Math.min(Math.floor(rngImpl() * candidates.length), candidates.length - 1);
    dispatch('selectCharacter', candidates[idx]);
    lastActionWasRoll = false;
  }

  // Plain function, no try/catch of its own (see actCharacterSelect's
  // comment above — same reasoning) — always invoked as the terminal hop of
  // a guardedStep call (via schedule(..., true) in beginStep), which is the
  // sole error boundary now.
  function act() {
    const { G, ctx } = getState();
    if (ctx.gameover) return;

    if (G.phase === 'characterSelect') {
      actCharacterSelect(G, ctx);
      return;
    }

    const seat = deriveActingSeat(G, ctx);
    if (!isBot(seat)) return;

    // Finding 2 fix (fix wave 1): sim/bot.js's decide() has no G.trade
    // branch (see decideTradeResponse's file comment above) — resolve a
    // pending trade targeting this seat directly, BEFORE ever consulting
    // decide(), same reasoning as the G.awaitingRoute special-case
    // immediately below.
    if (G.trade && seat === String(G.trade.targetPlayerId)) {
      const [name, ...args] = decideTradeResponse(G, seat)[0];
      // Minor fix (wave 2): reset the roll-pacing flag BEFORE dispatch(),
      // not after. This step is "finished" either way (accept/reject
      // resolved, or dispatch() throws and guardedStep aborts the chain) —
      // a throw here must not leave a stale `true` behind, which would
      // wrongly slow the NEXT successful step's think-vs-postRoll choice
      // even though this step never rolled anything.
      lastActionWasRoll = false;
      dispatch(name, ...args);
      return;
    }

    // The one state decide() can't re-derive on its own (see file-header
    // comment) — resolve it directly instead of consulting decide().
    if (G.awaitingRoute) {
      const route = decideRoute(G, ctx, seat);
      dispatch('commitRoute', route);
      lastActionWasRoll = false;
      return;
    }

    const moves = decide(G, ctx, seat);
    if (!moves || moves.length === 0) return; // stuck guard — no-op, releases single-flight
    const [name, ...args] = moves[0];
    dispatch(name, ...args);
    lastActionWasRoll = (name === 'rollDice' || name === 'rollOnly');
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
      // The synchronous entry into the chain: beginStep() itself, and
      // waitForAnim()'s first synchronous animBusy() check nested inside it,
      // both run HERE, synchronously, inside this guardedStep call — not
      // inside a setTimeout — so this is the "synchronous prefix" fix wave
      // 2 closes. Non-terminal: on success it only ever SCHEDULES further
      // work (an animPoll recheck or the paced act() timer); the chain's
      // actual dispatch happens later, in act(), as the terminal hop.
      guardedStep(epoch, () => beginStep(epoch), false);
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
