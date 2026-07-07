// Task 3 (migration slice 1): payload assertions for the roll/move/landing
// typed events — dice_rolled, moved, salary_collected, passive_triggered
// (idealist go/hub, financier tax), rent_paid, tax_paid, went_to_jail,
// left_jail, jail_fine_paid, character_selected (all-selected transition).
//
// Task 4 (migration slice 2) adds: card_drawn, card_applied (all ~10
// applyCard action branches), card_redrawn, passive_triggered (financier
// pay/payPercent card contexts), and the moveTo GO-crossing reuse of
// salary_collected/passive_triggered with context/source 'card'.
//
// Grows in later tasks as further migration slices add their own event types.
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
import fs from 'fs';
import path from 'path';
import { INVALID_MOVE } from 'boardgame.io/core';
import { Client } from 'boardgame.io/client';
import { Monopoly } from '../Game';
import { getCharacterById, COLOR_GROUPS, RULES } from '../../mods/dominion';
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
    expect(G.enforceSeats).toBe(false);
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
    const moved = eventsOfType(G, 'moved').filter(e => !e.data.routeExhausted);
    expect(moved).toHaveLength(1);
    expect(moved[0].data).toEqual({ from: 0, to: 3, passedGo: false });
    expect(G.messages).toContain('Landed on Baltic Ave.');
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

    const moved = eventsOfType(G, 'moved').find(e => !e.data.routeExhausted);
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

describe('landing_notice', () => {
  test('note available / unaffordable / owned', () => {
    let G = freshG();
    Monopoly.moves.rollDice(G, makeCtx('0', 1, 2)); // -> Baltic Ave ($60), unowned, affordable
    let note = eventsOfType(G, 'landing_notice').find(e => e.data.note === 'available');
    expect(note.data).toEqual({ note: 'available', propertyId: 3, listPrice: 60, effectivePrice: 60 });
    expect(G.messages).toContain('Baltic Ave is available for $60. Buy or pass?');

    G = freshG();
    G.players[0].money = 10;
    Monopoly.moves.rollDice(G, makeCtx('0', 4, 5)); // -> Connecticut Ave ($120)
    note = eventsOfType(G, 'landing_notice').find(e => e.data.note === 'unaffordable');
    expect(note.data).toEqual({ note: 'unaffordable', propertyId: 9, price: 120, playerMoney: 10 });
    expect(G.messages).toContain('Connecticut Ave costs $120 but you only have $10.');

    G = freshG();
    G.ownership[3] = '0'; // already owns Baltic Ave
    Monopoly.moves.rollDice(G, makeCtx('0', 1, 2));
    note = eventsOfType(G, 'landing_notice').find(e => e.data.note === 'owned');
    expect(note.data).toEqual({ note: 'owned', propertyId: 3 });
    expect(G.messages).toContain('You own Baltic Ave.');
  });

  test("note 'visiting_jail' on the Just Visiting space", () => {
    const G = freshG();
    Monopoly.moves.rollDice(G, makeCtx('0', 4, 6)); // 0 -> 10 (Just Visiting)
    const note = eventsOfType(G, 'landing_notice').find(e => e.data.note === 'visiting_jail');
    expect(note).toBeDefined();
    expect(G.messages).toContain('Just visiting jail.');
  });

  test("note 'parking_relax' when the freeParkingPot rule is off (default)", () => {
    const G = freshG();
    G.players[0].position = 17;
    Monopoly.moves.rollDice(G, makeCtx('0', 1, 2)); // 17 -> 20 (Free Parking)
    const note = eventsOfType(G, 'landing_notice').find(e => e.data.note === 'parking_relax');
    expect(note).toBeDefined();
    expect(G.messages).toContain('Free Parking - relax!');
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

});

describe('jail_wait', () => {
  test('payload {turn,maxTurns} when neither doubles nor jailMaxTurns are reached', () => {
    const G = freshG();
    G.players[0].inJail = true;
    G.players[0].jailTurns = 0;
    Monopoly.moves.rollDice(G, makeCtx('0', 1, 2));
    const waits = eventsOfType(G, 'jail_wait');
    expect(waits).toHaveLength(1);
    expect(waits[0].data).toEqual({ turn: 1, maxTurns: RULES.core.jailMaxTurns });
    expect(eventsOfType(G, 'left_jail')).toHaveLength(0);
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

describe('character_selected (join line + all-selected transition)', () => {
  test('each select emits a join event; the LAST one also emits the all-selected transition', () => {
    const ctx0 = { numPlayers: 2, playOrder: ['0', '1'] };
    const G = Monopoly.setup(ctx0);
    const endTurn0 = jest.fn();
    Monopoly.moves.selectCharacter(G, { currentPlayer: '0', numPlayers: 2, events: { endTurn: endTurn0 } }, 'marcus-grayline');
    const afterFirst = eventsOfType(G, 'character_selected');
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0].actor).toBe('0');
    expect(afterFirst[0].data).toEqual({ characterId: 'marcus-grayline', money: G.players[0].money, affinityBonus: 0 });
    expect(G.messages).toEqual(['Select your characters!', 'Marcus Grayline joins the game! ($1800)']);

    const endTurn1 = jest.fn();
    Monopoly.moves.selectCharacter(G, { currentPlayer: '1', numPlayers: 2, events: { endTurn: endTurn1 } }, 'sophia-ember');
    const sel = eventsOfType(G, 'character_selected');
    expect(sel).toHaveLength(3); // 2 joins + 1 all-selected transition
    const join1 = sel.find(e => e.actor === '1');
    expect(join1.data).toEqual({ characterId: 'sophia-ember', money: G.players[1].money, affinityBonus: 0 });
    const transition = sel.find(e => e.actor === null);
    expect(transition.data).toEqual({ allSelected: true });
    // resetMessages() wipes the per-turn buffer before the transition line is
    // logged, so only the transition line survives into G.messages here (the
    // join lines are still on G.events, just not on the reset G.messages).
    expect(G.messages).toEqual([`All characters selected! Game begins! ${getCharacterById('marcus-grayline').name} rolls first.`]);
  });

  test('affinity-bonus join line: conditional template with the bonus suffix', () => {
    // No golden scenario reaches a positive affinityBonus (classic map has no
    // traits); direct-invocation covers the conditional branch.
    const ctx0 = { numPlayers: 2, playOrder: ['0', '1'] };
    const G = Monopoly.setup(ctx0);
    G.board = { ...G.board, traits: { capital: 10 } };
    Monopoly.moves.selectCharacter(G, { currentPlayer: '0', numPlayers: 2, events: { endTurn: jest.fn() } }, 'marcus-grayline');
    const join = eventsOfType(G, 'character_selected')[0];
    expect(join.data.affinityBonus).toBeGreaterThan(0);
    expect(G.messages).toContain(`Marcus Grayline joins the game! ($${join.data.money}, +$${join.data.affinityBonus} world affinity)`);
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
    expect(eventsOfType(G, 'character_selected')).toHaveLength(3); // 2 joins + 1 all-selected transition
  });

  // Shape-homogeneity pin: 'moved' must carry only {from,to,passedGo[,
  // routeExhausted]} — the non-financial landing commentary that used to be
  // multiplexed onto 'moved' via a `note` field now lives in its own
  // 'landing_notice' type, so every 'moved' event a position-tracking
  // consumer sees must have numeric from/to and never a `note` field.
  test("every 'moved' event has numeric from/to and no 'note' field", () => {
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
    const moved = eventsOfType(G, 'moved');
    expect(moved.length).toBeGreaterThan(0);
    moved.forEach(e => {
      expect(typeof e.data.from).toBe('number');
      expect(typeof e.data.to).toBe('number');
      expect(e.data.note).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Task 4 (migration slice 2): cards + passives
// ---------------------------------------------------------------------------
//
// Two tiers, matching the task-4-report.md split:
//  - "harness" tests below drive the SAME baked seeds/scripts as the golden
//    fixtures (card-draw-accept, card-redraw, two-turn-roll-buy, jail-cycle,
//    bankruptcy) — these action branches are golden-covered (byte-identical
//    text is already locked by golden-messages.test.js); these tests add the
//    payload-completeness assertions the golden gate itself doesn't make.
//  - "direct-invocation" tests build a minimal G + G.pendingCard and call
//    Monopoly.moves.acceptCard, the same idiom src/__tests__/Game.test.js
//    already uses hundreds of times for applyCard branches (applyCard itself
//    is not exported). These cover action/outcome branches no golden scenario
//    naturally reaches — their byte-identity rests on the assertion itself
//    (template lifted verbatim), not the golden gate.

describe('card_drawn / card_prompt / card_applied — harness (golden-covered)', () => {
  test('payPercent: announce card_drawn + card_prompt, then card_applied on acceptCard', () => {
    const client = makeClient(2, 14);
    playScript(client, [
      ['selectCharacter', 'lia-startrace'],
      ['selectCharacter', 'renn-chainbreaker'],
      ['rollDice'],
    ]);
    let G = client.getState().G;
    const drawn = eventsOfType(G, 'card_drawn');
    expect(drawn).toHaveLength(1);
    expect(typeof drawn[0].data.cardIndex).toBe('number');
    expect(drawn[0].data).toEqual({
      deck: 'chance', cardIndex: drawn[0].data.cardIndex,
      text: 'Black Swan Event! Pay 10% of your total assets.',
    });
    const prompted = eventsOfType(G, 'card_prompt');
    expect(prompted).toHaveLength(1);
    expect(prompted[0].data).toEqual({ deck: 'chance', cardIndex: drawn[0].data.cardIndex });
    expect(G.messages).toEqual([
      'Lia Startrace rolled 1 + 6 = 7',
      'Landed on Chance.',
      'CHANCE: Black Swan Event! Pay 10% of your total assets.',
      'You may accept or redraw this card.',
    ]);

    client.moves.acceptCard();
    G = client.getState().G;
    const applied = eventsOfType(G, 'card_applied').find(e => e.data.action === 'payPercent');
    expect(applied.data).toEqual({
      deck: 'chance',
      cardIndex: drawn[0].data.cardIndex,
      action: 'payPercent',
      text: 'Black Swan Event! Pay 10% of your total assets.',
      effect: { assets: 1750, amount: 175, percent: 10 },
    });
    expect(eventsOfType(G, 'passive_triggered')).toHaveLength(0); // Lia isn't financier
    expect(G.messages).toContain('Total assets: $1750. Paid $175 (10%).');
  });

  test('card_redrawn + card_applied(forceBuy, no_opponents)', () => {
    const client = makeClient(2, 14);
    playScript(client, [
      ['selectCharacter', 'lia-startrace'],
      ['selectCharacter', 'renn-chainbreaker'],
      ['rollDice'],
      ['redrawCard'],
    ]);
    const G = client.getState().G;
    const redrawn = eventsOfType(G, 'card_redrawn');
    expect(redrawn).toHaveLength(1);
    expect(redrawn[0].data).toEqual({
      deck: 'chance',
      newText: "Hostile Takeover! Force-buy an opponent's cheapest property at 150% price.",
    });
    const applied = eventsOfType(G, 'card_applied').find(e => e.data.action === 'forceBuy');
    expect(applied.data.text).toBe("Hostile Takeover! Force-buy an opponent's cheapest property at 150% price.");
    expect(applied.data.effect).toEqual({ outcome: 'no_opponents' });
    expect(G.messages).toContain('No opponents with properties for hostile takeover.');
  });

  test("gain (COMMUNITY CHEST 'Bank error in your favor'): silent card_applied", () => {
    const client = makeClient(2, 25);
    playScript(client, [
      ['selectCharacter', 'marcus-grayline'],
      ['selectCharacter', 'sophia-ember'],
      ['rollDice'],
    ]);
    const G = client.getState().G;
    const applied = eventsOfType(G, 'card_applied').find(e => e.data.action === 'gain');
    expect(applied.data).toEqual({
      deck: 'community',
      cardIndex: applied.data.cardIndex,
      action: 'gain',
      text: 'Bank error in your favor. Collect $200.',
      effect: { amount: 200 },
    });
    expect(G.messages).toEqual([
      'Marcus Grayline rolled 1 + 1 = 2',
      'Landed on Community Chest.',
      'COMMUNITY CHEST: Bank error in your favor. Collect $200.',
    ]);
  });

  test("moveTo (CHANCE 'Advance to Illinois Ave.'), passedGo false: no salary/passive events", () => {
    const client = makeClient(2, 1);
    playScript(client, [
      ['selectCharacter', 'marcus-grayline'],
      ['selectCharacter', 'sophia-ember'],
      ['rollDice'], ifCanBuy('buyProperty'), ['endTurn'],
      ['rollDice'], // P1 -> Chance -> "Advance to Illinois Ave."
    ]);
    const G = client.getState().G;
    const applied = eventsOfType(G, 'card_applied').find(e => e.data.action === 'moveTo');
    expect(applied.data.text).toBe('Advance to Illinois Ave.');
    expect(applied.data.effect).toEqual({
      targetSpaceId: applied.data.effect.targetSpaceId,
      targetSpaceName: 'Illinois Ave',
      passedGo: false,
      goBonus: 0,
    });
    expect(eventsOfType(G, 'salary_collected').filter(e => e.data.source === 'card')).toHaveLength(0);
    expect(eventsOfType(G, 'passive_triggered').filter(e => e.data.context === 'card')).toHaveLength(0);
  });

  test("goToJail (CHANCE 'Go to Jail. Do not pass GO.'): silent card_applied + event-only went_to_jail(reason:'card')", () => {
    const client = makeClient(2, 34);
    playScript(client, [
      ['selectCharacter', 'knox-ironlaw'],
      ['selectCharacter', 'sophia-ember'],
      ['rollDice'], // P0 -> Chance -> goToJail, applied immediately (no redraw offered)
    ]);
    const G = client.getState().G;
    const applied = eventsOfType(G, 'card_applied').find(e => e.data.action === 'goToJail');
    expect(applied.data).toEqual({
      deck: 'chance', cardIndex: applied.data.cardIndex, action: 'goToJail',
      text: 'Go to Jail. Do not pass GO.', effect: {},
    });
    // went_to_jail now fires (event-only) so event-stream consumers can see
    // the jailing, but reason:'card' formats to null in the formatter — the
    // pre-migration code never pushed a "Go to Jail!" message for this card
    // action (only the space-landing goToJail does), confirmed against the
    // golden jail-cycle fixture. The unchanged G.messages array below is the
    // proof: no new line appears despite the new event.
    const jailed = eventsOfType(G, 'went_to_jail').find(e => e.data.reason === 'card');
    expect(jailed).toBeDefined();
    expect(jailed.data).toEqual({ reason: 'card' });
    expect(G.players[0].inJail).toBe(true);
    expect(G.messages).toEqual([
      'Knox Ironlaw rolled 3 + 4 = 7',
      'Landed on Chance.',
      'CHANCE: Go to Jail. Do not pass GO.',
    ]);
  });
});

describe('card_drawn: empty deck', () => {
  test('empty:true payload and "The deck is empty." message', () => {
    const G = freshG();
    G.board = { ...G.board, chanceCards: [] };
    Monopoly.moves.rollDice(G, makeCtx('0', 1, 6)); // 0 -> 7 (Chance)
    const drawn = eventsOfType(G, 'card_drawn');
    expect(drawn).toHaveLength(1);
    expect(drawn[0].data).toEqual({ deck: 'chance', cardIndex: null, text: null, empty: true });
    expect(G.messages).toContain('The deck is empty.');
  });
});

describe('card_applied: pay (direct-invocation, no golden scenario reaches this action)', () => {
  test('plain pay: silent card_applied (no message beyond the draw), no passive event', () => {
    const G = freshG();
    G.players[0].money = 1000;
    G.pendingCard = { card: { text: 'Fine', action: 'pay', value: 50 }, deck: 'chance', cardIndex: 2 };
    Monopoly.moves.acceptCard(G, makeCtx('0'));
    const applied = eventsOfType(G, 'card_applied').find(e => e.data.action === 'pay');
    expect(applied.data).toEqual({ deck: 'chance', cardIndex: 2, action: 'pay', text: 'Fine', effect: { amount: 50 } });
    expect(eventsOfType(G, 'passive_triggered')).toHaveLength(0);
    expect(G.players[0].money).toBe(950);
    expect(G.messages).toEqual(['Select your characters!']); // unchanged: 'pay' never had a message
  });

  test('financier reduces the loss, logs passive_triggered(context:pay) before card_applied', () => {
    const G = freshG();
    G.players[0].character = getCharacterById('albert-victor'); // financier
    G.players[0].money = 1000;
    G.pendingCard = { card: { text: 'Fine', action: 'pay', value: 50 }, deck: 'chance', cardIndex: 2 };
    Monopoly.moves.acceptCard(G, makeCtx('0'));
    const reduced = Math.floor(50 * (1 - RULES.passives.financier.negativeEventReduction));
    const passive = eventsOfType(G, 'passive_triggered')[0];
    expect(passive.data).toEqual({ passive: 'financier', effect: 'loss_reduced', amount: reduced, context: 'pay' });
    const applied = eventsOfType(G, 'card_applied').find(e => e.data.action === 'pay');
    expect(applied.data.effect).toEqual({ amount: reduced });
    expect(applied.seq).toBeGreaterThan(passive.seq); // same relative order as the original pushes
    expect(G.players[0].money).toBe(1000 - reduced);
    expect(G.messages).toEqual(['Select your characters!', `Financial expertise reduces loss to $${reduced}.`]);
  });
});

describe('card_applied: payPercent + financier (direct-invocation)', () => {
  test('financier reduces the percent-of-assets loss', () => {
    const G = freshG();
    G.players[0].character = getCharacterById('albert-victor'); // financier
    G.players[0].money = 1000;
    G.pendingCard = { card: { text: 'Audit', action: 'payPercent', value: 20 }, deck: 'community', cardIndex: 5 };
    Monopoly.moves.acceptCard(G, makeCtx('0'));
    const assets = 1000; // no properties
    const rawAmount = Math.floor(assets * 20 / 100);
    const reduced = Math.floor(rawAmount * (1 - RULES.passives.financier.negativeEventReduction));
    const passive = eventsOfType(G, 'passive_triggered')[0];
    expect(passive.data).toEqual({ passive: 'financier', effect: 'loss_reduced', amount: reduced, context: 'payPercent' });
    const applied = eventsOfType(G, 'card_applied').find(e => e.data.action === 'payPercent');
    expect(applied.data).toEqual({
      deck: 'community', cardIndex: 5, action: 'payPercent', text: 'Audit',
      effect: { assets, amount: reduced, percent: 20 },
    });
    expect(G.players[0].money).toBe(1000 - reduced);
    expect(G.messages).toEqual(expect.arrayContaining([
      `Financial expertise reduces loss to $${reduced}.`,
      `Total assets: $${assets}. Paid $${reduced} (20%).`,
    ]));
  });
});

describe('card_applied: moveTo (direct-invocation)', () => {
  test('passedGo true: passive_triggered(idealist, context:card) + salary_collected(source:card)', () => {
    const G = freshG();
    G.players[0].character = getCharacterById('mira-dawnlight'); // idealist
    G.players[0].position = 35;
    const before = G.players[0].money;
    G.pendingCard = { card: { text: 'Advance to Go', action: 'moveTo', value: 5 }, deck: 'chance', cardIndex: 1 };
    Monopoly.moves.acceptCard(G, makeCtx('0'));
    const expectedAmount = RULES.core.goSalary + RULES.passives.idealist.goBonus;

    const passive = eventsOfType(G, 'passive_triggered').find(e => e.data.context === 'card');
    expect(passive.data).toEqual({ passive: 'idealist', effect: 'go_bonus', amount: RULES.passives.idealist.goBonus, context: 'card' });
    const salary = eventsOfType(G, 'salary_collected').find(e => e.data.source === 'card');
    expect(salary.data).toEqual({ source: 'card', amount: expectedAmount });
    expect(G.players[0].money).toBe(before + expectedAmount);

    const applied = eventsOfType(G, 'card_applied').find(e => e.data.action === 'moveTo');
    expect(applied.data).toEqual({
      deck: 'chance', cardIndex: 1, action: 'moveTo', text: 'Advance to Go',
      effect: { targetSpaceId: 5, targetSpaceName: G.board.spaces[5].name, passedGo: true, goBonus: expectedAmount },
    });
    expect(G.messages).toEqual(expect.arrayContaining([
      `Growth vision: extra $${RULES.passives.idealist.goBonus} from GO!`,
      `Passed GO! Collect $${expectedAmount}.`,
    ]));
  });

  test('atlas movementMode: teleport + hub salary via payHubSalary, effect records movementMode', () => {
    const G = atlasG();
    G.pendingCard = { card: { text: 'Teleport', action: 'moveTo', value: 1 }, deck: 'community', cardIndex: 4 };
    Monopoly.moves.acceptCard(G, makeCtx('0'));
    const salary = eventsOfType(G, 'salary_collected').find(e => e.data.source === 'hub');
    expect(salary.data).toEqual({ source: 'hub', amount: RULES.core.goSalary });
    const applied = eventsOfType(G, 'card_applied').find(e => e.data.action === 'moveTo');
    expect(applied.data).toEqual({
      deck: 'community', cardIndex: 4, action: 'moveTo', text: 'Teleport',
      effect: { targetSpaceId: 1, targetSpaceName: 'Hub', movementMode: 'atlas' },
    });
  });
});

describe('card_applied: gainAll / gainPerProperty (direct-invocation)', () => {
  test('gainAll credits every non-bankrupt player', () => {
    const G = freshG();
    G.players[1].bankrupt = true;
    const before0 = G.players[0].money;
    const before1 = G.players[1].money;
    G.pendingCard = { card: { text: 'Stimulus', action: 'gainAll', value: 100 }, deck: 'chance', cardIndex: 6 };
    Monopoly.moves.acceptCard(G, makeCtx('0'));
    expect(G.players[0].money).toBe(before0 + 100);
    expect(G.players[1].money).toBe(before1);
    const applied = eventsOfType(G, 'card_applied').find(e => e.data.action === 'gainAll');
    expect(applied.data).toEqual({ deck: 'chance', cardIndex: 6, action: 'gainAll', text: 'Stimulus', effect: { amount: 100 } });
    expect(G.messages).toContain('All players receive $100!');
  });

  test('gainPerProperty scales with owned property count', () => {
    const G = freshG();
    G.players[0].properties.push(1, 3, 6);
    const before = G.players[0].money;
    G.pendingCard = { card: { text: 'Boom', action: 'gainPerProperty', value: 50 }, deck: 'chance', cardIndex: 7 };
    Monopoly.moves.acceptCard(G, makeCtx('0'));
    expect(G.players[0].money).toBe(before + 150);
    const applied = eventsOfType(G, 'card_applied').find(e => e.data.action === 'gainPerProperty');
    expect(applied.data).toEqual({
      deck: 'chance', cardIndex: 7, action: 'gainPerProperty', text: 'Boom',
      effect: { count: 3, perProperty: 50, amount: 150 },
    });
    expect(G.messages).toContain('3 properties x $50 = $150 earned!');
  });
});

describe('card_applied: freeUpgrade / downgrade (direct-invocation)', () => {
  test('freeUpgrade: upgrades the cheapest eligible property', () => {
    const G = freshG();
    const groupIds = COLOR_GROUPS['#8B4513']; // brown group
    groupIds.forEach(id => { G.ownership[id] = '0'; G.players[0].properties.push(id); });
    G.pendingCard = { card: { text: 'Free Upgrade', action: 'freeUpgrade', value: 0 }, deck: 'community', cardIndex: 8 };
    Monopoly.moves.acceptCard(G, makeCtx('0'));
    const pid = groupIds[0];
    expect(G.buildings[pid]).toBe(1);
    const applied = eventsOfType(G, 'card_applied').find(e => e.data.action === 'freeUpgrade');
    expect(applied.data).toEqual({
      deck: 'community', cardIndex: 8, action: 'freeUpgrade', text: 'Free Upgrade',
      effect: { outcome: 'upgraded', propertyId: pid, targetSpaceName: G.board.spaces[pid].name, newLevel: 1, newLevelName: RULES.buildings.names[1] },
    });
    expect(G.messages).toContain(`Free upgrade! ${G.board.spaces[pid].name} upgraded to ${RULES.buildings.names[1]}!`);
  });

  test('freeUpgrade: outcome "none" when nothing is eligible', () => {
    const G = freshG();
    G.pendingCard = { card: { text: 'Free Upgrade', action: 'freeUpgrade', value: 0 }, deck: 'community', cardIndex: 9 };
    Monopoly.moves.acceptCard(G, makeCtx('0'));
    const applied = eventsOfType(G, 'card_applied').find(e => e.data.action === 'freeUpgrade');
    expect(applied.data.effect).toEqual({ outcome: 'none' });
    expect(G.messages).toContain('No properties eligible for free upgrade.');
  });

  test('downgrade: reduces the highest-level building by 1', () => {
    const G = freshG();
    G.ownership[1] = '0';
    G.players[0].properties.push(1);
    G.buildings[1] = 2;
    G.pendingCard = { card: { text: 'Crash', action: 'downgrade', value: 0 }, deck: 'community', cardIndex: 10 };
    Monopoly.moves.acceptCard(G, makeCtx('0'));
    expect(G.buildings[1]).toBe(1);
    const applied = eventsOfType(G, 'card_applied').find(e => e.data.action === 'downgrade');
    expect(applied.data).toEqual({
      deck: 'community', cardIndex: 10, action: 'downgrade', text: 'Crash',
      effect: { outcome: 'downgraded', propertyId: 1, targetSpaceName: G.board.spaces[1].name, newLevel: 1, newLevelName: RULES.buildings.names[1] },
    });
    expect(G.messages).toContain(`Market Crash! ${G.board.spaces[1].name} downgraded to ${RULES.buildings.names[1]}.`);
  });

  test('downgrade: outcome "none" without any buildings', () => {
    const G = freshG();
    G.pendingCard = { card: { text: 'Crash', action: 'downgrade', value: 0 }, deck: 'community', cardIndex: 11 };
    Monopoly.moves.acceptCard(G, makeCtx('0'));
    const applied = eventsOfType(G, 'card_applied').find(e => e.data.action === 'downgrade');
    expect(applied.data.effect).toEqual({ outcome: 'none' });
    expect(G.messages).toContain('No buildings to downgrade.');
  });
});

describe('card_applied: forceBuy bought / insufficient_funds (direct-invocation)', () => {
  test('bought: transfers the cheapest opponent property', () => {
    const G = freshG();
    G.ownership[1] = '1';
    G.players[1].properties.push(1);
    G.players[0].money = 1000;
    G.players[1].money = 500;
    G.pendingCard = { card: { text: 'Hostile Takeover', action: 'forceBuy', value: 150 }, deck: 'chance', cardIndex: 12 };
    Monopoly.moves.acceptCard(G, makeCtx('0'));
    const cost = Math.floor(G.board.spaces[1].price * 150 / 100);
    const applied = eventsOfType(G, 'card_applied').find(e => e.data.action === 'forceBuy');
    expect(applied.data).toEqual({
      deck: 'chance', cardIndex: 12, action: 'forceBuy', text: 'Hostile Takeover',
      effect: { outcome: 'bought', propertyId: 1, targetSpaceName: G.board.spaces[1].name, targetOwnerId: '1', cost },
    });
    expect(G.players[0].money).toBe(1000 - cost);
    expect(G.players[1].money).toBe(500 + cost);
    expect(G.messages).toContain(`Hostile Takeover! Bought ${G.board.spaces[1].name} from Player 2 for $${cost}!`);
  });

  test('insufficient_funds: no transfer, event still carries the cost', () => {
    const G = freshG();
    G.ownership[39] = '1';
    G.players[1].properties.push(39);
    G.players[0].money = 100;
    G.pendingCard = { card: { text: 'Hostile Takeover', action: 'forceBuy', value: 150 }, deck: 'chance', cardIndex: 13 };
    Monopoly.moves.acceptCard(G, makeCtx('0'));
    const cost = Math.floor(G.board.spaces[39].price * 150 / 100);
    const applied = eventsOfType(G, 'card_applied').find(e => e.data.action === 'forceBuy');
    expect(applied.data.effect).toEqual({ outcome: 'insufficient_funds', cost });
    expect(G.ownership[39]).toBe('1');
    expect(G.players[0].money).toBe(100);
    expect(G.messages).toContain(`Can't afford hostile takeover ($${cost} needed).`);
  });
});

// ---------------------------------------------------------------------------
// Task 5 (migration slice 3): property management + selection + season +
// bankruptcy
// ---------------------------------------------------------------------------
//
// Same two-tier split as Task 4:
//  - "harness" tests drive the SAME baked seeds/scripts as the matching
//    golden scenario (two-turn-roll-buy, build-mortgage, season-change,
//    bankruptcy) — byte-identical text is already locked by
//    golden-messages.test.js; these add payload-completeness assertions.
//  - "direct-invocation" tests cover property_passed, property_regulated, and
//    reroll_used — NONE of the 10 frozen golden scenarios reach these lines
//    (property_passed: RULES.auction.enabled/auctionOnPass default to true,
//    so passProperty always takes the auction branch in every scenario
//    in golden-messages.test.js — confirmed by grepping the fixture for
//    "Passed on buying." with zero hits; property_regulated needs Knox's
//    enforcer passive; reroll_used needs a stamina-reroll character — no
//    golden scenario's cast exercises either).

function proposeForProperty(pid) {
  return (client) => {
    const owner = client.getState().G.ownership[pid];
    if (owner !== '0' && owner !== null && owner !== undefined) {
      client.moves.proposeTrade({
        targetPlayerId: owner, offeredProperties: [], requestedProperties: [pid],
        offeredMoney: 100, requestedMoney: 0,
      });
    }
  };
}
function acceptIfTrade(client) {
  if (client.getState().G.trade) client.moves.acceptTrade();
}
function round() {
  return [['rollDice'], ifCanBuy('buyProperty'), ifPendingCard('acceptCard'), ['endTurn']];
}

describe('property_bought — harness (golden-covered: two-turn-roll-buy)', () => {
  test('payload {propertyId, listPrice, paidPrice}, actor is the buyer', () => {
    const client = makeClient(2, 1);
    playScript(client, [
      ['selectCharacter', 'marcus-grayline'],
      ['selectCharacter', 'sophia-ember'],
      ['rollDice'],
      ['buyProperty'],
    ]);
    const G = client.getState().G;
    const bought = eventsOfType(G, 'property_bought');
    expect(bought).toHaveLength(1);
    expect(bought[0].actor).toBe('0');
    expect(bought[0].data).toEqual({ propertyId: 5, listPrice: 200, paidPrice: 186 });
    expect(G.messages).toContain('Bought Reading Railroad for $186!');
  });
});

describe('property_passed (direct-invocation; auction defaults route every golden pass through the auction branch instead)', () => {
  test('payload {propertyId} when auction is disabled', () => {
    RULES.auction.enabled = false;
    try {
      const G = freshG();
      Monopoly.moves.rollDice(G, makeCtx('0', 1, 2)); // -> Baltic Ave, unowned, affordable
      Monopoly.moves.passProperty(G, makeCtx('0'));
      const passed = eventsOfType(G, 'property_passed');
      expect(passed).toHaveLength(1);
      expect(passed[0].actor).toBe('0');
      expect(passed[0].data).toEqual({ propertyId: 3 });
      expect(G.turnPhase).toBe('done');
      expect(G.messages).toContain('Passed on buying.');
    } finally {
      RULES.auction.enabled = true; // restore the shared live RULES singleton
    }
  });
});

describe('property_upgraded / property_mortgaged / property_unmortgaged / building_sold — harness (golden-covered: build-mortgage)', () => {
  test('payloads match the build-mortgage golden scenario at each step', () => {
    const client = makeClient(3, 72);
    playScript(client, [
      ['selectCharacter', 'marcus-grayline'],
      ['selectCharacter', 'sophia-ember'],
      ['selectCharacter', 'knox-ironlaw'],
      ['rollDice'], ifCanBuy('buyProperty'), ['endTurn'], // P0
      ['rollDice'], ifCanBuy('buyProperty'), ['endTurn'], // P1
      ['rollDice'], ifCanBuy('buyProperty'), ['endTurn'], // P2
      ['rollDice'], ifCanBuy('buyProperty'), ifPendingCard('acceptCard'), // P0
      proposeForProperty(6), acceptIfTrade,
      proposeForProperty(8), acceptIfTrade,
      proposeForProperty(9), acceptIfTrade,
      ['mortgageProperty', 9],
      ['unmortgageProperty', 9],
      ['upgradeProperty', 6],
      ['sellBuilding', 6],
    ]);
    const G = client.getState().G;

    const mortgaged = eventsOfType(G, 'property_mortgaged');
    expect(mortgaged).toHaveLength(1);
    expect(mortgaged[0].actor).toBe('0');
    expect(mortgaged[0].data).toEqual({ propertyId: 9, amount: 60 });

    const unmortgaged = eventsOfType(G, 'property_unmortgaged');
    expect(unmortgaged).toHaveLength(1);
    expect(unmortgaged[0].actor).toBe('0');
    expect(unmortgaged[0].data).toEqual({ propertyId: 9, cost: 66 });

    const upgraded = eventsOfType(G, 'property_upgraded');
    expect(upgraded).toHaveLength(1);
    expect(upgraded[0].actor).toBe('0');
    expect(upgraded[0].data).toEqual({ propertyId: 6, newLevel: 1, newLevelName: 'House', cost: 46 });

    const sold = eventsOfType(G, 'building_sold');
    expect(sold).toHaveLength(1);
    expect(sold[0].actor).toBe('0');
    expect(sold[0].data).toEqual({ propertyId: 6, newLevel: 0, refund: 23 });

    expect(G.messages).toEqual(expect.arrayContaining([
      'Mortgaged Connecticut Ave for $60.',
      'Unmortgaged Connecticut Ave for $66.',
      'Built House on Oriental Ave for $46!',
      'Sold House on Oriental Ave for $23. Now: Vacant.',
    ]));
  });
});

describe('property_regulated (direct-invocation; no golden scenario\'s cast has Knox exercise his enforcer passive)', () => {
  test('payload {propertyId}, actor is the regulating player', () => {
    const G = freshG();
    G.players[0].character = getCharacterById('knox-ironlaw'); // enforcer passive
    G.ownership[1] = '0';
    Monopoly.moves.regulateProperty(G, makeCtx('0'), 1);
    const reg = eventsOfType(G, 'property_regulated');
    expect(reg).toHaveLength(1);
    expect(reg[0].actor).toBe('0');
    expect(reg[0].data).toEqual({ propertyId: 1 });
    expect(G.players[0].regulatedProperty).toBe(1);
    expect(G.messages).toContain(`Knox Ironlaw regulates ${G.board.spaces[1].name}! (+${RULES.passives.enforcer.regulatedRentBonus * 100}% rent)`);
  });
});

describe('reroll_used (direct-invocation; no golden scenario\'s cast has a stamina-reroll character use one)', () => {
  test('payload {rerollsLeft}, decremented before logging', () => {
    const G = freshG();
    G.players[0].rerollsLeft = 2;
    G.hasRolled = true;
    G.lastDice = { d1: 1, d2: 2, total: 3 };
    Monopoly.moves.useReroll(G, makeCtx('0'));
    const used = eventsOfType(G, 'reroll_used');
    expect(used).toHaveLength(1);
    expect(used[0].actor).toBe('0');
    expect(used[0].data).toEqual({ rerollsLeft: 1 });
    expect(G.messages).toContain('Player 1 uses a reroll! (1 left)');
  });
});

describe('season_changed — harness (golden-covered: season-change)', () => {
  test('payload {seasonIndex, seasonName}, actor null, fires once crossing the changeInterval boundary', () => {
    const client = makeClient(2, 1);
    const steps = [['selectCharacter', 'marcus-grayline'], ['selectCharacter', 'sophia-ember']];
    for (let i = 0; i < 9; i++) steps.push(...round());
    playScript(client, steps);
    const G = client.getState().G;
    const changed = eventsOfType(G, 'season_changed');
    expect(changed).toHaveLength(1);
    expect(changed[0].actor).toBeNull();
    expect(changed[0].data).toEqual({ seasonIndex: 1, seasonName: 'Autumn' });
    expect(G.messages).toContain('🍂 Season changed to Autumn!');
  });
});

describe('bankruptcy + passive_triggered(arbitrageur) — harness (golden-covered: bankruptcy)', () => {
  test('bankruptcy carries creditorId; the arbitrageur bonus follows in the same order as the original pushes', () => {
    const client = makeClient(2, 25);
    playScript(client, [
      ['selectCharacter', 'marcus-grayline'],
      ['selectCharacter', 'sophia-ember'],
      ['rollDice'],
      ifCanBuy('buyProperty'),
      ifPendingCard('acceptCard'),
      (c) => {
        const m = c.getState().G.players[0].money;
        c.moves.proposeTrade({
          targetPlayerId: '1', offeredProperties: [], requestedProperties: [],
          offeredMoney: m - 1, requestedMoney: 0,
        });
      },
      ['acceptTrade'],
      ['endTurn'],
      ['rollDice'], ifCanBuy('buyProperty'), ifPendingCard('acceptCard'), ['endTurn'], // P1 buys something
      ['rollDice'], // P0 lands on P1's new property -> rent -> bankrupt
    ]);
    const G = client.getState().G;

    const bankrupt = eventsOfType(G, 'bankruptcy');
    expect(bankrupt).toHaveLength(1);
    expect(bankrupt[0].actor).toBe('0');
    expect(bankrupt[0].data).toEqual({ creditorId: '1' });

    const arbitrage = eventsOfType(G, 'passive_triggered').find(e => e.data.passive === 'arbitrageur');
    expect(arbitrage).toBeDefined();
    expect(arbitrage.actor).toBe('1');
    expect(arbitrage.data).toEqual({
      passive: 'arbitrageur', effect: 'bankruptcy_bonus',
      amount: RULES.passives.arbitrageur.bankruptcyBonus,
    });
    expect(arbitrage.seq).toBeGreaterThan(bankrupt[0].seq); // order preserved: bankruptcy first, bonus second

    // Integration-tier: bankruptcy reaches gameover, fires exactly one game_over event
    const gameOver = eventsOfType(G, 'game_over');
    expect(gameOver).toHaveLength(1);
    expect(gameOver[0].actor).toBeNull();
    expect(gameOver[0].data.result).toBeDefined();
    expect(gameOver[0].data.result.winner).toBe('1');
    expect(gameOver[0].data.result.reason).toBe('survival');
    // event-only: formatter returns null, so the last message is still the bankruptcy line
    const lastMessage = G.messages[G.messages.length - 1];
    expect(lastMessage).toMatch(/BANKRUPT|crisis arbitrage/);

    expect(G.messages).toEqual(expect.arrayContaining([
      'Marcus Grayline is BANKRUPT!',
      `Sophia Ember gains $${RULES.passives.arbitrageur.bankruptcyBonus} from crisis arbitrage!`,
    ]));
  });
});

// ---------------------------------------------------------------------------
// Task 6 (migration slice 4, FINAL): trade lifecycle + auction lifecycle +
// game_over + guardrail
// ---------------------------------------------------------------------------
//
// Same two-tier split as Tasks 4/5:
//  - "harness" tests drive the SAME baked seed/script as the matching golden
//    scenario (trade-lifecycle, auction-lifecycle) — byte-identical text is
//    already locked by golden-messages.test.js; these add payload-completeness
//    assertions the golden gate itself doesn't make.
//  - game_over has NO golden scenario reaching gameover (none of the 10 frozen
//    scenarios cross a victory condition) — direct-invocation tier only,
//    calling Monopoly.onEnd directly against a crafted G + ctx.gameover.

function propose(targetPlayerId, offeredMoney) {
  return (client) => client.moves.proposeTrade({
    targetPlayerId, offeredProperties: [], requestedProperties: [],
    offeredMoney, requestedMoney: 0,
  });
}

describe('trade_proposed / trade_accepted / trade_rejected / trade_cancelled — harness (golden-covered: trade-lifecycle)', () => {
  test('payloads mirror G.trade field names at each step; actors per the brief (proposer for propose/cancel, target for accept/reject)', () => {
    const client = makeClient(2, 1);
    playScript(client, [
      ['selectCharacter', 'marcus-grayline'],
      ['selectCharacter', 'sophia-ember'],
      ['rollDice'],
      ifCanBuy('buyProperty'),
      ifPendingCard('acceptCard'),
      propose('1', 50),
      ['rejectTrade'],
      propose('1', 50),
      ['acceptTrade'],
      propose('1', 50),
      ['cancelTrade'],
    ]);
    const G = client.getState().G;

    const proposed = eventsOfType(G, 'trade_proposed');
    expect(proposed).toHaveLength(3);
    proposed.forEach(e => {
      expect(e.actor).toBe('0');
      expect(e.data).toEqual({
        targetPlayerId: '1', offeredProperties: [], requestedProperties: [],
        offeredMoney: 50, requestedMoney: 0,
      });
    });

    const rejected = eventsOfType(G, 'trade_rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].actor).toBe('1'); // target rejects
    expect(rejected[0].data).toEqual({ proposerId: '0' });

    const accepted = eventsOfType(G, 'trade_accepted');
    expect(accepted).toHaveLength(1);
    expect(accepted[0].actor).toBe('1'); // target accepts
    expect(accepted[0].data).toEqual({ proposerId: '0' });

    const cancelled = eventsOfType(G, 'trade_cancelled');
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0].actor).toBe('0'); // proposer cancels
    expect(cancelled[0].data).toEqual({ targetPlayerId: '1' });

    expect(G.messages).toEqual(expect.arrayContaining([
      'Marcus Grayline proposes a trade to Sophia Ember!',
      'Sophia Ember rejected the trade.',
      'Trade accepted! Marcus Grayline and Sophia Ember completed a trade.',
    ]));
  });
});

describe('auction_started / auction_turn / bid_placed / auction_passed / auction_ended — harness (golden-covered: auction-lifecycle)', () => {
  test('auction #1 (bid then win) + auction #2 (zero bids) payload shapes', () => {
    const client = makeClient(2, 1);
    playScript(client, [
      ['selectCharacter', 'marcus-grayline'],
      ['selectCharacter', 'sophia-ember'],
      ['rollDice'],
      ['passProperty'],  // -> auction #1 (Reading Railroad, propertyId 5)
      ['placeBid', 2],
      ['passAuction'],   // P1 passes -> P0 wins
      ['endTurn'],
      ['rollDice'], ifCanBuy('buyProperty'), ifPendingCard('acceptCard'), ['endTurn'], // P1 filler turn
      ['rollDice'],
      ['passProperty'],  // -> auction #2 (Vermont Ave, propertyId 8)
      ['passAuction'],   // P0 (bidders[0]) passes with no bid
      ['passAuction'],   // P1 passes -> zero bids, remains unowned
    ]);
    const G = client.getState().G;

    const started = eventsOfType(G, 'auction_started');
    expect(started).toHaveLength(2);
    started.forEach(e => {
      expect(e.actor).toBeNull();
      expect(e.data.bidders).toEqual(['0', '1']);
    });
    expect(started[0].data.propertyId).toBe(5); // Reading Railroad
    expect(started[1].data.propertyId).toBe(8); // Vermont Ave

    const turns = eventsOfType(G, 'auction_turn');
    expect(turns).toHaveLength(4); // 2 per auction: initial announce + one rotation
    expect(turns.map(e => e.data.bidderId)).toEqual(['0', '1', '0', '1']);
    turns.forEach(e => expect(e.actor).toBeNull());

    const bids = eventsOfType(G, 'bid_placed');
    expect(bids).toHaveLength(1);
    expect(bids[0].actor).toBe('0');
    expect(bids[0].data).toEqual({ propertyId: 5, amount: 2 });

    const passes = eventsOfType(G, 'auction_passed');
    expect(passes).toHaveLength(3); // Sophia (auction #1), Marcus + Sophia (auction #2)
    expect(passes.map(e => e.actor)).toEqual(['1', '0', '1']);
    passes.forEach(e => expect(e.data.propertyId).toBeDefined());

    const ended = eventsOfType(G, 'auction_ended');
    expect(ended).toHaveLength(2);
    expect(ended[0].actor).toBeNull();
    expect(ended[0].data).toEqual({ propertyId: 5, winnerId: '0', amount: 2 });
    expect(ended[1].actor).toBeNull();
    expect(ended[1].data).toEqual({ propertyId: 8, winnerId: null, amount: null });

    // G.messages is the per-turn reset buffer (rollDice resets it), so only
    // auction #2's lines survive into the final snapshot here — auction #1's
    // text ("Reading Railroad goes to auction...", "...wins the auction...")
    // is locked byte-identical by the golden gate instead (see
    // fixtures/golden-messages.json's auction-lifecycle scenario).
    expect(G.messages).toEqual(expect.arrayContaining([
      'Vermont Ave goes to auction! Bidding starts at $1.',
      "Marcus Grayline's turn to bid.",
      'Marcus Grayline passes.',
      'Sophia Ember passes.',
      'No bids. Vermont Ave remains unowned.',
    ]));
  });
});

describe('game_over (direct-invocation; no golden scenario reaches a victory condition)', () => {
  test('Monopoly.onEnd logs a null-formatted, event-only game_over carrying ctx.gameover', () => {
    const G = freshG();
    const messagesBefore = [...G.messages];
    const eventsBefore = G.events.length;
    const gameover = { winner: '0', reason: 'survival', standings: [{ id: '0', netWorth: 1800 }] };

    Monopoly.onEnd(G, { gameover });

    const ended = eventsOfType(G, 'game_over');
    expect(ended).toHaveLength(1);
    expect(ended[0].actor).toBeNull();
    expect(ended[0].data).toEqual({ result: gameover });
    expect(G.events.length).toBe(eventsBefore + 1);
    // event-only: formatter returns null, so no line is appended to G.messages
    expect(G.messages).toEqual(messagesBefore);
  });
});

// ---------------------------------------------------------------------------
// Task 7: old-save backfill for event fields
// ---------------------------------------------------------------------------
//
// When loading an old save (pre-event-field era), the loadGame stub-setup must
// backfill events: [], eventSeq: 0, enforceSeats: false so the game doesn't
// crash when processing the first move after load. This test simulates an old
// save by driving a short game, deleting the new fields, and reconstructing
// via the loadGame stub pattern.

describe('loadGame backfill for old saves (Task 7)', () => {
  test('old save without events/eventSeq/enforceSeats backfills cleanly and emits seq 0 on first move', () => {
    // Drive a short game and serialize G
    const client = makeClient(2, 1);
    playScript(client, [
      ['selectCharacter', 'marcus-grayline'],
      ['selectCharacter', 'sophia-ember'],
      ['rollDice'], ifCanBuy('buyProperty'), ['endTurn'],
    ]);
    const savedG = JSON.parse(JSON.stringify(client.getState().G));
    const numPlayers = 2;

    // Simulate an old save: delete the three new fields
    delete savedG.events;
    delete savedG.eventSeq;
    delete savedG.enforceSeats;

    // Reconstruct via the loadGame stub-setup pattern (mirrors App.js line 2403)
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
    const restoredClient = Client({ game: LoadedGame, numPlayers, debug: false });
    restoredClient.start();

    const G = restoredClient.getState().G;
    // Backfilled on load (stub-setup fires during Client init)
    expect(G.events).toEqual([]);
    expect(G.eventSeq).toBe(0);
    expect(G.enforceSeats).toBe(false);

    // First move after load emits seq 0, no crash
    restoredClient.moves.rollDice();
    const G2 = restoredClient.getState().G;
    expect(G2.events.length).toBeGreaterThan(0);
    const firstEvent = G2.events[0];
    expect(firstEvent.seq).toBe(0);
    expect(firstEvent.type).toBe('dice_rolled');
  });
});

describe('guardrail: no raw G.messages mutation remains in Game.js', () => {
  test('src/Game.js has zero matches for messages.push or G.messages assignment', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'Game.js'), 'utf8');
    expect(source).not.toMatch(/messages\s*\.push/);
    expect(source).not.toMatch(/G\.messages\s*=/);
  });
});
