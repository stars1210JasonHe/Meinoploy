import { MOVE_SCHEMAS, EXPECT_REQUIRED, decisionSeq, moveSignature } from '../mcp/move-schemas';
import { Monopoly } from '../Game';

describe('MOVE_SCHEMAS coverage + fidelity', () => {
  test('every engine move has a schema; no extras', () => {
    const engineMoves = Object.keys(Monopoly.moves).sort();
    expect(Object.keys(MOVE_SCHEMAS).sort()).toEqual(engineMoves);
  });
  test('route optional on rollDice/commitRoute; rollOnly takes NO args (round-3 pin)', () => {
    expect(MOVE_SCHEMAS.rollDice.safeParse([]).success).toBe(true);
    expect(MOVE_SCHEMAS.rollDice.safeParse([[1, 2, 3]]).success).toBe(true);
    expect(MOVE_SCHEMAS.commitRoute.safeParse([[5, 6]]).success).toBe(true);
    expect(MOVE_SCHEMAS.rollOnly.safeParse([]).success).toBe(true);
    expect(MOVE_SCHEMAS.rollOnly.safeParse([[1]]).success).toBe(false);
  });
  test('proposeTrade fields independently optional; hostile shapes rejected', () => {
    const s = MOVE_SCHEMAS.proposeTrade;
    expect(s.safeParse([{ targetPlayerId: '1' }]).success).toBe(true);
    expect(s.safeParse([{ targetPlayerId: '1', offeredMoney: 50 }]).success).toBe(true);
    expect(s.safeParse([null]).success).toBe(false);        // the server-crash shape
    expect(s.safeParse(['x']).success).toBe(false);
    expect(s.safeParse([{}]).success).toBe(false);           // targetPlayerId required
    expect(s.safeParse([{ targetPlayerId: '1', offeredProperties: 'nope' }]).success).toBe(false);
  });
  test('placeBid requires a number; property moves require numeric propertyId', () => {
    expect(MOVE_SCHEMAS.placeBid.safeParse([50]).success).toBe(true);
    expect(MOVE_SCHEMAS.placeBid.safeParse(['50']).success).toBe(false);
    expect(MOVE_SCHEMAS.upgradeProperty.safeParse([3]).success).toBe(true);
    expect(MOVE_SCHEMAS.upgradeProperty.safeParse([]).success).toBe(false);
  });
  test('EXPECT_REQUIRED is exactly the six response moves', () => {
    expect([...EXPECT_REQUIRED].sort()).toEqual(
      ['acceptTrade', 'declineDuel', 'passAuction', 'placeBid', 'rejectTrade', 'respondDuel']);
  });
});

describe('decisionSeq', () => {
  const base = () => ({ auction: null, trade: null, duel: null, events: [] });
  test('null when no decision open', () => expect(decisionSeq(base())).toBeNull());
  test('auction: latest auction_started seq', () => {
    const G = { ...base(), auction: { propertyId: 3 }, events: [
      { seq: 5, type: 'auction_started' }, { seq: 9, type: 'auction_turn' }, { seq: 12, type: 'auction_started' },
    ] };
    expect(decisionSeq(G)).toBe(12);
  });
  test('trade / duel opening types', () => {
    expect(decisionSeq({ ...base(), trade: {}, events: [{ seq: 7, type: 'trade_proposed' }] })).toBe(7);
    expect(decisionSeq({ ...base(), duel: {}, events: [{ seq: 4, type: 'duel_offered' }] })).toBe(4);
  });
  test('opening event trimmed out -> null (fail closed)', () => {
    expect(decisionSeq({ ...base(), auction: {}, events: [{ seq: 900, type: 'bid_placed' }] })).toBeNull();
  });
});

describe('moveSignature (spec §1 tool 7.4 signature SETS)', () => {
  test('default: own-seat single signature', () => {
    expect(moveSignature('buyProperty', {}, '0')).toEqual([{ type: 'property_bought', actor: '0', result: 'accepted' }]);
    expect(moveSignature('rollDice', {}, '1')).toEqual([{ type: 'dice_rolled', actor: '1', result: 'accepted' }]);
  });
  test('respondDuel: challenger-actor override from preDispatch G', () => {
    const preG = { duel: { challengerId: '1', ownerId: '0' } };
    expect(moveSignature('respondDuel', preG, '0')).toEqual([{ type: 'duel_resolved', actor: '1', result: 'accepted' }]);
  });
  test('acceptTrade: success + stale-cancel outcome set', () => {
    const preG = { trade: { proposerId: '0', targetPlayerId: '1' } };
    expect(moveSignature('acceptTrade', preG, '1')).toEqual([
      { type: 'trade_accepted', actor: '1', result: 'accepted' },
      { type: 'trade_cancelled', actor: '0', result: 'stale-trade' },
    ]);
  });
  test('endTurn: null (ctx-delta attribution)', () => {
    expect(moveSignature('endTurn', {}, '0')).toBeNull();
  });
  test('passProperty: pass OR auction-start outcome set (plan-time third case)', () => {
    expect(moveSignature('passProperty', {}, '0')).toEqual([
      { type: 'property_passed', actor: '0', result: 'accepted' },
      { type: 'auction_started', actor: null, result: 'accepted' },
    ]);
  });
});
