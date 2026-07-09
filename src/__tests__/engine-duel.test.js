import { INVALID_MOVE } from 'boardgame.io/core';
import { Monopoly } from '../Game';
import { RULES } from '../../mods/active-rules';
import { COLOR_GROUPS } from '../../mods/dominion';

describe('Duel mechanism — Game.js setup + state initialization', () => {
  test('G.duel initialized to null', () => {
    const ctx = { numPlayers: 2 };
    const G = Monopoly.setup(ctx);
    expect(G.duel).toBeNull();
  });

  test('each player has lastDuelTurn initialized to null', () => {
    const ctx = { numPlayers: 3 };
    const G = Monopoly.setup(ctx);
    G.players.forEach(p => {
      expect(p.lastDuelTurn).toBeNull();
    });
  });

  test('RULES.duel config bucket exists with all 8 keys', () => {
    expect(RULES.duel).toBeDefined();
    expect(RULES.duel).toHaveProperty('enabled');
    expect(RULES.duel).toHaveProperty('loseMultiplier');
    expect(RULES.duel).toHaveProperty('cooldownTurns');
    expect(RULES.duel).toHaveProperty('diceCount');
    expect(RULES.duel).toHaveProperty('statPrimary');
    expect(RULES.duel).toHaveProperty('statSecondary');
    expect(RULES.duel).toHaveProperty('secondaryDivisor');
    expect(RULES.duel).toHaveProperty('tieGoesToDefender');
  });

  test('RULES.duel has expected default values', () => {
    expect(RULES.duel.enabled).toBe(false);
    expect(RULES.duel.loseMultiplier).toBe(2);
    expect(RULES.duel.cooldownTurns).toBe(3);
    expect(RULES.duel.diceCount).toBe(2);
    expect(RULES.duel.statPrimary).toBe('stamina');
    expect(RULES.duel.statSecondary).toBe('luck');
    expect(RULES.duel.secondaryDivisor).toBe(2);
    expect(RULES.duel.tieGoesToDefender).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Task 2: mid-duel move guards + turnPhase clobber preservation.
//
// No duel can actually be CREATED yet (Task 3's job — landing interception).
// These tests craft G.duel directly to prove the 8 guards are un-bypassable
// and inert-when-null, and that the 3 turnPhase-clobber sites in Game.js now
// preserve 'duel' the same way they already preserved 'card'.
//
// Driving style matches engine-seats-unit.test.js's precedent (direct
// `Monopoly.moves.X(G, ctx, ...)` invocation against a hand-built G) rather
// than the drive.js Client harness — legal pre-states for 8 disparate moves
// (color-group ownership, passive checks, mortgage state, reroll budget) are
// far more tractable to construct directly than to steer a real client to.
// ---------------------------------------------------------------------------
describe('Duel mechanism — mid-duel move guards (Task 2)', () => {
  // The exact envelope shape pinned by the task brief. Content doesn't matter
  // to these guards (they gate on truthiness of G.duel, not its fields) but
  // using the real shape keeps the tests honest about what Task 3 will produce.
  function activeDuel() {
    return { phase: 'offer', propertyId: 1, ownerId: '1', challengerId: '0', rent: 50 };
  }

  function freshG() {
    const ctx = { numPlayers: 2, playOrder: ['0', '1'] };
    const G = Monopoly.setup(ctx);
    G.phase = 'play'; // skip character selection for gameplay tests
    return G;
  }

  function valForDie(n) {
    return (n - 1) / 6 + 0.01;
  }

  function makeCtx(currentPlayer = '0', d1 = 3, d2 = 4) {
    let i = 0;
    const values = [valForDie(d1), valForDie(d2)];
    return {
      currentPlayer,
      numPlayers: 2,
      random: { Number: () => values[i++ % values.length] },
      events: { endTurn: jest.fn(), setActivePlayers: jest.fn() },
    };
  }

  function setupMonopoly(G, playerId, colorGroup) {
    const groupIds = COLOR_GROUPS[colorGroup];
    groupIds.forEach(id => {
      G.ownership[id] = playerId;
      G.players[parseInt(playerId)].properties.push(id);
    });
  }

  test('endTurn: rejected mid-duel (state unchanged), succeeds once G.duel clears', () => {
    const G = freshG();
    G.hasRolled = true;
    const turnPhaseBefore = G.turnPhase;
    G.duel = activeDuel();

    const ctx1 = makeCtx('0');
    const blocked = Monopoly.moves.endTurn(G, ctx1);
    expect(blocked).toBe(INVALID_MOVE);
    expect(G.turnPhase).toBe(turnPhaseBefore); // untouched — the guard fired, not endTurn's own logic
    expect(G.hasRolled).toBe(true);
    expect(ctx1.events.endTurn).not.toHaveBeenCalled();

    G.duel = null;
    const ctx2 = makeCtx('0');
    const result = Monopoly.moves.endTurn(G, ctx2);
    expect(result).not.toBe(INVALID_MOVE);
    expect(ctx2.events.endTurn).toHaveBeenCalled();
    expect(G.turnPhase).toBe('roll');
  });

  test('proposeTrade: rejected mid-duel (G.trade stays null), succeeds once G.duel clears', () => {
    const G = freshG();
    G.hasRolled = true;
    const proposal = {
      targetPlayerId: '1', offeredProperties: [], requestedProperties: [], offeredMoney: 0, requestedMoney: 0,
    };
    G.duel = activeDuel();

    const blocked = Monopoly.moves.proposeTrade(G, makeCtx('0'), proposal);
    expect(blocked).toBe(INVALID_MOVE);
    expect(G.trade).toBeNull();

    G.duel = null;
    const result = Monopoly.moves.proposeTrade(G, makeCtx('0'), proposal);
    expect(result).not.toBe(INVALID_MOVE);
    expect(G.trade).not.toBeNull();
    expect(G.trade.targetPlayerId).toBe('1');
  });

  test('useReroll: rejected mid-duel (rerollsLeft/hasRolled untouched), succeeds once G.duel clears', () => {
    const G = freshG();
    G.hasRolled = true;
    G.players[0].rerollsLeft = 1;
    G.duel = activeDuel();

    const blocked = Monopoly.moves.useReroll(G, makeCtx('0'));
    expect(blocked).toBe(INVALID_MOVE);
    expect(G.players[0].rerollsLeft).toBe(1);
    expect(G.hasRolled).toBe(true);

    G.duel = null;
    const result = Monopoly.moves.useReroll(G, makeCtx('0'));
    expect(result).not.toBe(INVALID_MOVE);
    expect(G.players[0].rerollsLeft).toBe(0);
    expect(G.hasRolled).toBe(false);
  });

  test('mortgageProperty: rejected mid-duel (G.mortgaged untouched), succeeds once G.duel clears', () => {
    const G = freshG();
    G.ownership[1] = '0';
    G.players[0].properties.push(1);
    G.duel = activeDuel();

    const blocked = Monopoly.moves.mortgageProperty(G, makeCtx('0'), 1);
    expect(blocked).toBe(INVALID_MOVE);
    expect(G.mortgaged[1]).toBeFalsy();

    G.duel = null;
    const result = Monopoly.moves.mortgageProperty(G, makeCtx('0'), 1);
    expect(result).not.toBe(INVALID_MOVE);
    expect(G.mortgaged[1]).toBe(true);
  });

  test('unmortgageProperty: rejected mid-duel (G.mortgaged stays true), succeeds once G.duel clears', () => {
    const G = freshG();
    G.ownership[1] = '0';
    G.players[0].properties.push(1);
    G.mortgaged[1] = true;
    G.duel = activeDuel();

    const blocked = Monopoly.moves.unmortgageProperty(G, makeCtx('0'), 1);
    expect(blocked).toBe(INVALID_MOVE);
    expect(G.mortgaged[1]).toBe(true);

    G.duel = null;
    const result = Monopoly.moves.unmortgageProperty(G, makeCtx('0'), 1);
    expect(result).not.toBe(INVALID_MOVE);
    expect(G.mortgaged[1]).toBe(false);
  });

  test('upgradeProperty: rejected mid-duel (G.buildings untouched), succeeds once G.duel clears', () => {
    const G = freshG();
    G.hasRolled = true;
    setupMonopoly(G, '0', '#8B4513'); // Brown group: ids 1, 3
    G.duel = activeDuel();

    const blocked = Monopoly.moves.upgradeProperty(G, makeCtx('0'), 1);
    expect(blocked).toBe(INVALID_MOVE);
    expect(G.buildings[1]).toBeUndefined();

    G.duel = null;
    const result = Monopoly.moves.upgradeProperty(G, makeCtx('0'), 1);
    expect(result).not.toBe(INVALID_MOVE);
    expect(G.buildings[1]).toBe(1);
  });

  test('sellBuilding: rejected mid-duel (G.buildings untouched), succeeds once G.duel clears', () => {
    const G = freshG();
    G.hasRolled = true;
    setupMonopoly(G, '0', '#8B4513'); // Brown group: ids 1, 3
    G.buildings[1] = 1;
    G.duel = activeDuel();

    const blocked = Monopoly.moves.sellBuilding(G, makeCtx('0'), 1);
    expect(blocked).toBe(INVALID_MOVE);
    expect(G.buildings[1]).toBe(1);

    G.duel = null;
    const result = Monopoly.moves.sellBuilding(G, makeCtx('0'), 1);
    expect(result).not.toBe(INVALID_MOVE);
    expect(G.buildings[1]).toBeUndefined();
  });

  test('regulateProperty: rejected mid-duel (regulatedProperty stays null), succeeds once G.duel clears', () => {
    const G = freshG();
    G.players[0].character = { passive: { id: 'enforcer' } };
    G.ownership[1] = '0';
    G.players[0].properties.push(1);
    G.duel = activeDuel();

    const blocked = Monopoly.moves.regulateProperty(G, makeCtx('0'), 1);
    expect(blocked).toBe(INVALID_MOVE);
    expect(G.players[0].regulatedProperty).toBeNull();

    G.duel = null;
    const result = Monopoly.moves.regulateProperty(G, makeCtx('0'), 1);
    expect(result).not.toBe(INVALID_MOVE);
    expect(G.players[0].regulatedProperty).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Task 2: turnPhase clobber-site preservation, at the unit tier.
//
// All three sites share the identical fix shape:
//   if (G.turnPhase !== 'card') { ... }  ->  if (G.turnPhase !== 'card' && G.turnPhase !== 'duel') { ... }
// Task 3 (landing interception) is what will actually SET G.turnPhase='duel'
// in real play; here we pre-set it by hand on a hand-built G and drive the
// public move that contains each clobber site, proving that site alone
// leaves a pre-existing 'duel' turnPhase alone instead of resetting it to
// 'act'/'done'. No G.duel is set for these — they test the turnPhase
// bookkeeping mechanism in isolation from the (Task 3) duel-creation flow.
// ---------------------------------------------------------------------------
describe('Duel mechanism — turnPhase clobber-site preservation (Task 2)', () => {
  function freshG() {
    const ctx = { numPlayers: 2, playOrder: ['0', '1'] };
    const G = Monopoly.setup(ctx);
    G.phase = 'play';
    return G;
  }

  function valForDie(n) {
    return (n - 1) / 6 + 0.01;
  }

  function makeCtx(currentPlayer = '0', d1 = 3, d2 = 4) {
    let i = 0;
    const values = [valForDie(d1), valForDie(d2)];
    return {
      currentPlayer,
      numPlayers: 2,
      random: { Number: () => values[i++ % values.length] },
      events: { endTurn: jest.fn(), setActivePlayers: jest.fn() },
    };
  }

  test('performMove clobber site (rollDice -> landing on an unowned property): preserves turnPhase=duel', () => {
    const G = freshG();
    // total 3 (1+2), non-doubles: P0 walks position 0 -> 3 (Baltic Ave, unowned,
    // not a card space) — a landing that would normally set turnPhase to
    // 'act' (canBuy) via the clobber line, were it not pre-set to 'duel'.
    G.turnPhase = 'duel';

    Monopoly.moves.rollDice(G, makeCtx('0', 1, 2));

    expect(G.canBuy).toBe(true); // sanity: landing did run and did set canBuy
    expect(G.turnPhase).toBe('duel'); // NOT clobbered to 'act'
  });

  test('acceptCard clobber site: preserves turnPhase=duel through a simple (non-chaining) card', () => {
    const G = freshG();
    const card = { text: 'Test gain card', action: 'gain', value: 50 };
    G.pendingCard = { card, deck: 'chance', cardIndex: 0 };
    G.turnPhase = 'duel';
    const moneyBefore = G.players[0].money;

    Monopoly.moves.acceptCard(G, makeCtx('0'));

    expect(G.players[0].money).toBe(moneyBefore + 50); // sanity: the card did apply
    expect(G.pendingCard).toBeNull();
    expect(G.turnPhase).toBe('duel'); // NOT clobbered to 'act'/'done'
  });

  test('redrawCard clobber site: preserves turnPhase=duel through a simple (non-chaining) card', () => {
    const G = freshG();
    G.players[0].luckRedraws = 1;
    // Single-entry deck: drawCard's index = floor(random * 1) = 0 always,
    // regardless of the mocked random value — deterministic without needing
    // to know the real deck's card ordering.
    G.board.communityCards = [{ text: 'Test gain card (redraw)', action: 'gain', value: 25 }];
    G.pendingCard = { card: { text: 'original', action: 'gain', value: 0 }, deck: 'community', cardIndex: 0 };
    G.turnPhase = 'duel';
    const moneyBefore = G.players[0].money;

    Monopoly.moves.redrawCard(G, makeCtx('0'));

    expect(G.players[0].luckRedraws).toBe(0); // sanity: the redraw was consumed
    expect(G.players[0].money).toBe(moneyBefore + 25); // sanity: the new card applied
    expect(G.pendingCard).toBeNull();
    expect(G.turnPhase).toBe('duel'); // NOT clobbered to 'act'/'done'
  });
});
