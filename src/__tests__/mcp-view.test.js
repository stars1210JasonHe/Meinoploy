import { canAct, stateView, stateDigest } from '../mcp/view';
import { makeClient, selectAllCharacters } from './helpers/drive';
import { MODS } from '../../mods/index';

const CHAR_IDS = MODS.dominion.characters.map(c => c.id);

function startedClient(numPlayers = 2, seed = 42) {
  const client = makeClient(numPlayers, seed);
  selectAllCharacters(client, CHAR_IDS.slice(0, numPlayers));
  return client;
}

describe('canAct — IsPlayerActive mirror', () => {
  test('no envelope: currentPlayer only', () => {
    const ctx = { currentPlayer: '0', activePlayers: null };
    expect(canAct(ctx, '0')).toBe(true);
    expect(canAct(ctx, '1')).toBe(false);
  });
  test('envelope set: membership only — currentPlayer NOT implicitly admitted', () => {
    const ctx = { currentPlayer: '0', activePlayers: { '1': null } };
    expect(canAct(ctx, '0')).toBe(false); // auction-initiator case (spec round 2)
    expect(canAct(ctx, '1')).toBe(true);  // Stage.NULL value — `in` semantics
  });
});

describe('stateView', () => {
  test('characterSelect phase shape', () => {
    const client = makeClient(2, 1);
    const { G, ctx } = client.getState();
    const v = stateView(G, ctx, '1');
    expect(v.phase).toBe('characterSelect');
    expect(v.yourSeat).toBe('1');
    expect(v.isYourTurn).toBe(false);
    expect(v.canAct).toBe(false);
    expect(v.gameover).toBeNull();
    expect(v.seats).toHaveLength(2);
    expect(v.seats[0]).toMatchObject({ id: '0', character: null, bankrupt: false });
  });

  test('play phase decision flags + seat projection', () => {
    const client = startedClient();
    const { G, ctx } = client.getState();
    const v = stateView(G, ctx, ctx.currentPlayer);
    expect(v.phase).toBe('play');
    expect(v.isYourTurn).toBe(true);
    expect(v.canAct).toBe(true);
    expect(v.flags).toMatchObject({ canBuy: false, pendingCard: null, awaitingRoute: false });
    expect(v.flags.trade).toBeNull();
    expect(v.flags.auction).toBeNull();
    expect(v.flags.duel).toBeNull();
    expect(v.seats[0].character).toEqual(expect.any(String)); // character ID, not the full object
    expect(v.seats[0].money).toEqual(expect.any(Number));
  });

  // SEED 1: author-time seed hunt (2-player classic map) — P0's first rollDice
  // lands total 5 -> space 5 (Reading Railroad, $200, unowned), so canBuy is
  // the only blocker; buyProperty() clears it (auction/pendingCard/duel never
  // trigger) leaving hasRolled true and every proposeTrade guard (Game.js
  // proposeTrade, ~line 1670: duel/phase/hasRolled/canBuy/pendingCard/auction/
  // trade/awaitingRoute) open, so proposeTrade({targetPlayerId:'1',
  // offeredMoney:10}) is accepted and G.trade gets set deterministically.
  // Pinned script: rollDice() -> buyProperty() -> proposeTrade(...). Verified
  // by a throwaway hunt script (seeds 1-60, deleted before commit); seed 1 is
  // the first hit.
  test('trade pending: isAddressed for target, flags.trade projected', () => {
    const client = startedClient(2, 1);
    client.moves.rollDice();
    client.moves.buyProperty();
    client.moves.proposeTrade({ targetPlayerId: '1', offeredMoney: 10 });

    const s2 = client.getState();
    expect(s2.G.trade).not.toBeNull();

    const target = s2.G.trade.targetPlayerId;
    const v = stateView(s2.G, s2.ctx, target);
    expect(v.flags.trade).toMatchObject({ proposerId: s2.G.trade.proposerId, targetPlayerId: target });
    // hot-seat has no envelopes (enforceSeats false) — isAddressed is envelope-based
    // and is covered by the Local() seat tests in Task 9; here we assert projection only.
  });

  test('gameover projection', () => {
    const client = startedClient();
    const { G, ctx } = client.getState();
    const v = stateView(G, { ...ctx, gameover: { winner: '0', reason: 'survival' } }, '1');
    expect(v.gameover).toEqual({ winner: '0', reason: 'survival' });
  });
});

describe('stateDigest', () => {
  test('deterministic: same inputs -> identical string', () => {
    const client = startedClient();
    const { G, ctx } = client.getState();
    expect(stateDigest(G, ctx, '0')).toBe(stateDigest(G, ctx, '0'));
  });
  test('names the seat, money, and turn; leads with GAME OVER when over', () => {
    const client = startedClient();
    const { G, ctx } = client.getState();
    const d = stateDigest(G, ctx, ctx.currentPlayer);
    expect(d).toContain('YOUR TURN');
    expect(d).toMatch(/\$\d/);
    const over = stateDigest(G, { ...ctx, gameover: { winner: '0', reason: 'survival' } }, '0');
    expect(over.startsWith('GAME OVER')).toBe(true);
  });

  // Ticket: the pendingCard DECISION line used to offer "acceptCard or
  // redrawCard" unconditionally, regardless of whether the seat could
  // actually redraw — mirrors Game.js's redrawCard guard (merchant passive =
  // free unlimited redraws; otherwise player.luckRedraws > 0), same condition
  // legal-moves.js already uses to decide whether to list the move at all.
  test('pendingCard: redrawCard hint only offered when the seat can actually redraw', () => {
    const client = startedClient();
    const { G, ctx } = client.getState();
    const seat = ctx.currentPlayer;
    const withCard = (patch) => ({
      ...G,
      pendingCard: { card: { text: 'Test card' }, deck: 'chance' },
      players: G.players.map(p => (p.id === seat ? { ...p, ...patch } : p)),
    });

    // No redraws left, not a merchant -> no redraw hint.
    const ineligible = withCard({ luckRedraws: 0 });
    const dIneligible = stateDigest(ineligible, ctx, seat);
    expect(dIneligible).toContain('acceptCard.');
    expect(dIneligible).not.toContain('redrawCard');

    // luckRedraws > 0 -> redraw hint offered.
    const eligible = withCard({ luckRedraws: 2 });
    const dEligible = stateDigest(eligible, ctx, seat);
    expect(dEligible).toContain('acceptCard or redrawCard.');

    // Merchant passive -> redraw hint offered even with zero luckRedraws.
    const merchantChar = { ...G.players.find(p => p.id === seat).character, passive: { id: 'merchant' } };
    const merchant = withCard({ luckRedraws: 0, character: merchantChar });
    const dMerchant = stateDigest(merchant, ctx, seat);
    expect(dMerchant).toContain('acceptCard or redrawCard.');
  });
});
