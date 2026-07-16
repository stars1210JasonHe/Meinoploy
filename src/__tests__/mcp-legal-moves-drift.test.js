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

afterAll(() => {
  // Restore the module-scope active mod/map to dominion/classic — hygiene,
  // mirrors mod-map-select.test.js's afterAll (this file's terra-titans/atlas
  // test switches the shared RULES/board singleton via resolveModMap).
  setActiveMod('dominion');
  setActiveMap(loadMap(classicMapJson));
});

function freshClient(numPlayers, seed) {
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

function sampleArgs(entry, G, seat) {
  // Derive dispatchable args from the hint the module itself provides.
  switch (entry.move) {
    case 'selectCharacter': return [entry.argsHint.characterIds[0]];
    case 'placeBid': return [entry.argsHint.min];
    case 'commitRoute': return []; // engine auto-routes on omission
    case 'rollDice': return [];
    case 'proposeTrade': {
      const other = G.players.find(p => p.id !== seat && !p.bankrupt);
      return [{ targetPlayerId: other.id }];
    }
    default:
      return entry.argsHint && entry.argsHint.propertyIds ? [entry.argsHint.propertyIds[0]] : [];
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
// Returns the DISPATCHED move's name (truthy) so callers can self-verify
// which branches the walk really reached, false if no listed move advanced,
// undefined on gameover.
function checkStep(client, seat, priority) {
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
      const args = sampleArgs(entry, before.G, seat);
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
  // Hot-seat: ctx.playerID is substituted currentPlayer — audit the CURRENT
  // seat each step (the seat whose moves are dispatchable on this client).
  let steps = 0;
  while (steps < 400) {
    const { ctx } = client.getState();
    if (ctx.gameover) break;
    const advanced = checkStep(client, ctx.currentPlayer);
    if (!advanced) {
      // No listed move advanced state — the game requires a specific decision
      // (shouldn't happen: getLegalMoves must always list SOMETHING for the
      // acting seat mid-game, or the game is stuck — that itself is a bug).
      throw new Error(`DRIFT: no legal move listed for acting seat at step ${steps}`);
    }
    steps++;
  }
  expect(steps).toBeGreaterThan(20); // the game genuinely progressed
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
  let steps = 0;
  while (steps < 400) {
    const { ctx } = client.getState();
    if (ctx.gameover) break;
    const move = checkStep(client, ctx.currentPlayer, priority);
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
test.each([2, 9])('drift: atlas board (terra-titans), rollOnly/commitRoute + duel-respond stance, seed %i', (seed) => {
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

test.each([2, 9])('drift: atlas board (terra-titans), duel-decline stance, seed %i', (seed) => {
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
