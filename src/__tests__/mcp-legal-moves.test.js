import { getLegalMoves } from '../mcp/legal-moves';
import { makeClient, selectAllCharacters } from './helpers/drive';
import { MODS } from '../../mods/index';

const CHAR_IDS = MODS.dominion.characters.map(c => c.id);
const names = list => list.map(e => e.move).sort();

test('characterSelect: current seat gets selectCharacter with available ids; other seat gets nothing', () => {
  const client = makeClient(2, 1);
  const { G, ctx } = client.getState();
  const mine = getLegalMoves(G, ctx, ctx.currentPlayer);
  expect(names(mine)).toEqual(['selectCharacter']);
  expect(mine[0].argsHint.characterIds).toEqual(expect.arrayContaining([CHAR_IDS[0]]));
  const other = String(1 - Number(ctx.currentPlayer));
  expect(getLegalMoves(G, ctx, other)).toEqual([]);
});

test('play, pre-roll: rollDice/rollOnly offered per movementMode; endTurn absent', () => {
  const client = makeClient(2, 1);
  selectAllCharacters(client, CHAR_IDS.slice(0, 2));
  const { G, ctx } = client.getState();
  const mine = names(getLegalMoves(G, ctx, ctx.currentPlayer));
  expect(mine).toContain('rollDice');
  expect(mine).not.toContain('endTurn'); // hasRolled false
  expect(mine).not.toContain('buyProperty');
});

test('response moves carry expect.decisionSeq', () => {
  const client = makeClient(3, 8);
  selectAllCharacters(client, CHAR_IDS.slice(0, 3));
  const { G, ctx } = client.getState();
  // Craft an auction state pure-functionally (getLegalMoves is pure — hand it a shaped G).
  const G2 = JSON.parse(JSON.stringify(G));
  G2.auction = { propertyId: 3, currentBid: 0, currentBidder: null,
    bidders: [{ playerId: '0', passed: false }, { playerId: '1', passed: false }], currentBidderIndex: 1 };
  G2.events = [...G2.events, { seq: 500, turn: 1, type: 'auction_started', actor: null, data: {} }];
  const ctx2 = { ...ctx, currentPlayer: '0', activePlayers: { '1': null } };
  const forBidder = getLegalMoves(G2, ctx2, '1');
  expect(names(forBidder)).toEqual(['passAuction', 'placeBid']);
  expect(forBidder.find(e => e.move === 'placeBid').expect).toEqual({ decisionSeq: 500 });
  expect(forBidder.find(e => e.move === 'placeBid').argsHint.min).toBeGreaterThan(0);
  // The auction INITIATOR (currentPlayer, NOT in envelope) gets nothing (canAct false).
  expect(getLegalMoves(G2, ctx2, '0')).toEqual([]);
});

test('null decisionSeq (opening event front-trimmed): active bidder gets NO placeBid/passAuction', () => {
  // Fix wave: an open auction whose 'auction_started' opening event is NOT in
  // G.events (simulating front-trim past the 200-cap log) makes decisionSeq(G)
  // return null. Listing placeBid/passAuction WITHOUT expect would be a dead
  // end for the caller — make_move's layer 1 hard-errors "expect.decisionSeq
  // is REQUIRED" (nothing to echo) and layer 2 fails closed to stale-decision
  // for any value anyway. getLegalMoves must fail closed identically: neither
  // response move is listed at all.
  const client = makeClient(3, 8);
  selectAllCharacters(client, CHAR_IDS.slice(0, 3));
  const { G, ctx } = client.getState();
  const G2 = JSON.parse(JSON.stringify(G));
  G2.auction = { propertyId: 3, currentBid: 0, currentBidder: null,
    bidders: [{ playerId: '0', passed: false }, { playerId: '1', passed: false }], currentBidderIndex: 1 };
  // No 'auction_started' event anywhere in the log -> decisionSeq(G2) is null.
  G2.events = [...G2.events, { seq: 500, turn: 1, type: 'bid_placed', actor: '0', data: {} }];
  const ctx2 = { ...ctx, currentPlayer: '0', activePlayers: { '1': null } };
  const forBidder = getLegalMoves(G2, ctx2, '1');
  expect(names(forBidder)).toEqual([]);
});

test('enforceSeats:true — duel response listed only for the owner seat, not the challenger', () => {
  const client = makeClient(3, 8);
  selectAllCharacters(client, CHAR_IDS.slice(0, 3));
  const { G, ctx } = client.getState();
  // Craft a duel-response state pure-functionally (same hand-shaped style as
  // above), mirroring the REAL fields Game.js's landing-interception (Game.js:
  // 547-549) and initiateDuel (Game.js:1910-1918) put on G.duel: phase,
  // propertyId, ownerId, challengerId, rent. Both duelists are active per
  // Game.js:1918's setActivePlayers — canAct alone would admit both seats;
  // only actorMatches's enforceSeats-gated exact-seat check (legal-moves.js:
  // 60-62, mirroring requireActor at Game.js:159-161) must exclude the
  // challenger from respondDuel/declineDuel.
  const G2 = JSON.parse(JSON.stringify(G));
  G2.enforceSeats = true;
  G2.duel = { phase: 'response', propertyId: 3, ownerId: '0', challengerId: '1', rent: 40 };
  G2.events = [...G2.events, { seq: 700, turn: 1, type: 'duel_offered', actor: '1', data: {} }];
  const ctx2 = { ...ctx, currentPlayer: '1', activePlayers: { '0': null, '1': null } };
  // The challenger (WRONG seat under enforceSeats) is in the activePlayers
  // envelope (canAct true) but must be excluded by actorMatches.
  expect(getLegalMoves(G2, ctx2, '1')).toEqual([]);
  // The owner (RIGHT seat) gets exactly respondDuel + declineDuel, each
  // carrying expect.decisionSeq (both are in EXPECT_REQUIRED).
  const forOwner = getLegalMoves(G2, ctx2, '0');
  expect(names(forOwner)).toEqual(['declineDuel', 'respondDuel']);
  expect(forOwner.find(e => e.move === 'respondDuel').expect).toEqual({ decisionSeq: 700 });
  expect(forOwner.find(e => e.move === 'declineDuel').expect).toEqual({ decisionSeq: 700 });
});
