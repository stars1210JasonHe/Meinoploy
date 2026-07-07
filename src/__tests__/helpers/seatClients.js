// Task 10: cross-client seat authorization tests — real Local() master round trip.
//
// Task 9 landed `requireActor` guards + `setActivePlayers` envelopes (src/Game.js),
// enforced ONLY when `G.enforceSeats` is true, gated behind direct `moves.X()` unit
// tests (src/__tests__/engine-seats-unit.test.js). This helper drives the SAME
// authorization surface over the REAL boardgame.io dispatch path: N distinct
// `Client()`s wired to a shared `Local()` master, each pinned to one seat via
// `playerID`. Authorization here is enforced by TWO independent layers, both
// exercised by every test that uses this helper:
//   1. boardgame.io's OWN structural gate — `Master.onUpdate` rejects any action
//      whose dispatching `playerID` is not "active" per
//      `game.flow.isPlayerActive(G, ctx, playerID)`
//      (node_modules/boardgame.io/dist/esm/reducer-763b001e.js ~L631): by default
//      that's `ctx.currentPlayer === playerID`; once `setActivePlayers` has widened
//      `ctx.activePlayers` for a trade/auction window, it's playerID-in-that-map
//      membership. This layer stops any seat NOT even nominally on the clock.
//   2. Our own `requireActor` (src/Game.js), gated by `G.enforceSeats` — this is the
//      layer that matters for the two genuine cross-seat exceptions (trade target,
//      acting bidder): once layer 1 widens activePlayers to include a non-current
//      seat, layer 1 no longer distinguishes WHICH move that seat may call (any
//      move in `moves:{}` is nominally reachable by any active playerID) — layer 2
//      is what stops the trade target from calling a currentPlayer-only move like
//      `useReroll` while they're legitimately active for `acceptTrade`/`rejectTrade`.
//
// Local() transport notes (verified against node_modules/boardgame.io/dist/esm, not
// guessed — see task-10-report.md for the full trace):
//   - `Local()`'s shared `LocalMaster` registry (`localMasters` Map in
//     socketio-b63c9ee2.js) is keyed by the GAME OBJECT REFERENCE passed to
//     `Client({ game })` (`gameKey: game` in client-5202a476.js). Every test case
//     MUST build its OWN fresh game-def object — this factory does that per call —
//     or unrelated test cases will silently share master state/storage.
//   - Local()'s public `Client()` API has no `setupData` channel, so `enforceSeats`
//     is injected by WRAPPING `setup()` (same workaround
//     engine-seats-unit.test.js's client-round-trip test already uses).
//   - `LocalMaster` never configures `auth` (`super(game, storage, transportAPI)` —
//     3 args, no 4th `auth` arg — master-41ed1c81.js L102/213), so credential
//     verification (`this.auth.authenticateCredentials`) NEVER runs for Local().
//     The ONLY boundary Local() enforces is playerID-based `isPlayerActive`
//     membership — a client can claim any playerID string at construction with any
//     (or no) `credentials` value and Local() will treat it as that seat with zero
//     verification. Real credential AUTH is a SocketIO/server-auth concern, entirely
//     out of scope for Local(). See task-10-report.md item 6 for the dedicated test
//     and what it does/doesn't prove.
//   - EVERY move here is dispatched as a long-form `{ move: fn, client: false }`
//     (built below, NOT a change to the real `Monopoly.moves` — this seatGame is a
//     fresh, test-only wrapper). `client: false` tells boardgame.io's reducer to
//     skip CLIENT-SIDE optimistic execution entirely (reducer-763b001e.js L984,
//     `if (isClient && move.client === false) { return state; }` — a check that
//     runs BEFORE the client's own local `isPlayerActive` gate) and defer 100% to
//     the master's authoritative broadcast. This was NOT a style choice — it fixes
//     a genuine v0.45 crash reproduced and root-caused during this task: a move the
//     CLIENT'S OWN local reducer rejects at the structural `isPlayerActive` gate
//     sets a transient error, which `TransientHandlingMiddleware` reacts to by
//     internally re-dispatching a `stripTransients()` action; that action has no
//     `clientOnly` marker, so `TransportMiddleware` relays it to the Local() master
//     like any real move — but it also has no `.payload`, and `Master.onUpdate`
//     unconditionally destructures `credAction.payload` while stripping
//     credentials, throwing. Because `onUpdate` is an `async function`, that throw
//     becomes an UNHANDLED PROMISE REJECTION (never awaited by
//     `LocalTransport.onAction`), which Jest attributes to whichever test is
//     currently running regardless of any local try/catch OR a
//     `process.on('unhandledRejection', ...)` filter (both were tried and
//     confirmed ineffective under Jest's own environment hooks). `client: false`
//     sidesteps the whole chain at its root: with no client-side optimistic
//     execution, the client-side reducer never rejects, never sets a transient,
//     and never triggers the relay. `game.processMove` (used by the MASTER, the
//     only place that must actually run the move) correctly unwraps this long-form
//     shape via `IsLongFormMove`/`moveFn.move` (reducer-763b001e.js L723-728), so
//     real authorization/game-logic behavior is identical to the un-wrapped moves —
//     only the client's redundant local pre-check is disabled. A side benefit:
//     every dispatch now behaves uniformly (state changes ONLY via the master's
//     async broadcast, never via a synchronous local guess), which is exactly what
//     dispatchAndWait already assumes.
import { Client } from 'boardgame.io/client';
import { Local } from 'boardgame.io/multiplayer';
import { Monopoly, setActiveMap } from '../../Game';
import { loadMap } from '../../map-loader';
import classicMapJson from '../../../mods/dominion/maps/classic/map.json';

// Build numPlayers Client()s over a FRESH seatGame object (see header — never a
// shared module-level constant), each pinned to seat String(i) via playerID, wired
// to a shared Local() master. `enforceSeats` defaults true (this suite's whole
// point).
//
// `patchG(G, ctx)` — optional — lets a test jump straight to a scenario-specific G
// (a pending trade, a pending auction, prebuilt ownership/buildings/rerollsLeft)
// WITHOUT driving character-select + real dice through the wire first. This is
// deliberate: Task 9's unit suite already exhaustively covers the game-logic paths
// that PRODUCE these states (proposeTrade, passProperty's auction-start, placeBid
// rotation, bankruptcy interleavings); Task 10's job is proving authorization over
// the real dispatch path for a move made FROM that state, not re-proving how the
// state arises. CAVEAT: `turn.onBegin` (src/Game.js) unconditionally resets
// hasRolled/canBuy/pendingCard/awaitingRoute/lastDice/doublesCount to their
// turn-start defaults the instant G.phase leaves 'characterSelect' — and it runs
// once, automatically, immediately after setup() as part of match
// initialization — so patchG CANNOT durably set those specific fields (verified:
// instrumented and observed the reset firsthand). Only fields onBegin doesn't
// touch (ownership/buildings/players/trade/auction/mortgaged/rerollsLeft) survive
// a patchG injection; hasRolled must instead come from a REAL `rollDice` dispatch
// (see the pinned SEED 8 in engine-seats.test.js for the trade-window scenarios
// that need a deterministic, card/jail-free landing).
//
// setActiveMap() mirrors drive.js's makeClient(): called BEFORE constructing any
// client so Monopoly.setup() snapshots the classic board into G.board, and pinned
// explicitly (never relies on Game.js's default _pendingMap) so this suite is
// immune to another test file in the same Jest module registry having left a
// different map/mod active.
//
// `seed` (optional): threaded onto the GAME DEFINITION (not a Client() option —
// v0.45 does not read a `seed` Client option into the game PRNG, only
// `game.seed`; see src/sim/match.js's own header comment for the same deviation,
// independently rediscovered and confirmed here).
// Exported separately (not just inlined in makeSeatClients) so the credentials
// trust-boundary test (item 6) can build its OWN raw Client()s with deliberately
// mismatched/absent credentials against the SAME game-object reference — it needs
// direct control over the `credentials` Client() option, which makeSeatClients
// doesn't expose (every normal test goes through makeSeatClients instead).
export function buildSeatGame({ enforceSeats = true, patchG, seed } = {}) {
  setActiveMap(loadMap(classicMapJson));

  const wrappedMoves = {};
  for (const name in Monopoly.moves) {
    wrappedMoves[name] = { move: Monopoly.moves[name], client: false };
  }

  const seatGame = {
    ...Monopoly,
    moves: wrappedMoves,
    setup: (ctx) => {
      const G = Monopoly.setup(ctx, { enforceSeats });
      return patchG ? (patchG(G, ctx) || G) : G;
    },
  };
  if (seed !== undefined) seatGame.seed = String(seed);
  return seatGame;
}

export function makeSeatClients(numPlayers, opts = {}) {
  const seatGame = buildSeatGame(opts);

  const clients = [];
  for (let i = 0; i < numPlayers; i++) {
    const client = Client({
      game: seatGame,
      multiplayer: Local(),
      playerID: String(i),
      credentials: 'seat-' + i,
      numPlayers,
      debug: false,
    });
    client.start();
    clients.push(client);
  }
  return clients;
}

// Dispatch `moveName(...args)` on `client`, then resolve once the client's
// observable state ACTUALLY changes (G, or the currentPlayer/activePlayers ctx
// fields), or after a short fallback timeout — whichever comes first.
//
// Every move in this suite's games is `client: false` (see header), so there is
// never a client-side optimistic guess to worry about — state changes ONLY when
// the master's authoritative broadcast lands, asynchronously. `client.subscribe(fn)`
// also invokes `fn` SYNCHRONOUSLY once, with the CURRENT (pre-dispatch) state, the
// instant you subscribe (client-5202a476.js L365-371) — that first call carries no
// information (it fires before the move below has even been dispatched), which is
// why this resolves on the first callback where something has ACTUALLY changed,
// rather than "the first callback" outright.
//
// A REJECTED move (either boardgame.io's own `isPlayerActive` gate, or our
// `requireActor` returning INVALID_MOVE from inside the move body) never produces a
// real change — G/ctx never differ from the pre-dispatch snapshot — so this falls
// through to the fallback timeout and resolves with the (genuinely) unchanged
// state. This is the sim's `stateChanged` idiom (src/sim/match.js), just awaited
// instead of read synchronously, and compared on G directly (there's no meaningful
// top-level `state.log` on Local()'s per-player-filtered relayed state).
const DEFAULT_TIMEOUT_MS = 250;

export function dispatchAndWait(client, moveName, ...args) {
  const before = client.getState();
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
      resolve(client.getState());
    };

    const unsubscribe = client.subscribe((state) => {
      if (state && stateChanged(before, state)) finish();
    });

    timer = setTimeout(finish, DEFAULT_TIMEOUT_MS);

    const fn = client.moves[moveName];
    if (typeof fn !== 'function') {
      throw new Error(`dispatchAndWait: unknown move "${moveName}"`);
    }
    fn(...args);
  });
}

// Dispatch a real rollDice for `client` (the currentPlayer's own client) and
// robustly resolve whatever it lands on — buying any ownable/unowned property,
// accepting any card (which can itself chain into another canBuy/pendingCard,
// e.g. an atlas moveTo or a "advance to X" effect) — until G settles into a
// clean hasRolled===true / canBuy===false / pendingCard===null state. Used by
// tests that only need `G.hasRolled` true (turn.onBegin's reset — see
// makeSeatClients' header — makes this the only way to get it durably) and do
// NOT care where the roll happens to land (unseeded — safe for any move whose
// own preconditions don't involve jail/trading; see the pinned SEED 8 in
// engine-seats.test.js for the trade-window tests, which DO care, because a
// "Go to Jail" card exists in both decks and would spuriously fail
// proposeTrade's canTradeInJail guard).
export async function rollAndSettle(client, maxSteps = 8) {
  let state = await dispatchAndWait(client, 'rollDice');
  for (let i = 0; i < maxSteps; i++) {
    if (state.G.canBuy) {
      state = await dispatchAndWait(client, 'buyProperty');
      continue;
    }
    if (state.G.pendingCard) {
      state = await dispatchAndWait(client, 'acceptCard');
      continue;
    }
    break;
  }
  return state;
}

function stateChanged(before, after) {
  if (!before || !after) return before !== after;
  if (before === after) return false;
  return JSON.stringify(before.G) !== JSON.stringify(after.G)
    || before.ctx.currentPlayer !== after.ctx.currentPlayer
    || JSON.stringify(before.ctx.activePlayers) !== JSON.stringify(after.ctx.activePlayers);
}

// Deep-cloned G snapshot for "assert nothing changed" rejection checks.
export function snapshotG(client) {
  return JSON.parse(JSON.stringify(client.getState().G));
}
