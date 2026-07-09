import { INVALID_MOVE } from 'boardgame.io/core';
import { Monopoly } from '../Game';
import { RULES } from '../../mods/active-rules';
import { COLOR_GROUPS } from '../../mods/dominion';
import { makeClient } from './helpers/drive';

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

// ---------------------------------------------------------------------------
// Task 3: payRentAmount helper + landing interception.
//
// Golden-gate proof that the helper extraction is invisible (DISABLED, the
// default) lives in `npx jest golden-messages` — RULES.duel.enabled is false
// by default, so every golden scenario's rent payments already flow through
// the new payRentAmount helper unmodified; 10/10 byte-identical after this
// task's edits is the "step 1(a)" gate, not duplicated here.
//
// The tests below cover the ENABLED behavior (offer creation), the
// eligibility matrix (mortgaged / own-property / disabled), and the
// card-moveTo landing path — using the RULES-mutation idiom established by
// engine-events-emit.test.js (`RULES.core.freeParkingPot = true` in a
// try/finally, or here a describe-scoped beforeEach/afterEach, since RULES is
// the shared live singleton mutated in place).
// ---------------------------------------------------------------------------
describe('Duel mechanism — landing interception (Task 3)', () => {
  function freshG() {
    const ctx = { numPlayers: 2, playOrder: ['0', '1'] };
    const G = Monopoly.setup(ctx);
    G.phase = 'play'; // skip character selection for gameplay tests
    return G;
  }

  function valForDie(n) {
    return (n - 1) / 6 + 0.01;
  }

  function makeCtx(currentPlayer = '0', d1 = 1, d2 = 2) {
    let i = 0;
    const values = [valForDie(d1), valForDie(d2)];
    return {
      currentPlayer,
      numPlayers: 2,
      random: { Number: () => values[i++ % values.length] },
      events: { endTurn: jest.fn(), setActivePlayers: jest.fn() },
    };
  }

  describe('ENABLED', () => {
    beforeEach(() => {
      RULES.duel.enabled = true;
    });
    afterEach(() => {
      RULES.duel.enabled = false; // restore the shared live RULES singleton
    });

    // Reuses golden-messages' 'rent-and-tax' scenario precondition VERBATIM
    // (same seed 96, same character picks, same script up to P1's rent-due
    // landing) — with the golden gate (duel disabled) that same script
    // produces "Paid $11 rent to Marcus Grayline for Oriental Ave." at this
    // exact step (fixtures/golden-messages.json, 'rent-and-tax' snapshot[5]).
    // Driven through the REAL boardgame.io Client (not direct move
    // invocation) so the assertion on G.turnPhase AFTER the move returns is
    // an honest proof that the Task 2 clobber-site fix survives Immer's
    // produce() wrapping the move, not just a hand-mutated G.
    test('seeded landing on an opponent property creates a duel OFFER instead of auto-paying rent', () => {
      const client = makeClient(2, 96);
      client.moves.selectCharacter('marcus-grayline'); // P0
      client.moves.selectCharacter('sophia-ember');     // P1
      client.moves.rollDice();     // P0 rolls 1+5=6, lands on Oriental Ave (unowned)
      client.moves.buyProperty();  // P0 buys Oriental Ave for $93
      client.moves.endTurn();
      client.moves.rollDice();     // P1 rolls 1+5=6, lands on P0's Oriental Ave -> rent $11 due

      const G = client.getState().G;

      // G.duel populated, rent frozen at landing time.
      expect(G.duel).toEqual({
        phase: 'offer', propertyId: 6, ownerId: '0', challengerId: '1', rent: 11,
      });
      // Behavioral clobber-fix proof: turnPhase is STILL 'duel' after the
      // move has fully returned (rollDice's own tail would otherwise set it
      // to 'act'/'done').
      expect(G.turnPhase).toBe('duel');

      // No rent_paid emitted — the money never moved.
      expect(G.events.filter(e => e.type === 'rent_paid')).toHaveLength(0);
      const p0 = G.players[0];
      expect(p0.money).toBe(1800 - 93); // starting money minus the Oriental Ave purchase only

      // Exactly one duel_offered event, full payload, correct actor (the challenger).
      const offered = G.events.filter(e => e.type === 'duel_offered');
      expect(offered).toHaveLength(1);
      expect(offered[0].actor).toBe('1');
      expect(offered[0].data).toEqual({ propertyId: 6, ownerId: '0', rent: 11 });

      // duel_offered's formatter returns null (Task 1) — no "Paid $X rent" line either.
      expect(G.messages.some(m => /rent/i.test(m))).toBe(false);
    });

    test('mortgaged property: rent is 0, auto-pays with no offer even when enabled', () => {
      const G = freshG();
      G.ownership[3] = '1'; // Baltic Ave owned by P1
      G.mortgaged[3] = true;
      const p0Money = G.players[0].money;
      const p1Money = G.players[1].money;

      Monopoly.moves.rollDice(G, makeCtx('0', 1, 2)); // P0 lands on Baltic Ave (id 3)

      expect(G.duel).toBeNull();
      expect(G.turnPhase).not.toBe('duel');
      expect(G.events.filter(e => e.type === 'duel_offered')).toHaveLength(0);
      const rentPaid = G.events.filter(e => e.type === 'rent_paid');
      expect(rentPaid).toHaveLength(1);
      expect(rentPaid[0].data).toEqual({ propertyId: 3, ownerId: '1', amount: 0 });
      expect(G.players[0].money).toBe(p0Money); // no money moved, rent is 0
      expect(G.players[1].money).toBe(p1Money);
    });

    test('landing on own property: no offer created (rent branch never entered)', () => {
      const G = freshG();
      G.ownership[3] = '0'; // P0 already owns Baltic Ave

      Monopoly.moves.rollDice(G, makeCtx('0', 1, 2));

      expect(G.duel).toBeNull();
      expect(G.turnPhase).not.toBe('duel');
      expect(G.events.filter(e => e.type === 'duel_offered')).toHaveLength(0);
      expect(G.events.filter(e => e.type === 'rent_paid')).toHaveLength(0);
    });

    // Card-moveTo landing (acceptCard path, mirrors this file's Task 2
    // acceptCard-clobber test): a moveTo card teleports P0 onto Baltic Ave
    // (owned by P1, unmortgaged, rent $8) via applyCard -> handleLanding.
    // Proves the offer is created from a card-driven landing too, and that
    // acceptCard's own turnPhase clobber line (Task 2 fix) preserves 'duel'
    // through the full move, including the chained applyCard call.
    test('card-moveTo landing on a rent-due opponent space creates an offer; turnPhase survives acceptCard', () => {
      const G = freshG();
      G.ownership[3] = '1'; // Baltic Ave owned by P1
      // A moveTo landing reaches calculateRent's diceTotal arg via G.lastDice
      // (irrelevant for a 'property' space — only railroad/utility rent use
      // it — but the property read itself needs a non-null G.lastDice, as it
      // would be in real play from the roll that drew this card).
      G.lastDice = { d1: 1, d2: 2, total: 3 };
      const card = { text: 'Advance to Baltic Ave', action: 'moveTo', value: 3 };
      G.pendingCard = { card, deck: 'chance', cardIndex: 0 };
      const p0Money = G.players[0].money;

      Monopoly.moves.acceptCard(G, makeCtx('0'));

      expect(G.pendingCard).toBeNull(); // sanity: the card was consumed
      expect(G.duel).toEqual({
        phase: 'offer', propertyId: 3, ownerId: '1', challengerId: '0', rent: 8,
      });
      expect(G.turnPhase).toBe('duel'); // NOT clobbered to 'act'/'done' by acceptCard's tail
      expect(G.players[0].money).toBe(p0Money); // no rent auto-paid
      expect(G.events.filter(e => e.type === 'rent_paid')).toHaveLength(0);
      expect(G.events.filter(e => e.type === 'duel_offered')).toHaveLength(1);
    });
  });

  describe('DISABLED (explicit control)', () => {
    beforeEach(() => {
      RULES.duel.enabled = false; // explicit — this is already the default, asserted for clarity
    });

    // Control run: identical scenario/seed to engine-events-emit.test.js's
    // pinned 'rent_paid' test (written before this task's helper extraction),
    // proving payRentAmount's lift is byte-identical to the pre-extraction
    // inline code it replaced.
    test('auto-pay path (via the new payRentAmount helper) is byte-identical to the pre-extraction message', () => {
      const G = freshG();
      G.ownership[3] = '1'; // Baltic Ave owned by P1
      const p0Money = G.players[0].money;
      const p1Money = G.players[1].money;

      Monopoly.moves.rollDice(G, makeCtx('0', 1, 2)); // P0 lands on Baltic Ave, rent $8

      expect(G.duel).toBeNull();
      expect(G.turnPhase).not.toBe('duel');
      const rentPaid = G.events.filter(e => e.type === 'rent_paid');
      expect(rentPaid).toHaveLength(1);
      expect(rentPaid[0].data).toEqual({ propertyId: 3, ownerId: '1', amount: 8 });
      expect(G.players[0].money).toBe(p0Money - 8);
      expect(G.players[1].money).toBe(p1Money + 8);
      expect(G.messages).toContain('Paid $8 rent to Player 2 for Baltic Ave.');
    });
  });
});
