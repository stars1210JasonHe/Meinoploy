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
