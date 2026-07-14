import { INVALID_MOVE } from 'boardgame.io/core';
import { Client } from 'boardgame.io/client';
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
// These tests craft G.duel directly to prove the original 8 non-roll guards
// are un-bypassable and inert-when-null, and that the 3 turnPhase-clobber
// sites in Game.js now preserve 'duel' the same way they already preserved
// 'card'. rollDice/rollOnly's own (defensive, final-review Fix 1b) guards are
// covered separately below — they need G.hasRolled=false to even be
// reachable, a precondition the other 8 moves don't share.
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

  // Final-review Fix 1b: rollDice/rollOnly gain a defensive `if (G.duel)
  // return INVALID_MOVE;`, same shape as the 8 guards above. Needs
  // G.hasRolled=false to even reach the new guard line (rollDice/rollOnly's
  // own pre-existing `if (G.hasRolled) return INVALID_MOVE;` would otherwise
  // block first) — every real-play path that sets G.duel already has
  // hasRolled=true, so this only matters for defense-in-depth / a
  // not-yet-onBegin-cleared stale G.duel with hasRolled reset independently.
  test('rollDice: rejected when G.duel is set even with hasRolled=false, succeeds once G.duel clears', () => {
    const G = freshG();
    G.hasRolled = false;
    G.duel = activeDuel();

    const blocked = Monopoly.moves.rollDice(G, makeCtx('0', 1, 2));
    expect(blocked).toBe(INVALID_MOVE);
    expect(G.hasRolled).toBe(false);

    G.duel = null;
    const result = Monopoly.moves.rollDice(G, makeCtx('0', 1, 2));
    expect(result).not.toBe(INVALID_MOVE);
    expect(G.hasRolled).toBe(true);
  });

  test('rollOnly: rejected when G.duel is set even with hasRolled=false, succeeds once G.duel clears', () => {
    const G = freshG();
    G.hasRolled = false;
    G.duel = activeDuel();

    const blocked = Monopoly.moves.rollOnly(G, makeCtx('0', 1, 2));
    expect(blocked).toBe(INVALID_MOVE);
    expect(G.hasRolled).toBe(false);

    G.duel = null;
    const result = Monopoly.moves.rollOnly(G, makeCtx('0', 1, 2));
    expect(result).not.toBe(INVALID_MOVE);
    expect(G.hasRolled).toBe(true);
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
    // produces "Paid $12 rent to Marcus Grayline for Oriental Ave." at this
    // exact step (fixtures/golden-messages.json, 'rent-and-tax' snapshot[5]).
    // Rent stat modifiers (Task 1, stat-mechanics): Oriental Ave base rent
    // $12, owner Marcus negotiation 7 -> min(7*0.015, 0.135) = 0.105
    //   -> 12 * 1.105 = 13.26
    // payer Sophia charisma 5% off -> 13.26 * 0.95 = 12.597 -> floor = 12.
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
      client.moves.rollDice();     // P1 rolls 1+5=6, lands on P0's Oriental Ave -> rent $12 due

      const G = client.getState().G;

      // G.duel populated, rent frozen at landing time.
      expect(G.duel).toEqual({
        phase: 'offer', propertyId: 6, ownerId: '0', challengerId: '1', rent: 12,
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
      expect(offered[0].data).toEqual({ propertyId: 6, ownerId: '0', rent: 12 });

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

// ---------------------------------------------------------------------------
// Task 4: the four duel-resolution moves (payRent / initiateDuel /
// respondDuel / declineDuel) + per-challenger cooldown + enforceSeats
// envelopes.
//
// Driving style: direct `Monopoly.moves.X(G, ctx, ...)` invocation against a
// hand-built G (Task 2 / engine-seats-unit.test.js precedent) for the
// controlled win/lose/tie/decline/cooldown matrix — hand-crafting G.duel and
// G.players[i].character.stats gives exact, seed-independent control over
// dice totals and stat sums, which a real seeded Client would otherwise need
// a seed hunt for (especially the tie case). A real-Client integration run
// (reusing Task 3's seed-96 scenario) proves the whole landing -> offer ->
// initiate -> respond pipeline wires up through boardgame.io's actual
// reducer, and is repeated verbatim on the identical seed to prove
// determinism through the REAL seeded PRNG (not just a mocked ctx.random
// returning the same values twice, which would be trivially true by
// construction).
// ---------------------------------------------------------------------------
describe('Duel mechanism — resolution moves (Task 4)', () => {
  function freshG() {
    const ctx = { numPlayers: 2, playOrder: ['0', '1'] };
    const G = Monopoly.setup(ctx);
    G.phase = 'play'; // skip character selection for gameplay tests
    return G;
  }

  function valForDie(n) {
    return (n - 1) / 6 + 0.01;
  }

  // ctx.random.Number() yields the given die faces in call order.
  // respondDuel's pinned roll order (Game.js) is: challenger d1, d2, then
  // defender d1, d2.
  function ctxWithDice(currentPlayer, dice) {
    let i = 0;
    const values = dice.length ? dice.map(valForDie) : [0.5];
    return {
      currentPlayer,
      numPlayers: 2,
      random: { Number: () => values[i++ % values.length] },
      events: { endTurn: jest.fn(), setActivePlayers: jest.fn() },
    };
  }

  // A full stats object (all six axes) so calculateRent/passives-adjacent
  // reads elsewhere never see a partial shape — only stamina/luck matter to
  // respondDuel's roll(), but the real character data always carries all six
  // (mods/dominion/characters-data.js), so tests match that shape.
  function statChar(stats) {
    return {
      id: 'test-char', name: 'Test Character', passive: {},
      stats: { capital: 5, luck: 4, negotiation: 5, charisma: 5, tech: 5, stamina: 4, ...stats },
    };
  }

  // Pinned envelope shape (Task 3): propertyId 3 = Baltic Ave, rent 8,
  // owner P1, challenger P0 — same fixture used by this file's Task 3
  // 'DISABLED... byte-identical' control test, so payRent's rent_paid text
  // can be asserted byte-for-byte against it.
  function offerDuel(overrides) {
    return { phase: 'offer', propertyId: 3, ownerId: '1', challengerId: '0', rent: 8, ...overrides };
  }
  function responseDuel(overrides) {
    return { phase: 'response', propertyId: 3, ownerId: '1', challengerId: '0', rent: 8, ...overrides };
  }

  describe('payRent', () => {
    test('pays exactly the frozen rent, clears the duel, sets turnPhase done — byte-equal rent_paid text to a control non-duel landing', () => {
      const G = freshG();
      G.duel = offerDuel();
      const p0Before = G.players[0].money;
      const p1Before = G.players[1].money;

      const result = Monopoly.moves.payRent(G, ctxWithDice('0', []));

      expect(result).not.toBe(INVALID_MOVE);
      expect(G.duel).toBeNull();
      expect(G.turnPhase).toBe('done');
      expect(G.players[0].money).toBe(p0Before - 8);
      expect(G.players[1].money).toBe(p1Before + 8);
      const rentPaid = G.events.filter(e => e.type === 'rent_paid');
      expect(rentPaid).toHaveLength(1);
      expect(rentPaid[0].data).toEqual({ propertyId: 3, ownerId: '1', amount: 8 });
      // Byte-identical to this file's Task 3 'DISABLED' control test's
      // rent_paid message (same board space/rent/actors) — proves payRent's
      // reuse of payRentAmount produces the exact same text as the ordinary
      // auto-pay landing path.
      expect(G.messages).toContain('Paid $8 rent to Player 2 for Baltic Ave.');

      // turnPhase 'done' proof: endTurn now succeeds.
      G.hasRolled = true;
      const ctx2 = ctxWithDice('0', []);
      expect(Monopoly.moves.endTurn(G, ctx2)).not.toBe(INVALID_MOVE);
      expect(ctx2.events.endTurn).toHaveBeenCalled();
    });

    test('guards: no duel / wrong phase -> INVALID_MOVE, nothing mutated', () => {
      const G = freshG();
      const p0Before = G.players[0].money;
      expect(Monopoly.moves.payRent(G, ctxWithDice('0', []))).toBe(INVALID_MOVE); // G.duel is null
      expect(G.players[0].money).toBe(p0Before);

      G.duel = responseDuel(); // wrong phase (already escalated to a duel)
      expect(Monopoly.moves.payRent(G, ctxWithDice('0', []))).toBe(INVALID_MOVE);
      expect(G.duel).not.toBeNull();
      expect(G.players[0].money).toBe(p0Before);
    });
  });

  describe('initiateDuel + cooldown', () => {
    test('offer -> response, records lastDuelTurn, emits duel_initiated, no payment yet', () => {
      const G = freshG();
      G.duel = offerDuel();
      G.totalTurns = 5;
      const p0Before = G.players[0].money;

      const result = Monopoly.moves.initiateDuel(G, ctxWithDice('0', []));

      expect(result).not.toBe(INVALID_MOVE);
      expect(G.duel.phase).toBe('response');
      expect(G.players[0].lastDuelTurn).toBe(5); // challenger is P0
      expect(G.players[0].money).toBe(p0Before); // untouched — no payment on initiate
      const initiated = G.events.filter(e => e.type === 'duel_initiated');
      expect(initiated).toHaveLength(1);
      expect(initiated[0].actor).toBe('0');
      expect(initiated[0].data).toEqual({ propertyId: 3, ownerId: '1', rent: 8 });
    });

    test('cooldown blocks a second initiate within cooldownTurns; payRent still works meanwhile', () => {
      const G = freshG();
      G.players[0].lastDuelTurn = 5; // challenger initiated a duel back on turn 5
      G.totalTurns = 7; // 2 turns later (< cooldownTurns=3)
      G.duel = offerDuel(); // a fresh offer from landing on the property again

      const result = Monopoly.moves.initiateDuel(G, ctxWithDice('0', []));
      expect(result).toBe(INVALID_MOVE);
      expect(G.duel.phase).toBe('offer'); // untouched
      expect(G.players[0].lastDuelTurn).toBe(5); // untouched

      // payRent carries no cooldown gate — still available as the fallback.
      const payResult = Monopoly.moves.payRent(G, ctxWithDice('0', []));
      expect(payResult).not.toBe(INVALID_MOVE);
      expect(G.duel).toBeNull();
    });

    test('cooldown expires exactly at cooldownTurns -> initiate allowed again', () => {
      const G = freshG();
      G.players[0].lastDuelTurn = 5;
      G.totalTurns = 8; // 8 - 5 = 3 == cooldownTurns (not <)
      G.duel = offerDuel();

      const result = Monopoly.moves.initiateDuel(G, ctxWithDice('0', []));
      expect(result).not.toBe(INVALID_MOVE);
      expect(G.duel.phase).toBe('response');
      expect(G.players[0].lastDuelTurn).toBe(8);
    });

    test('cooldownTurns=0 disables the cooldown entirely', () => {
      const original = RULES.duel.cooldownTurns;
      RULES.duel.cooldownTurns = 0;
      try {
        const G = freshG();
        G.players[0].lastDuelTurn = 9;
        G.totalTurns = 9; // same turn — would fail under the default cooldown
        G.duel = offerDuel();

        const result = Monopoly.moves.initiateDuel(G, ctxWithDice('0', []));
        expect(result).not.toBe(INVALID_MOVE);
        expect(G.duel.phase).toBe('response');
      } finally {
        RULES.duel.cooldownTurns = original; // restore the shared live RULES singleton
      }
    });
  });

  describe('respondDuel', () => {
    test('challenger wins (higher total): rent waived, no payment, full payload, dice arrays length 2', () => {
      const G = freshG();
      G.players[0].character = statChar({ stamina: 10, luck: 0 }); // challenger
      G.players[1].character = statChar({ stamina: 2, luck: 0 });  // owner/defender
      G.duel = responseDuel();
      G.hasRolled = true;
      const p0Before = G.players[0].money;
      const p1Before = G.players[1].money;

      const ctx = ctxWithDice('1', [6, 6, 1, 1]); // challenger 6+6, defender 1+1
      const result = Monopoly.moves.respondDuel(G, ctx);

      expect(result).not.toBe(INVALID_MOVE);
      expect(G.duel).toBeNull();
      expect(G.turnPhase).toBe('done');
      expect(G.players[0].money).toBe(p0Before); // waived — no transfer
      expect(G.players[1].money).toBe(p1Before);
      expect(G.events.filter(e => e.type === 'rent_paid')).toHaveLength(0);

      const resolved = G.events.filter(e => e.type === 'duel_resolved');
      expect(resolved).toHaveLength(1);
      expect(resolved[0].actor).toBe('0'); // challenger
      const { data } = resolved[0];
      expect(data.propertyId).toBe(3);
      expect(data.ownerId).toBe('1');
      expect(data.winnerId).toBe('0');
      expect(data.outcome).toBe('waived');
      // rent (final-review Fix 2a): duel_resolved now carries its own frozen
      // rent, additive to the prior payload — no longer only on duel_initiated.
      expect(data.rent).toBe(8);
      expect(data.challengerRoll.dice).toEqual([6, 6]);
      expect(data.challengerRoll.dice).toHaveLength(2);
      expect(data.challengerRoll.stamina).toBe(10);
      expect(data.challengerRoll.luckBonus).toBe(0);
      expect(data.challengerRoll.total).toBe(22); // 6+6+10+0
      expect(data.defenderRoll.dice).toEqual([1, 1]);
      expect(data.defenderRoll.dice).toHaveLength(2);
      expect(data.defenderRoll.total).toBe(4); // 1+1+2+0

      // turnPhase 'done' proof: endTurn now succeeds.
      const ctx2 = ctxWithDice('0', []);
      expect(Monopoly.moves.endTurn(G, ctx2)).not.toBe(INVALID_MOVE);
      expect(ctx2.events.endTurn).toHaveBeenCalled();
    });

    test('challenger loses: 2x rent paid to owner, payload outcome "double"', () => {
      const G = freshG();
      G.players[0].character = statChar({ stamina: 1, luck: 0 });
      G.players[1].character = statChar({ stamina: 10, luck: 0 });
      G.duel = responseDuel();
      G.hasRolled = true;
      const p0Before = G.players[0].money;
      const p1Before = G.players[1].money;

      const ctx = ctxWithDice('1', [1, 1, 6, 6]);
      const result = Monopoly.moves.respondDuel(G, ctx);

      expect(result).not.toBe(INVALID_MOVE);
      expect(G.duel).toBeNull();
      expect(G.turnPhase).toBe('done');
      expect(G.players[0].money).toBe(p0Before - 16); // loseMultiplier(2) * rent(8)
      expect(G.players[1].money).toBe(p1Before + 16);
      const rentPaid = G.events.filter(e => e.type === 'rent_paid');
      expect(rentPaid).toHaveLength(1);
      expect(rentPaid[0].data).toEqual({ propertyId: 3, ownerId: '1', amount: 16 });
      const resolved = G.events.filter(e => e.type === 'duel_resolved');
      expect(resolved[0].data.outcome).toBe('double');
      expect(resolved[0].data.winnerId).toBe('1');
      expect(resolved[0].data.rent).toBe(8); // final-review Fix 2a

      const ctx2 = ctxWithDice('0', []);
      expect(Monopoly.moves.endTurn(G, ctx2)).not.toBe(INVALID_MOVE);
    });

    test('challenger loses and cannot cover 2x rent -> bankruptcy; properties transfer to owner; G.duel already null before the payout', () => {
      const G = freshG();
      G.players[0].character = statChar({ stamina: 1, luck: 0 });
      G.players[0].money = 10;
      G.players[0].properties = [5];
      G.ownership[5] = '0';
      G.players[1].character = statChar({ stamina: 10, luck: 0 });
      G.duel = responseDuel(); // rent 8 -> loss payment 16 > 10 available
      G.hasRolled = true;

      const ctx = ctxWithDice('1', [1, 1, 6, 6]);
      const result = Monopoly.moves.respondDuel(G, ctx);

      expect(result).not.toBe(INVALID_MOVE);
      expect(G.duel).toBeNull();
      expect(G.players[0].bankrupt).toBe(true);
      expect(G.players[0].money).toBe(0);
      expect(G.ownership[5]).toBe('1'); // property transferred to the creditor (duel owner)
      const bankruptcy = G.events.filter(e => e.type === 'bankruptcy');
      expect(bankruptcy).toHaveLength(1);
      expect(bankruptcy[0].data).toEqual({ creditorId: '1' });
      expect(G.turnPhase).toBe('done');
    });

    test('tie total (tieGoesToDefender default true): defender/owner wins, loss payment still fires', () => {
      const G = freshG();
      G.players[0].character = statChar({ stamina: 4, luck: 0 });
      G.players[1].character = statChar({ stamina: 4, luck: 0 });
      G.duel = responseDuel();
      G.hasRolled = true;

      // Equal dice + equal stats -> equal totals. Engineered by direct stat
      // assignment (both characters given stamina:4/luck:0 above) and a
      // symmetric dice sequence, rather than a seed hunt through the real
      // Client's PRNG — see this describe block's header comment.
      const ctx = ctxWithDice('1', [3, 3, 3, 3]);
      const result = Monopoly.moves.respondDuel(G, ctx);

      expect(result).not.toBe(INVALID_MOVE);
      const resolved = G.events.filter(e => e.type === 'duel_resolved')[0];
      expect(resolved.data.challengerRoll.total).toBe(resolved.data.defenderRoll.total);
      expect(resolved.data.winnerId).toBe('1'); // owner/defender wins the tie
      expect(resolved.data.outcome).toBe('double');
      expect(resolved.data.rent).toBe(8); // final-review Fix 2a
      expect(G.events.filter(e => e.type === 'rent_paid')).toHaveLength(1); // tie = challenger loses
    });

    test('guards: no duel / wrong phase (still "offer", not "response") -> INVALID_MOVE', () => {
      const G = freshG();
      expect(Monopoly.moves.respondDuel(G, ctxWithDice('1', [3, 3, 3, 3]))).toBe(INVALID_MOVE);
      G.duel = offerDuel();
      expect(Monopoly.moves.respondDuel(G, ctxWithDice('1', [3, 3, 3, 3]))).toBe(INVALID_MOVE);
      expect(G.duel.phase).toBe('offer');
    });
  });

  describe('declineDuel', () => {
    test('pays ordinary (single) rent only, no dice rolled, clears the duel', () => {
      const G = freshG();
      G.duel = responseDuel();
      G.hasRolled = true;
      const p0Before = G.players[0].money;
      const p1Before = G.players[1].money;

      const ctx = ctxWithDice('1', []);
      const result = Monopoly.moves.declineDuel(G, ctx);

      expect(result).not.toBe(INVALID_MOVE);
      expect(G.duel).toBeNull();
      expect(G.turnPhase).toBe('done');
      expect(G.players[0].money).toBe(p0Before - 8); // single rent, not doubled
      expect(G.players[1].money).toBe(p1Before + 8);
      expect(G.events.filter(e => e.type === 'duel_resolved')).toHaveLength(0); // no roll happened
      const declined = G.events.filter(e => e.type === 'duel_declined');
      expect(declined).toHaveLength(1);
      expect(declined[0].actor).toBe('1'); // owner
      expect(declined[0].data).toEqual({ challengerId: '0', propertyId: 3 });
      const rentPaid = G.events.filter(e => e.type === 'rent_paid');
      expect(rentPaid).toHaveLength(1);
      expect(rentPaid[0].data).toEqual({ propertyId: 3, ownerId: '1', amount: 8 });

      // turnPhase 'done' proof: endTurn now succeeds.
      const ctx2 = ctxWithDice('0', []);
      expect(Monopoly.moves.endTurn(G, ctx2)).not.toBe(INVALID_MOVE);
    });

    test('guards: no duel / wrong phase -> INVALID_MOVE', () => {
      const G = freshG();
      expect(Monopoly.moves.declineDuel(G, ctxWithDice('1', []))).toBe(INVALID_MOVE);
      G.duel = offerDuel(); // still 'offer', not 'response'
      expect(Monopoly.moves.declineDuel(G, ctxWithDice('1', []))).toBe(INVALID_MOVE);
    });
  });

  describe('determinism (direct-invocation control)', () => {
    test('identical dice/stat inputs -> identical dice arrays and totals across two independent runs', () => {
      function run() {
        const G = freshG();
        G.players[0].character = statChar({ stamina: 3, luck: 2 });
        G.players[1].character = statChar({ stamina: 5, luck: 4 });
        G.duel = responseDuel();
        G.hasRolled = true;
        const ctx = ctxWithDice('1', [2, 5, 4, 1]);
        Monopoly.moves.respondDuel(G, ctx);
        return G.events.filter(e => e.type === 'duel_resolved')[0].data;
      }
      const a = run();
      const b = run();
      expect(a.challengerRoll.dice).toEqual(b.challengerRoll.dice);
      expect(a.defenderRoll.dice).toEqual(b.defenderRoll.dice);
      expect(a.challengerRoll.total).toBe(b.challengerRoll.total);
      expect(a.defenderRoll.total).toBe(b.defenderRoll.total);
    });
  });
});

// ---------------------------------------------------------------------------
// Task 4: end-to-end proof through the REAL boardgame.io Client — the
// hand-built-G tests above control dice/stats directly; this proves the same
// four moves wire up correctly when driven through the actual reducer on top
// of Task 3's real landing-interception flow, and that the real seeded PRNG
// (not a mocked ctx.random) reproduces identical dice given the identical
// seed + script.
// ---------------------------------------------------------------------------
describe('Duel mechanism — end-to-end via real seeded Client (Task 4)', () => {
  beforeEach(() => {
    RULES.duel.enabled = true;
  });
  afterEach(() => {
    RULES.duel.enabled = false; // restore the shared live RULES singleton
  });

  // Reuses Task 3's landing-interception scenario verbatim (seed 96,
  // marcus-grayline P0 / sophia-ember P1, P0 buys Oriental Ave, P1 lands on
  // it owing $12 rent — see Task 3's test above for the stat-modifier
  // arithmetic) through to full duel resolution.
  function playToResolution() {
    const client = makeClient(2, 96);
    client.moves.selectCharacter('marcus-grayline'); // P0 (owner)
    client.moves.selectCharacter('sophia-ember');     // P1 (challenger)
    client.moves.rollDice();     // P0 lands on Oriental Ave (unowned)
    client.moves.buyProperty();  // P0 buys it
    client.moves.endTurn();
    client.moves.rollDice();     // P1 lands on P0's Oriental Ave -> duel offer
    client.moves.initiateDuel(); // P1 (challenger) escalates the offer
    client.moves.respondDuel();  // P0 (owner) rolls to defend
    return client.getState().G;
  }

  test('offer -> initiate -> respond resolves through the real Client; turnPhase done; endTurn succeeds', () => {
    const G = playToResolution();
    expect(G.duel).toBeNull();
    expect(G.turnPhase).toBe('done');
    const resolved = G.events.filter(e => e.type === 'duel_resolved');
    expect(resolved).toHaveLength(1);
    expect(resolved[0].data.challengerRoll.dice).toHaveLength(2);
    expect(resolved[0].data.defenderRoll.dice).toHaveLength(2);
    expect(resolved[0].data.rent).toBe(12); // final-review Fix 2a — real-Client proof
    const initiated = G.events.filter(e => e.type === 'duel_initiated');
    expect(initiated).toHaveLength(1);
    expect(initiated[0].data).toEqual({ propertyId: 6, ownerId: '0', rent: 12 });
  });

  test('same seed run twice -> byte-identical dice arrays and outcome (determinism through the real PRNG)', () => {
    const run1 = playToResolution();
    const run2 = playToResolution();
    const r1 = run1.events.filter(e => e.type === 'duel_resolved')[0].data;
    const r2 = run2.events.filter(e => e.type === 'duel_resolved')[0].data;
    expect(r1.challengerRoll.dice).toEqual(r2.challengerRoll.dice);
    expect(r1.defenderRoll.dice).toEqual(r2.defenderRoll.dice);
    expect(r1.winnerId).toBe(r2.winnerId);
    expect(r1.outcome).toBe(r2.outcome);
  });
});

// ---------------------------------------------------------------------------
// Final-review Fix 1 — mid-duel save/load soft-lock.
//
// turn.onBegin resets turnPhase/hasRolled/pendingCard for the new turn but
// (pre-fix) left G.duel untouched. A save taken while a duel offer/response
// was pending, then loaded later, would resurrect a G.duel envelope frozen at
// save time while turnPhase/hasRolled had already been reset to a fresh
// 'roll' turn by the SAME onBegin call that fires once at load (App.js's
// _resumeLoad convention — see Game.test.js's "load resume" describe block).
// Every OTHER move stays permanently blocked by the mid-duel guards (this
// file's Task 2 section, now 10 guards with Fix 1b's rollDice/rollOnly
// additions) with no legal way left to ever clear G.duel again (the four
// duel-resolution moves all require G.duel.phase to be 'offer'/'response',
// but nothing in a post-load turn can ever RE-CREATE that exact envelope) —
// a permanent soft-lock.
//
// Fix 1a clears G.duel unconditionally in onBegin, justified by: endTurn is
// unconditionally blocked while G.duel is set, so live play can never reach
// onBegin (a NEW turn beginning) with G.duel still non-null — a non-null
// G.duel observed AT onBegin time is therefore PROVABLY stale (loaded), never
// a live in-progress duel, making the unconditional clear safe.
//
// These tests reconstruct the real App.js loadGame reload path (JSON
// round-trip + the stub-setup Client shape — mirrors this same file's sibling
// engine-events-emit.test.js "loadGame backfill for old saves" test and the
// literal in App.js's loadGame, ~line 2488) for BOTH points a save could
// freeze a duel: mid-OFFER (before initiateDuel) and mid-RESPONSE (after
// initiateDuel, before respondDuel) — per the brief's "repeat for mid-response
// phase" requirement.
// ---------------------------------------------------------------------------
describe('Duel mechanism — mid-duel save/load soft-lock (final-review Fix 1)', () => {
  beforeEach(() => {
    RULES.duel.enabled = true;
  });
  afterEach(() => {
    RULES.duel.enabled = false; // restore the shared live RULES singleton
  });

  // Reuses the Task 3/Task 4 seed-96 scenario verbatim: P0 (marcus-grayline)
  // buys Oriental Ave, P1 (sophia-ember) lands on it owing $12 rent -> offer.
  function playToOffer() {
    const client = makeClient(2, 96);
    client.moves.selectCharacter('marcus-grayline'); // P0 (owner)
    client.moves.selectCharacter('sophia-ember');     // P1 (challenger)
    client.moves.rollDice();     // P0 lands on Oriental Ave (unowned)
    client.moves.buyProperty();  // P0 buys it
    client.moves.endTurn();
    client.moves.rollDice();     // P1 lands on P0's Oriental Ave -> duel offer
    return client;
  }

  function playToResponse() {
    const client = playToOffer();
    client.moves.initiateDuel(); // P1 (challenger) escalates offer -> response
    return client;
  }

  // Mirrors App.js's loadGame() setup-override literal (~line 2488) exactly,
  // including the JSON round-trip (real saves go through localStorage's
  // JSON.stringify/JSON.parse, which is also what strips functions/undefined
  // and proves G is plain-data-serializable).
  function reloadFrom(G, numPlayers) {
    const savedG = JSON.parse(JSON.stringify(G));
    const LoadedGame = {
      ...Monopoly,
      setup: () => ({
        ...savedG,
        events: savedG.events || [],
        eventSeq: savedG.eventSeq || 0,
        enforceSeats: savedG.enforceSeats || false,
        _resumeLoad: true,
      }),
    };
    const client = Client({ game: LoadedGame, numPlayers, debug: false });
    client.start();
    return client;
  }

  // Rolls, then resolves whatever gates the roll lands on (pendingCard /
  // canBuy / a legitimate NEW duel offer — RULES.duel.enabled is left ON
  // through this helper so it's honest about what a real post-load turn
  // could hit), then ends the turn — asserting each step is NOT blocked.
  // The turn actually advancing (ctx.turn increments) is the end-to-end
  // "the game is playable again" proof the brief asks for.
  function driveOneFullTurn(client) {
    client.moves.rollDice();
    expect(client.getState().G.hasRolled).toBe(true); // rollDice was NOT blocked

    for (let i = 0; i < 6; i++) {
      const G = client.getState().G;
      if (G.pendingCard) { client.moves.acceptCard(); continue; }
      // buyProperty, not passProperty — passing sends the property to auction,
      // a whole separate sub-state-machine this helper isn't trying to drive;
      // both seats start with plenty of cash for any early-board price.
      if (G.canBuy) { client.moves.buyProperty(); continue; }
      if (G.duel && G.duel.phase === 'offer') { client.moves.payRent(); continue; }
      break;
    }

    const turnBefore = client.getState().ctx.turn;
    client.moves.endTurn();
    const stateAfter = client.getState();
    expect(stateAfter.ctx.turn).toBeGreaterThan(turnBefore); // endTurn was NOT blocked
  }

  test('save mid-OFFER, reload -> G.duel cleared by onBegin, turnPhase roll, game is fully playable again', () => {
    const original = playToOffer();
    const saved = original.getState().G;
    // Sanity: this really is the frozen mid-duel state the fix targets.
    expect(saved.duel).not.toBeNull();
    expect(saved.duel.phase).toBe('offer');
    expect(saved.turnPhase).toBe('duel');
    expect(saved.hasRolled).toBe(true);

    const client = reloadFrom(saved, 2);
    const G = client.getState().G;

    // The fix, directly: onBegin fired once at load (App.js's _resumeLoad
    // convention) and cleared the stale envelope instead of leaving it frozen
    // alongside a freshly-reset turnPhase/hasRolled.
    expect(G.duel).toBeNull();
    expect(G.turnPhase).toBe('roll');
    expect(G.hasRolled).toBe(false);

    driveOneFullTurn(client); // rollDice succeeds; endTurn eventually succeeds
  });

  test('save mid-RESPONSE, reload -> G.duel cleared by onBegin, turnPhase roll, game is fully playable again', () => {
    const original = playToResponse();
    const saved = original.getState().G;
    expect(saved.duel).not.toBeNull();
    expect(saved.duel.phase).toBe('response');
    expect(saved.turnPhase).toBe('duel');
    expect(saved.hasRolled).toBe(true);

    const client = reloadFrom(saved, 2);
    const G = client.getState().G;

    expect(G.duel).toBeNull();
    expect(G.turnPhase).toBe('roll');
    expect(G.hasRolled).toBe(false);

    driveOneFullTurn(client);
  });
});
