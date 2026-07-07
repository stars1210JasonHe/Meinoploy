// Task 3 (migration slice 1): payload assertions for the roll/move/landing
// typed events — dice_rolled, moved, salary_collected, passive_triggered
// (idealist go/hub, financier tax), rent_paid, tax_paid, went_to_jail,
// left_jail, jail_fine_paid, character_selected (all-selected transition).
// Grows in Tasks 4-6 as later migration slices add their own event types.
//
// Two driving styles are used, both already established in this codebase:
//  - Direct move invocation — `Monopoly.moves.X(G, ctx)` against a hand-built
//    G (via Monopoly.setup) and a ctx with a mocked ctx.random — the SAME
//    pattern src/__tests__/Game.test.js already uses hundreds of times. This
//    gives precise, deterministic access to branches that would otherwise
//    require brute-force seed-hunting through a real Client (triple doubles,
//    forced jail-turn outcomes, atlas hub/dead-end routing, toggled rules).
//  - The Task 2 harness (makeClient/playScript, src/__tests__/helpers/drive.js)
//    for an end-to-end integration check that a full scripted game produces a
//    well-formed G.events stream (seq monotonicity, per the task brief).
import { INVALID_MOVE } from 'boardgame.io/core';
import { Monopoly } from '../Game';
import { getCharacterById, RULES } from '../../mods/dominion';
import { makeClient, playScript, ifCanBuy, ifPendingCard } from './helpers/drive';

// --- shared helpers (mirror Game.test.js's own; not exported from there) ---

function freshG() {
  const ctx = { numPlayers: 2, playOrder: ['0', '1'] };
  const G = Monopoly.setup(ctx);
  G.phase = 'play'; // skip character selection for gameplay tests
  return G;
}

function valForDie(n) {
  return (n - 1) / 6 + 0.01;
}

// ctx with a mocked random that produces the given d1/d2 on the first roll
// (and repeats the same pair if random.Number() is called again).
function makeCtx(currentPlayer = '0', d1 = 1, d2 = 2) {
  let i = 0;
  const values = [valForDie(d1), valForDie(d2)];
  return {
    currentPlayer,
    numPlayers: 2,
    random: { Number: () => values[i++ % values.length] },
    events: { endTurn: jest.fn() },
  };
}

function eventsOfType(G, type) {
  return G.events.filter(e => e.type === type);
}

// Minimal 2-node atlas board: node 0 (start) -> node 1 (hub, dead end).
// A roll with total > 1 always dead-ends at node 1, exercising both the
// hub-salary payout and the route-exhausted 'moved' notice in one call.
function atlasG() {
  const G = freshG();
  G.board = {
    ...G.board,
    movementMode: 'atlas',
    edges: { 0: [1], 1: [] },
    spaces: [
      { id: 0, type: 'go', name: 'Start', price: 0, rent: 0 },
      { id: 1, type: 'go', name: 'Hub', price: 0, rent: 0, isHub: true },
    ],
    boardSize: 2,
    jail: null,
  };
  G.ownership = {};
  return G;
}

// ---------------------------------------------------------------------------

describe('dice_rolled', () => {
  test('payload {d1,d2,total,doubles}; actor is the roller', () => {
    const G = freshG();
    Monopoly.moves.rollDice(G, makeCtx('0', 1, 2)); // non-double, total 3 -> Baltic Ave
    const rolls = eventsOfType(G, 'dice_rolled');
    expect(rolls).toHaveLength(1);
    expect(rolls[0].actor).toBe('0');
    expect(rolls[0].data).toEqual({ d1: 1, d2: 2, total: 3, doubles: false });
    expect(G.messages).toContain('Player 1 rolled 1 + 2 = 3');
  });

  test('resetMessages clears the per-turn buffer on every roll while G.events keeps growing', () => {
    const G = freshG();
    Monopoly.moves.rollDice(G, makeCtx('0', 1, 2));
    const afterFirst = G.events.length;
    // Simulate a fresh turn's roll without the full turn.onBegin machinery
    // (this file drives moves directly; only hasRolled/turnPhase gate rollDice).
    G.turnPhase = 'roll';
    G.hasRolled = false;
    Monopoly.moves.rollDice(G, makeCtx('0', 2, 5));
    expect(G.events.length).toBeGreaterThan(afterFirst);
    expect(G.messages.some(m => m.includes('rolled 1 + 2'))).toBe(false);
    expect(G.messages.some(m => m.includes('rolled 2 + 5'))).toBe(true);
  });
});

describe('moved', () => {
  test('payload {from,to,passedGo:false} on a same-lap move; renders "Landed on X"', () => {
    const G = freshG();
    Monopoly.moves.rollDice(G, makeCtx('0', 1, 2)); // 0 -> 3 (Baltic Ave)
    const moved = eventsOfType(G, 'moved').filter(e => !e.data.note && !e.data.routeExhausted);
    expect(moved).toHaveLength(1);
    expect(moved[0].data).toEqual({ from: 0, to: 3, passedGo: false });
    expect(G.messages).toContain('Landed on Baltic Ave.');
  });

  test('property landing notes: available / unaffordable / owned', () => {
    let G = freshG();
    Monopoly.moves.rollDice(G, makeCtx('0', 1, 2)); // -> Baltic Ave ($60), unowned, affordable
    let note = eventsOfType(G, 'moved').find(e => e.data.note === 'available');
    expect(note.data).toEqual({ note: 'available', propertyId: 3, listPrice: 60, effectivePrice: 60 });
    expect(G.messages).toContain('Baltic Ave is available for $60. Buy or pass?');

    G = freshG();
    G.players[0].money = 10;
    Monopoly.moves.rollDice(G, makeCtx('0', 4, 5)); // -> Connecticut Ave ($120)
    note = eventsOfType(G, 'moved').find(e => e.data.note === 'unaffordable');
    expect(note.data).toEqual({ note: 'unaffordable', propertyId: 9, price: 120, playerMoney: 10 });
    expect(G.messages).toContain('Connecticut Ave costs $120 but you only have $10.');

    G = freshG();
    G.ownership[3] = '0'; // already owns Baltic Ave
    Monopoly.moves.rollDice(G, makeCtx('0', 1, 2));
    note = eventsOfType(G, 'moved').find(e => e.data.note === 'owned');
    expect(note.data).toEqual({ note: 'owned', propertyId: 3 });
    expect(G.messages).toContain('You own Baltic Ave.');
  });

  test("note 'visiting_jail' on the Just Visiting space", () => {
    const G = freshG();
    Monopoly.moves.rollDice(G, makeCtx('0', 4, 6)); // 0 -> 10 (Just Visiting)
    const note = eventsOfType(G, 'moved').find(e => e.data.note === 'visiting_jail');
    expect(note).toBeDefined();
    expect(G.messages).toContain('Just visiting jail.');
  });

  test("note 'parking_relax' when the freeParkingPot rule is off (default)", () => {
    const G = freshG();
    G.players[0].position = 17;
    Monopoly.moves.rollDice(G, makeCtx('0', 1, 2)); // 17 -> 20 (Free Parking)
    const note = eventsOfType(G, 'moved').find(e => e.data.note === 'parking_relax');
    expect(note).toBeDefined();
    expect(G.messages).toContain('Free Parking - relax!');
  });

  test('salary_collected(go) + passive_triggered(idealist, go context) on wrapping past GO', () => {
    const G = freshG();
    G.players[0].character = getCharacterById('mira-dawnlight'); // idealist
    G.players[0].position = 38;
    const before = G.players[0].money;
    Monopoly.moves.rollDice(G, makeCtx('0', 1, 2)); // 38 + 3 = 41 -> wraps to 1 (Mediterranean Ave)

    const passive = eventsOfType(G, 'passive_triggered').find(e => e.data.context === 'go');
    expect(passive.data).toEqual({ passive: 'idealist', effect: 'go_bonus', amount: RULES.passives.idealist.goBonus, context: 'go' });

    const expectedAmount = RULES.core.goSalary + RULES.passives.idealist.goBonus;
    const salary = eventsOfType(G, 'salary_collected').find(e => e.data.source === 'go');
    expect(salary.data).toEqual({ source: 'go', amount: expectedAmount });
    expect(G.players[0].money).toBe(before + expectedAmount);

    const moved = eventsOfType(G, 'moved').find(e => !e.data.note && !e.data.routeExhausted);
    expect(moved.data).toEqual({ from: 38, to: 1, passedGo: true });
  });

  test('salary_collected(parking) jackpot when the pot rule is enabled', () => {
    RULES.core.freeParkingPot = true;
    try {
      const G = freshG();
      G.players[0].position = 17;
      G.freeParkingPot = 500;
      Monopoly.moves.rollDice(G, makeCtx('0', 1, 2)); // 17 -> 20 (Free Parking)
      const salary = eventsOfType(G, 'salary_collected').find(e => e.data.source === 'parking');
      expect(salary.data).toEqual({ source: 'parking', amount: 500 });
      expect(G.freeParkingPot).toBe(0);
      expect(G.messages).toContain('Free Parking jackpot! Collected $500!');
    } finally {
      RULES.core.freeParkingPot = false; // restore the shared live RULES singleton
    }
  });

  test('atlas: salary_collected(hub) + moved(routeExhausted) when the auto-route dead-ends', () => {
    const G = atlasG();
    Monopoly.moves.rollDice(G, makeCtx('0', 1, 2)); // total 3, but only 1 hop is walkable
    const salary = eventsOfType(G, 'salary_collected').find(e => e.data.source === 'hub');
    expect(salary.data).toEqual({ source: 'hub', amount: RULES.core.goSalary });
    const exhausted = eventsOfType(G, 'moved').find(e => e.data.routeExhausted);
    expect(exhausted.data).toEqual({ from: 0, to: 1, passedGo: false, routeExhausted: true });
    expect(G.messages).toEqual(expect.arrayContaining([
      'No path forward — the route ends here.',
      `Player 1 passes a capital hub! Collect $${RULES.core.goSalary}.`,
    ]));
  });

  test('atlas: idealist passive adds its bonus on a hub crossing (context "hub")', () => {
    const G = atlasG();
    G.players[0].character = getCharacterById('mira-dawnlight');
    Monopoly.moves.rollDice(G, makeCtx('0', 1, 2));
    const passive = eventsOfType(G, 'passive_triggered').find(e => e.data.context === 'hub');
    expect(passive.data).toEqual({ passive: 'idealist', effect: 'go_bonus', amount: RULES.passives.idealist.goBonus, context: 'hub' });
    const salary = eventsOfType(G, 'salary_collected').find(e => e.data.source === 'hub');
    expect(salary.data.amount).toBe(RULES.core.goSalary + RULES.passives.idealist.goBonus);
  });
});

describe('rent_paid', () => {
  test('payload {propertyId,ownerId,amount}; money moves from tenant to owner', () => {
    const G = freshG();
    G.ownership[3] = '1'; // Baltic Ave owned by P1
    const p0Money = G.players[0].money;
    const p1Money = G.players[1].money;
    Monopoly.moves.rollDice(G, makeCtx('0', 1, 2)); // P0 lands on Baltic Ave, rent $8
    const rents = eventsOfType(G, 'rent_paid');
    expect(rents).toHaveLength(1);
    expect(rents[0].data).toEqual({ propertyId: 3, ownerId: '1', amount: 8 });
    expect(G.players[0].money).toBe(p0Money - 8);
    expect(G.players[1].money).toBe(p1Money + 8);
    expect(G.messages).toContain('Paid $8 rent to Player 2 for Baltic Ave.');
  });
});

describe('tax_paid / passive_triggered (financier, tax context)', () => {
  test('plain tax (no character): tax_paid amount matches the space, no passive event', () => {
    const G = freshG();
    Monopoly.moves.rollDice(G, makeCtx('0', 1, 3)); // 0 -> 4 (Income Tax, $200)
    const taxes = eventsOfType(G, 'tax_paid');
    expect(taxes).toHaveLength(1);
    expect(taxes[0].data).toEqual({ amount: 200, spaceId: 4 });
    expect(eventsOfType(G, 'passive_triggered')).toHaveLength(0);
    expect(G.messages).toContain('Paid $200 in Income Tax.');
  });

  test('financier passive reduces the tax and logs its own passive_triggered event', () => {
    const G = freshG();
    G.players[0].character = getCharacterById('albert-victor'); // financier
    Monopoly.moves.rollDice(G, makeCtx('0', 1, 3));
    const reduced = Math.floor(200 * (1 - RULES.passives.financier.negativeEventReduction));
    const passives = eventsOfType(G, 'passive_triggered');
    expect(passives).toHaveLength(1);
    expect(passives[0].data).toEqual({ passive: 'financier', effect: 'loss_reduced', amount: reduced, context: 'tax' });
    expect(eventsOfType(G, 'tax_paid')[0].data).toEqual({ amount: reduced, spaceId: 4 });
    expect(G.messages).toEqual(expect.arrayContaining([
      `Financial expertise reduces tax to $${reduced}.`,
      `Paid $${reduced} in Income Tax.`,
    ]));
  });
});

describe('went_to_jail', () => {
  test("reason 'triples' on a third consecutive doubles roll", () => {
    const G = freshG();
    G.doublesCount = 2; // already had 2 doubles this streak
    Monopoly.moves.rollDice(G, makeCtx('0', 3, 3)); // 3rd doubles
    const jailed = eventsOfType(G, 'went_to_jail');
    expect(jailed).toHaveLength(1);
    expect(jailed[0].data).toEqual({ reason: 'triples' });
    expect(G.players[0].inJail).toBe(true);
    expect(G.messages).toContain('Triple doubles! Go to Jail!');
  });

  test("reason 'space' landing exactly on Go To Jail", () => {
    const G = freshG();
    G.players[0].position = 27;
    Monopoly.moves.rollDice(G, makeCtx('0', 1, 2)); // 27 -> 30 (Go To Jail)
    const jailed = eventsOfType(G, 'went_to_jail');
    expect(jailed).toHaveLength(1);
    expect(jailed[0].data).toEqual({ reason: 'space' });
    expect(G.players[0].inJail).toBe(true);
    expect(G.players[0].position).toBe(RULES.core.jailPosition);
    expect(G.messages).toContain('Go to Jail!');
  });
});

describe('left_jail', () => {
  test("how 'doubles' frees the player immediately", () => {
    const G = freshG();
    G.players[0].inJail = true;
    G.players[0].jailTurns = 1;
    Monopoly.moves.rollDice(G, makeCtx('0', 2, 2)); // doubles
    const left = eventsOfType(G, 'left_jail');
    expect(left).toHaveLength(1);
    expect(left[0].data).toEqual({ how: 'doubles' });
    expect(G.players[0].inJail).toBe(false);
    expect(G.messages).toContain("Doubles! You're free from jail!");
  });

  test("how 'served' forces the fine after jailMaxTurns", () => {
    const G = freshG();
    G.players[0].inJail = true;
    G.players[0].jailTurns = RULES.core.jailMaxTurns - 1;
    const before = G.players[0].money;
    Monopoly.moves.rollDice(G, makeCtx('0', 1, 2)); // non-double
    const left = eventsOfType(G, 'left_jail');
    expect(left).toHaveLength(1);
    expect(left[0].data).toEqual({ how: 'served', maxTurns: RULES.core.jailMaxTurns, fine: RULES.core.jailFine });
    expect(G.players[0].inJail).toBe(false);
    expect(G.players[0].money).toBe(before - RULES.core.jailFine);
    expect(G.messages).toContain(`${RULES.core.jailMaxTurns} turns in jail. Paid $${RULES.core.jailFine} fine.`);
  });

  test("how 'waiting' when neither doubles nor jailMaxTurns are reached", () => {
    const G = freshG();
    G.players[0].inJail = true;
    G.players[0].jailTurns = 0;
    Monopoly.moves.rollDice(G, makeCtx('0', 1, 2));
    const left = eventsOfType(G, 'left_jail');
    expect(left).toHaveLength(1);
    expect(left[0].data).toEqual({ how: 'waiting', maxTurns: RULES.core.jailMaxTurns });
    expect(G.players[0].inJail).toBe(true);
    expect(G.turnPhase).toBe('done');
    expect(G.messages).toContain(`Still in jail. Turn 1/${RULES.core.jailMaxTurns}.`);
  });
});

describe('jail_fine_paid', () => {
  test('success: reset buffer to a single message, actor pays the fine', () => {
    const G = freshG();
    G.players[0].inJail = true;
    G.messages = ['stale line from a previous action'];
    const before = G.players[0].money;
    Monopoly.moves.payJailFine(G, makeCtx('0'));
    const paid = eventsOfType(G, 'jail_fine_paid');
    expect(paid).toHaveLength(1);
    expect(paid[0].data).toEqual({ fine: RULES.core.jailFine });
    expect(G.players[0].inJail).toBe(false);
    expect(G.players[0].money).toBe(before - RULES.core.jailFine);
    expect(G.messages).toEqual([`Player 1 paid $${RULES.core.jailFine} to get out of jail.`]);
  });

  // This file drives moves directly (no boardgame.io Client/reducer in the
  // loop), so — unlike real dispatched play — a mutation made before an
  // INVALID_MOVE return is directly observable here; it is still migrated via
  // logEvent (never bypassed) per the task mandate.
  test('insufficient funds: still logs a failed attempt, player stays in jail', () => {
    const G = freshG();
    G.players[0].inJail = true;
    G.players[0].money = RULES.core.jailFine - 1;
    const result = Monopoly.moves.payJailFine(G, makeCtx('0'));
    expect(result).toBe(INVALID_MOVE);
    const paid = eventsOfType(G, 'jail_fine_paid');
    expect(paid).toHaveLength(1);
    expect(paid[0].data).toEqual({ fine: RULES.core.jailFine, failed: true });
    expect(G.players[0].inJail).toBe(true);
    expect(G.messages).toContain(`Not enough money to pay $${RULES.core.jailFine} fine!`);
  });
});

describe('character_selected (all-selected transition)', () => {
  test('emits once, actor null, only after the LAST player selects', () => {
    const ctx0 = { numPlayers: 2, playOrder: ['0', '1'] };
    const G = Monopoly.setup(ctx0);
    const endTurn0 = jest.fn();
    Monopoly.moves.selectCharacter(G, { currentPlayer: '0', numPlayers: 2, events: { endTurn: endTurn0 } }, 'marcus-grayline');
    expect(eventsOfType(G, 'character_selected')).toHaveLength(0);

    const endTurn1 = jest.fn();
    Monopoly.moves.selectCharacter(G, { currentPlayer: '1', numPlayers: 2, events: { endTurn: endTurn1 } }, 'sophia-ember');
    const sel = eventsOfType(G, 'character_selected');
    expect(sel).toHaveLength(1);
    expect(sel[0].actor).toBeNull();
    expect(sel[0].data).toEqual({ allSelected: true });
    expect(G.messages).toEqual([`All characters selected! Game begins! ${getCharacterById('marcus-grayline').name} rolls first.`]);
  });
});

describe('G.events seq monotonicity (Task 2 harness integration)', () => {
  test('seq is strictly increasing and gapless across a scripted multi-turn game', () => {
    const client = makeClient(2, 1);
    playScript(client, [
      ['selectCharacter', 'marcus-grayline'],
      ['selectCharacter', 'sophia-ember'],
      ['rollDice'], ifCanBuy('buyProperty'), ifPendingCard('acceptCard'), ['endTurn'],
      ['rollDice'], ifCanBuy('buyProperty'), ifPendingCard('acceptCard'), ['endTurn'],
      ['rollDice'], ifCanBuy('buyProperty'), ifPendingCard('acceptCard'), ['endTurn'],
      ['rollDice'], ifCanBuy('buyProperty'), ifPendingCard('acceptCard'), ['endTurn'],
    ]);
    const G = client.getState().G;
    expect(G.events.length).toBeGreaterThan(0);
    for (let i = 1; i < G.events.length; i++) {
      expect(G.events[i].seq).toBe(G.events[i - 1].seq + 1);
    }
    expect(G.eventSeq).toBe(G.events[G.events.length - 1].seq + 1);
    expect(eventsOfType(G, 'dice_rolled').length).toBeGreaterThanOrEqual(4);
    expect(eventsOfType(G, 'character_selected')).toHaveLength(1);
  });
});
