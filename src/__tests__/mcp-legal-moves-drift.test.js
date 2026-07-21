// THE load-bearing suite (spec §3): at every step of real driven games, for
// EVERY move in the def, getLegalMoves membership must agree with actual
// dispatch acceptance. Hot-seat sync Clients (no async timing). Any future
// guard change not mirrored in legal-moves fails here loudly.
import { Client } from 'boardgame.io/client';
import { Monopoly, setActiveMap, setActiveMod } from '../Game';
import { loadMap } from '../map-loader';
import classicMapJson from '../../mods/dominion/maps/classic/map.json';
import { getLegalMoves } from '../mcp/legal-moves';
import { resolveModMap } from '../mod-map-select';
import { MODS } from '../../mods/index';

const CHAR_IDS = MODS.dominion.characters.map(c => c.id);

// Moves whose ACCEPTANCE needs args we can't synthesize blind — these are
// checked in the LISTED direction only (listed => dispatch accepts with the
// argsHint's own suggestion), not the rejected direction.
const ARG_MOVES = new Set(['selectCharacter', 'placeBid', 'proposeTrade', 'commitRoute',
  'upgradeProperty', 'mortgageProperty', 'unmortgageProperty', 'sellBuilding', 'regulateProperty', 'rollDice']);

// seed -> the {move,args} log captured by the seed %i drift test below —
// consumed by the m9 self-verification test ("cycling actually fires") at
// the bottom of this file, which runs after test.each has populated it
// (jest runs a file's tests in declaration order).
const seedArgsLogs = {};

afterAll(() => {
  // Restore the module-scope active mod/map to dominion/classic — hygiene,
  // mirrors mod-map-select.test.js's afterAll (this file's terra-titans/atlas
  // test switches the shared RULES/board singleton via resolveModMap).
  setActiveMod('dominion');
  setActiveMap(loadMap(classicMapJson));
});

function freshClient(numPlayers, seed) {
  // T4 fix (root-caused via instrumentation, not guessed): freshClient used
  // to reset ONLY the map, not the mod — a classic-board test declared
  // AFTER an atlas test in this file (freshAtlasClient calls
  // resolveModMap('terra-titans'), mutating the shared RULES singleton in
  // place, e.g. duel.enabled true) silently ran under terra-titans' RULES
  // until this file's single afterAll finally restored 'dominion'. Harmless
  // for the pre-existing classic tests (declared BEFORE any atlas test, and
  // otherwise mod-insensitive), but MT2-SP5 persuasion's rent seam is
  // materially different under duel.enabled=true (rent-due landings offer a
  // duel instead of auto-paying, so G.lastRentPayment stops getting set from
  // a plain landing) — observed: a rent-window drift scenario passed in
  // isolation but failed inside the full suite, purely from declaration
  // order. Resetting the mod here makes every classic-board test's RULES
  // deterministic regardless of what ran before it in this file.
  setActiveMod('dominion');
  setActiveMap(loadMap(classicMapJson));
  const game = Object.assign({}, Monopoly, { seed: String(seed) });
  const client = Client({ game, numPlayers, debug: false });
  client.start();
  return client;
}

// Ticket (T1, final review "atlas drift coverage"): the drift oracle above
// only ever ran classic (movementMode 'square'/loop) games — the route/
// commitRoute path (legal-moves.js's awaitingRoute branch) only ever fires
// on an atlas board, so it had ZERO coverage here (final-review m7). Mirrors
// freshClient exactly, but resolves terra-titans' default (atlas) world
// instead of loading the classic map.json.
function freshAtlasClient(numPlayers, seed) {
  resolveModMap('terra-titans'); // installs RULES + roster + the atlas world board
  const game = Object.assign({}, Monopoly, { seed: String(seed) });
  const client = Client({ game, numPlayers, debug: false });
  client.start();
  return client;
}

// Round-robins through a bounded set of options, one step per call — bounded
// (mod length, never grows) and deterministic (a pure function of how many
// times this move has been sampled so far, which is itself a deterministic
// function of the fixed seed). `counters` is a plain object the caller owns
// for the lifetime of one game/walk (see checkStep).
function nextIndex(counters, key, len) {
  if (!len) return 0;
  const n = counters[key] || 0;
  counters[key] = n + 1;
  return n % len;
}

// m9 finding (drift oracle review): this only ever exercised argsHint's
// FIRST entry per move (propertyIds[0], characterIds[0], min-only bids) —
// e.g. a seat with THREE simultaneously-upgradable properties only ever had
// its first one dispatched through the oracle, all game, every seed; the
// other two were listed but never actually round-tripped through
// listed=>accepted. `counters` cycles through every hinted option across the
// repeated times a move gets sampled over the course of one walk.
function sampleArgs(entry, G, seat, counters) {
  // Derive dispatchable args from the hint the module itself provides.
  switch (entry.move) {
    case 'selectCharacter': {
      const ids = entry.argsHint.characterIds;
      return [ids[nextIndex(counters, 'selectCharacter', ids.length)]];
    }
    case 'placeBid': {
      // Alternate the two concrete legal amounts the hint gives us (Game.js
      // placeBid accepts amount === player.money — max is not a rejected
      // over-bid, it's the other end of the legal range).
      const i = nextIndex(counters, 'placeBid', 2);
      return [i === 0 ? entry.argsHint.min : entry.argsHint.max];
    }
    case 'commitRoute': return []; // engine auto-routes on omission
    case 'rollDice': return [];
    case 'proposeTrade': {
      const others = G.players.filter(p => p.id !== seat && !p.bankrupt);
      const other = others[nextIndex(counters, 'proposeTrade', others.length)];
      return [{ targetPlayerId: other.id }];
    }
    case 'attemptPersuasion': {
      // MT2-SP5 direction C2, T4: argsHint is {kind, targetSeat} for all
      // three seams (rent/duel/trade) — echo it straight back, plus empty
      // flavor text (this oracle only exercises listed=>accepted structure,
      // not judge/text content). String() on targetSeat: some seams (e.g.
      // G.lastRentPayment.ownerSeat) may carry it as a number internally.
      return [entry.argsHint.kind, String(entry.argsHint.targetSeat), ''];
    }
    default: {
      const ids = entry.argsHint && entry.argsHint.propertyIds;
      if (!ids || !ids.length) return [];
      return [ids[nextIndex(counters, entry.move, ids.length)]];
    }
  }
}

// `priority` (optional): move names to try FIRST, in order, before the rest
// of Object.keys(Monopoly.moves) in their original order. Without it the
// iteration order is exactly Object.keys(Monopoly.moves) — the classic-board
// scenarios below pass no priority, so their dispatch order is byte-identical
// to the pre-priority oracle. Reviewer finding (small-tickets wave): the
// first-listed-wins walk means rollDice (defined before rollOnly in Game.js)
// always wins the pre-roll state, so rollOnly/awaitingRoute/commitRoute were
// structurally unreachable — and payRent (defined before initiateDuel)
// swallowed every duel offer the same way. The atlas scenarios use `priority`
// to steer the walk into those branches; the oracle's listed<=>accepted
// checks are order-independent (every blind dispatch of an unlisted move must
// be rejected no matter when it's tried), so reordering never weakens them.
// `counters` (required): the round-robin state sampleArgs cycles through —
// owned by the caller for the lifetime of one game/walk, so repeated
// encounters of the same move over many steps actually vary which hinted
// option gets dispatched instead of always picking index 0. `argsLog`
// (optional): if supplied, every listed dispatch is recorded as
// {move, args} — the self-verification seam for the "did cycling actually
// fire" test below (a silent no-op must fail loudly, not green-wash).
// Returns the DISPATCHED move's name (truthy) so callers can self-verify
// which branches the walk really reached, false if no listed move advanced,
// undefined on gameover.
function checkStep(client, seat, priority, counters, argsLog) {
  const { G, ctx } = client.getState();
  if (ctx.gameover) return;
  const listed = new Set(getLegalMoves(G, ctx, seat).map(e => e.move));
  const defaultOrder = Object.keys(Monopoly.moves);
  const order = priority
    ? [...priority, ...defaultOrder.filter(m => !priority.includes(m))]
    : defaultOrder;
  for (const move of order) {
    const before = client.getState();
    const entry = getLegalMoves(before.G, before.ctx, seat).find(e => e.move === move);
    if (entry) {
      // LISTED => dispatch must be accepted (state changes) — hot-seat client
      // dispatches synchronously; INVALID_MOVE leaves state identical.
      const args = sampleArgs(entry, before.G, seat, counters);
      if (argsLog) argsLog.push({ move, args });
      client.moves[move](...args);
      const after = client.getState();
      const changed = JSON.stringify(after.G) !== JSON.stringify(before.G)
        || after.ctx.currentPlayer !== before.ctx.currentPlayer
        || after.ctx.turn !== before.ctx.turn;
      if (!changed) {
        throw new Error(`DRIFT: listed move ${move} was REJECTED at seat ${seat} (turnPhase ${before.G.turnPhase})`);
      }
      return move; // state advanced (truthy) — restart the scan from the new state
    } else if (!ARG_MOVES.has(move)) {
      // NOT LISTED (and blind-dispatchable) => dispatch must be rejected.
      client.moves[move]();
      const after = client.getState();
      const changed = JSON.stringify(after.G) !== JSON.stringify(before.G)
        || after.ctx.currentPlayer !== before.ctx.currentPlayer
        || after.ctx.turn !== before.ctx.turn;
      if (changed) {
        throw new Error(`DRIFT: unlisted move ${move} was ACCEPTED at seat ${seat} (turnPhase ${before.G.turnPhase})`);
      }
    }
  }
  return false;
}

test.each([1, 7, 8, 21])('drift: full game agreement, seed %i', (seed) => {
  const client = freshClient(2, seed);
  const counters = {}; // one round-robin state per game — see checkStep/sampleArgs
  const argsLog = [];
  // Hot-seat: ctx.playerID is substituted currentPlayer — audit the CURRENT
  // seat each step (the seat whose moves are dispatchable on this client).
  let steps = 0;
  while (steps < 400) {
    const { ctx } = client.getState();
    if (ctx.gameover) break;
    const advanced = checkStep(client, ctx.currentPlayer, undefined, counters, argsLog);
    if (!advanced) {
      // No listed move advanced state — the game requires a specific decision
      // (shouldn't happen: getLegalMoves must always list SOMETHING for the
      // acting seat mid-game, or the game is stuck — that itself is a bug).
      throw new Error(`DRIFT: no legal move listed for acting seat at step ${steps}`);
    }
    steps++;
  }
  expect(steps).toBeGreaterThan(20); // the game genuinely progressed
  seedArgsLogs[seed] = argsLog; // captured for the m9 self-verification test below
});

// Steered walk driver, shared by the priority scenarios below. `priority`
// steers checkStep's first-listed-wins scan (see checkStep header): rollOnly
// over rollDice so awaitingRoute actually opens on atlas (then commitRoute
// closes it via the oracle's own listed=>accepted path), and a per-scenario
// duel stance so duel offers escalate instead of always draining through
// payRent. Returns the set of moves the walk actually DISPATCHED, for
// self-verifying assertions — a silent no-op (branch never reached) fails
// loudly instead of green-washing.
function driveSteeredGame(client, priority) {
  const dispatched = new Set();
  const counters = {}; // one round-robin state per game — see checkStep/sampleArgs
  let steps = 0;
  while (steps < 400) {
    const { ctx } = client.getState();
    if (ctx.gameover) break;
    const move = checkStep(client, ctx.currentPlayer, priority, counters);
    if (!move) {
      throw new Error(`DRIFT (steered): no legal move listed for acting seat at step ${steps}`);
    }
    dispatched.add(move);
    steps++;
  }
  expect(steps).toBeGreaterThan(20); // the game genuinely progressed
  return dispatched;
}

// The two stances share ['rollOnly','commitRoute',...,'buyProperty','endTurn']:
// - rollOnly over rollDice opens awaitingRoute; commitRoute (before endTurn —
//   endTurn is NOT awaitingRoute-gated, ledger's pre-existing hole) closes it.
// - buyProperty + endTurn preferred over the asset moves: without this the
//   default-order walk mortgages every property the moment it's owned
//   (mortgageProperty is defined before buyProperty/endTurn in Game.js), so
//   every rent stays $0 and the `rent > 0` duel-offer condition (Game.js
//   handleLanding) is structurally unreachable — measured, not guessed: a
//   20-seed hunt without this steering produced ZERO duel offers; with it,
//   12/12 seeds fired the full duel path in both stances.
// - initiateDuel before payRent escalates offers while off cooldown; the
//   3-turn cooldown then routes later offers through payRent (default order),
//   so both offer answers get dispatched in the same game.
// Re-seeded (ticket A2, terra-titans event card decks): seeds 2/9 were tuned
// against terra-titans' PREVIOUSLY EMPTY chance/community decks, where
// drawCard's `if (!deck || deck.length === 0) return null;` short-circuits
// BEFORE calling ctx.random.Number() at all — landing on a card space
// consumed ZERO random draws. Populating the decks means a card space now
// legitimately draws (consuming one ctx.random.Number() call), which shifts
// every subsequent seeded roll for the rest of that game — seeds 2/9 no
// longer reach the cooldown-blocked-payRent branch by turn 400. This is a
// consequence of the SAME bug ticket A2 fixes (empty decks silently no-op),
// not a new drift bug: re-running the seed hunt (measured, not guessed — see
// the original stance-steering comment above) with real decks in play found
// seeds 1/6 reach the full scenario in BOTH stances (verified: rollOnly,
// commitRoute, initiateDuel, respondDuel/declineDuel, and payRent all
// genuinely dispatch — acceptCard now also dispatches along the way, which is
// the point of the fix). If terra-titans' decks change again, re-run this
// hunt rather than re-guessing.
test.each([1, 6])('drift: atlas board (terra-titans), rollOnly/commitRoute + duel-respond stance, seed %i', (seed) => {
  const dispatched = driveSteeredGame(freshAtlasClient(2, seed), ['rollOnly', 'commitRoute', 'initiateDuel', 'respondDuel', 'buyProperty', 'endTurn']);
  // Self-verifying (reviewer-mandated): each branch was genuinely dispatched
  // through the oracle's listed=>accepted path — a silent no-op fails here.
  expect(dispatched.has('rollOnly')).toBe(true);
  expect(dispatched.has('commitRoute')).toBe(true);
  expect(dispatched.has('rollDice')).toBe(false); // rollOnly won every pre-roll state
  expect(dispatched.has('initiateDuel')).toBe(true);
  expect(dispatched.has('respondDuel')).toBe(true);
  expect(dispatched.has('payRent')).toBe(true); // cooldown-blocked offers drain here
});

test.each([1, 6])('drift: atlas board (terra-titans), duel-decline stance, seed %i', (seed) => {
  const dispatched = driveSteeredGame(freshAtlasClient(2, seed), ['rollOnly', 'commitRoute', 'initiateDuel', 'declineDuel', 'buyProperty', 'endTurn']);
  expect(dispatched.has('rollOnly')).toBe(true);
  expect(dispatched.has('commitRoute')).toBe(true);
  expect(dispatched.has('initiateDuel')).toBe(true);
  expect(dispatched.has('declineDuel')).toBe(true); // owner refuses — the respond stance never reaches this branch
  expect(dispatched.has('payRent')).toBe(true);
});

// rollOnly's OTHER branch: on a loop map it skips the route pause and moves
// immediately (Game.js rollOnly's `else performMove(G, ctx, undefined)`) —
// reachable only when rollOnly is preferred on a classic board, which neither
// the byte-identical classic scenarios above (rollDice always wins their
// default order) nor the atlas scenarios (always take the atlas branch) can
// reach. One steered classic game covers it; awaitingRoute must never open.
test('drift: classic board via rollOnly (loop-map immediate-move branch), seed 1', () => {
  const dispatched = driveSteeredGame(freshClient(2, 1), ['rollOnly']);
  expect(dispatched.has('rollOnly')).toBe(true);
  expect(dispatched.has('rollDice')).toBe(false); // rollOnly won every pre-roll state
  expect(dispatched.has('commitRoute')).toBe(false); // loop map: no route pause ever opened
});

// --- Persuasion (MT2-SP5 direction C2 "舌战群儒", T4) --------------------------
// Unsteered, default-order walks never reach attemptPersuasion: for the
// 'rent' kind, mortgageProperty/proposeTrade (both defined earlier in
// Game.js's move object than attemptPersuasion) always win the "first
// listed wins" scan the instant they're ALSO available at a G-state where
// the rent-refund window happens to be open too; for 'duel'/'trade', the
// cross-seat response moves (respondDuel/declineDuel, acceptTrade/
// rejectTrade — all also defined earlier) win the same way. Each scenario
// below puts 'attemptPersuasion' at the FRONT of the priority list so it
// wins the race the moment its window opens, proving getLegalMoves'
// listed=>accepted claim for every one of the three seams — same steering
// discipline as the atlas duel scenarios above.
test('drift: classic board, rent-refund persuasion window (attemptPersuasion kind:rent), seed 1', () => {
  const dispatched = driveSteeredGame(freshClient(2, 1), ['attemptPersuasion']);
  expect(dispatched.has('attemptPersuasion')).toBe(true);
});

test('drift: classic board, trade-lobby persuasion window (attemptPersuasion kind:trade), seed 1', () => {
  // proposeTrade must win FIRST (opens G.trade) before attemptPersuasion can
  // ever have a trade-kind window to list. acceptTrade is ALSO steered,
  // right after attemptPersuasion — root-caused via instrumentation
  // (scratch probe, not guessed): without it, once the one-shot trade
  // persuasion attempt is spent, the walk's default-order fallback toggles
  // mortgageProperty/unmortgageProperty on the same property back and forth
  // for 200+ steps (both are listed regardless of the OTHER's outcome, and
  // neither is trade-gated — see this file's own header note on that Game.js
  // quirk) while G.trade sits open the whole time; the resulting flood of
  // property_mortgaged/unmortgaged events trims RULES.core.eventLogCap (200)
  // past the original trade_proposed event, so decisionSeq(G) — and with it
  // acceptTrade's OWN listability — fails closed (this file's documented
  // "Fail-closed listability" behavior, legal-moves.js's own header note).
  // Once unlisted that way, a BLIND client.moves.acceptTrade() dispatch
  // still structurally succeeds at the raw engine level (accept/reject
  // decisionSeq correlation is an MCP make_move-layer concept the raw move
  // itself never enforces) — tripping the oracle's separate "unlisted move
  // must be rejected" check. Not a legal-moves.js bug: prioritizing
  // acceptTrade resolves the trade before the toggle loop can ever start.
  const dispatched = driveSteeredGame(freshClient(2, 1), ['proposeTrade', 'attemptPersuasion', 'acceptTrade']);
  expect(dispatched.has('proposeTrade')).toBe(true);
  expect(dispatched.has('attemptPersuasion')).toBe(true);
  expect(dispatched.has('acceptTrade')).toBe(true);
});

// Atlas (terra-titans, duel.enabled): 'attemptPersuasion' ranked ABOVE
// respondDuel — the challenger's own taunt window (G.duel.phase 'response')
// is listed to the SAME querying seat (ctx.currentPlayer, i.e. the
// challenger — hot-seat's actorMatches is trivially true regardless of real
// seat, per this file's own header note) that respondDuel/declineDuel are
// ALSO listed to, so without this priority ordering respondDuel (earlier in
// Game.js's move object) always wins first, exactly like the two existing
// duel-respond/decline scenarios above (neither ever dispatches
// attemptPersuasion — confirmed: they stay green with 'attemptPersuasion'
// absent from their own dispatched sets).
test.each([1, 6])('drift: atlas board (terra-titans), duel-taunt persuasion window (attemptPersuasion kind:duel), seed %i', (seed) => {
  const dispatched = driveSteeredGame(freshAtlasClient(2, seed),
    ['rollOnly', 'commitRoute', 'initiateDuel', 'attemptPersuasion', 'respondDuel', 'buyProperty', 'endTurn']);
  expect(dispatched.has('initiateDuel')).toBe(true);
  expect(dispatched.has('attemptPersuasion')).toBe(true);
  expect(dispatched.has('respondDuel')).toBe(true); // window closes (accounting) -> normal response still fires later
});

// m9 self-verification: does the round-robin actually fire in the full-game
// walks above, or does every move type only ever see a single simultaneous
// option (making the cycling a no-op in practice)? MEASURED (2026-07-18,
// scratch instrumentation over the 4 classic seeds above): mortgageProperty/
// unmortgageProperty each only ever had ONE candidate property at a time in
// every one of these games (mortgageProperty is dispatched before
// buyProperty/endTurn in Game.js's default move order — see driveSteeredGame's
// header comment — so properties drain one at a time, never accumulating);
// placeBid never appeared at all (no auctions in these seeds); proposeTrade/
// acceptTrade only ever had one eligible target (2-player games). So in
// these PARTICULAR seeded games the round-robin has nothing to cycle through
// — that is a property of this state space, not a bug in the mechanism.
// Proving the mechanism itself is correct and bounded therefore needs direct
// unit coverage of sampleArgs, independent of whether any given seed happens
// to generate a multi-option state.
describe('sampleArgs cycles through every argsHint option (m9: previously always index 0)', () => {
  test('propertyIds-shaped hints (upgradeProperty/mortgageProperty/unmortgageProperty/sellBuilding/regulateProperty) round-robin', () => {
    const counters = {};
    const entry = { move: 'upgradeProperty', argsHint: { propertyIds: [10, 20, 30] } };
    const seen = [0, 1, 2, 3, 4].map(() => sampleArgs(entry, { players: [] }, '0', counters)[0]);
    expect(seen).toEqual([10, 20, 30, 10, 20]); // wraps deterministically, bounded by array length
  });

  test('selectCharacter cycles through argsHint.characterIds', () => {
    const counters = {};
    const entry = { move: 'selectCharacter', argsHint: { characterIds: ['a', 'b', 'c'] } };
    const seen = [0, 1, 2, 3].map(() => sampleArgs(entry, {}, '0', counters)[0]);
    expect(seen).toEqual(['a', 'b', 'c', 'a']);
  });

  test('placeBid alternates the two legal bid amounts (min, then max — max === player.money is a legal bid, not an over-bid)', () => {
    const counters = {};
    const entry = { move: 'placeBid', argsHint: { min: 50, max: 300 } };
    const seen = [0, 1, 2, 3].map(() => sampleArgs(entry, {}, '0', counters)[0]);
    expect(seen).toEqual([50, 300, 50, 300]);
  });

  test('proposeTrade cycles through eligible (non-self, non-bankrupt) targets', () => {
    const counters = {};
    const entry = { move: 'proposeTrade' };
    const G = { players: [{ id: '0' }, { id: '1' }, { id: '2', bankrupt: true }, { id: '3' }] };
    const seen = [0, 1, 2, 3].map(() => sampleArgs(entry, G, '0', counters)[0].targetPlayerId);
    expect(seen).toEqual(['1', '3', '1', '3']); // seat 2 excluded (bankrupt), seat 0 excluded (self)
  });

  test('counters are keyed per move name — cycling one move does not perturb another', () => {
    const counters = {};
    const upg = { move: 'upgradeProperty', argsHint: { propertyIds: [1, 2] } };
    const mort = { move: 'mortgageProperty', argsHint: { propertyIds: [9, 8, 7] } };
    expect(sampleArgs(upg, {}, '0', counters)[0]).toBe(1);
    expect(sampleArgs(mort, {}, '0', counters)[0]).toBe(9);
    expect(sampleArgs(upg, {}, '0', counters)[0]).toBe(2);
    expect(sampleArgs(mort, {}, '0', counters)[0]).toBe(8);
  });

  test('a single hinted option never advances the counter into an out-of-range index (bounded)', () => {
    const counters = {};
    const entry = { move: 'sellBuilding', argsHint: { propertyIds: [42] } };
    const seen = [0, 1, 2].map(() => sampleArgs(entry, {}, '0', counters)[0]);
    expect(seen).toEqual([42, 42, 42]);
  });
});

// Cross-check: the full-game walks above did exercise real cycling for the
// one move type where these particular seeds DO generate >1 simultaneous
// option — selectCharacter (the roster shrinks as each seat picks, so seat
// 0 and seat 1's picks are drawn from different available sets). Pins the
// measured finding above rather than letting it silently rot into a stale
// comment.
test('seed diagnostic: selectCharacter picks differ across seats in every captured game (sanity, not a new mechanism claim)', () => {
  expect(Object.keys(seedArgsLogs).length).toBeGreaterThan(0); // populated by the seed %i tests above
  for (const log of Object.values(seedArgsLogs)) {
    const picks = log.filter(e => e.move === 'selectCharacter').map(e => e.args[0]);
    expect(new Set(picks).size).toBe(picks.length); // no seat re-picked an already-taken id
  }
});
