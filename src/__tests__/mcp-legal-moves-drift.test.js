// THE load-bearing suite (spec §3): at every step of real driven games, for
// EVERY move in the def, getLegalMoves membership must agree with actual
// dispatch acceptance. Hot-seat sync Clients (no async timing). Any future
// guard change not mirrored in legal-moves fails here loudly.
import { Client } from 'boardgame.io/client';
import { Monopoly, setActiveMap } from '../Game';
import { loadMap } from '../map-loader';
import classicMapJson from '../../mods/dominion/maps/classic/map.json';
import { getLegalMoves } from '../mcp/legal-moves';
import { MODS } from '../../mods/index';

const CHAR_IDS = MODS.dominion.characters.map(c => c.id);
// Moves whose ACCEPTANCE needs args we can't synthesize blind — these are
// checked in the LISTED direction only (listed => dispatch accepts with the
// argsHint's own suggestion), not the rejected direction.
const ARG_MOVES = new Set(['selectCharacter', 'placeBid', 'proposeTrade', 'commitRoute',
  'upgradeProperty', 'mortgageProperty', 'unmortgageProperty', 'sellBuilding', 'regulateProperty', 'rollDice']);

function freshClient(numPlayers, seed) {
  setActiveMap(loadMap(classicMapJson));
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

function checkStep(client, seat) {
  const { G, ctx } = client.getState();
  if (ctx.gameover) return;
  const listed = new Set(getLegalMoves(G, ctx, seat).map(e => e.move));
  for (const move of Object.keys(Monopoly.moves)) {
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
      return true; // state advanced — restart the scan from the new state
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
