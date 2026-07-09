import { decideMoves, chooseRoute, upgradeableSpaces, DEFAULT_POLICY } from '../sim/bot';

// --- Crafted G builders --------------------------------------------------------
// Minimal G states shaped like Game.js setup() output — only the fields the bot
// reads. Keeps tests fast and decoupled from the full reducer.

function loopBoard() {
  // A tiny loop board: 2 properties in group 'red', plus a plain GO.
  return {
    movementMode: 'loop',
    boardSize: 3,
    spaces: [
      { id: 0, type: 'go', name: 'GO' },
      { id: 1, type: 'property', color: 'red', price: 100, rent: 10, name: 'Red 1' },
      { id: 2, type: 'property', color: 'red', price: 100, rent: 10, name: 'Red 2' },
    ],
    colorGroups: { red: [1, 2] },
    edges: null,
  };
}

function baseG(overrides) {
  const G = {
    board: loopBoard(),
    players: [
      { id: '0', money: 1500, position: 0, properties: [], inJail: false, jailTurns: 0, bankrupt: false, character: null },
      { id: '1', money: 1500, position: 0, properties: [], inJail: false, jailTurns: 0, bankrupt: false, character: null },
    ],
    ownership: { 1: null, 2: null },
    buildings: {},
    mortgaged: {},
    hasRolled: false,
    canBuy: false,
    effectivePrice: 0,
    pendingCard: null,
    auction: null,
    trade: null,
    lastDice: null,
  };
  return Object.assign(G, overrides || {});
}

const ctx0 = { currentPlayer: '0' };

describe('decideMoves — roll phase', () => {
  test('loop map: not yet rolled → rollDice', () => {
    const G = baseG();
    expect(decideMoves(G, ctx0, '0', {})).toEqual([['rollDice']]);
  });

  test('atlas map: not yet rolled → rollOnly then deferred commitRoute', () => {
    const G = baseG();
    G.board.movementMode = 'atlas';
    G.board.edges = [[1], [2], [0]];
    expect(decideMoves(G, ctx0, '0', {})).toEqual([['rollOnly'], ['commitRoute', null]]);
  });

  test('already rolled, nothing to do → endTurn', () => {
    const G = baseG({ hasRolled: true });
    expect(decideMoves(G, ctx0, '0', {})).toEqual([['endTurn']]);
  });
});

describe('decideMoves — buy gate at cashBuffer', () => {
  test('buys when money - cashBuffer >= price', () => {
    const G = baseG({ hasRolled: true, canBuy: true, effectivePrice: 100 });
    G.players[0].position = 1;
    G.players[0].money = 400; // 400 - 200 buffer = 200 >= 100
    expect(decideMoves(G, ctx0, '0', { cashBuffer: 200 })).toEqual([['buyProperty']]);
  });

  test('passes when buying would dip below cashBuffer', () => {
    const G = baseG({ hasRolled: true, canBuy: true, effectivePrice: 100 });
    G.players[0].position = 1;
    G.players[0].money = 250; // 250 - 200 = 50 < 100
    expect(decideMoves(G, ctx0, '0', { cashBuffer: 200 })).toEqual([['passProperty']]);
  });

  test('cashBuffer is configurable (buffer 0 buys aggressively)', () => {
    const G = baseG({ hasRolled: true, canBuy: true, effectivePrice: 100 });
    G.players[0].position = 1;
    G.players[0].money = 120;
    expect(decideMoves(G, ctx0, '0', { cashBuffer: 0 })).toEqual([['buyProperty']]);
  });
});

describe('decideMoves — build only on full group + buffer', () => {
  function ownBothRed(G, money) {
    G.players[0].properties = [1, 2];
    G.ownership = { 1: '0', 2: '0' };
    G.players[0].money = money;
  }

  test('upgrades cheapest eligible when full group owned and buffer allows', () => {
    const G = baseG({ hasRolled: true });
    ownBothRed(G, 1000); // upgrade cost = floor(100 * 0.5) = 50
    const moves = decideMoves(G, ctx0, '0', { cashBuffer: 200, buildAggression: 1.0 });
    expect(moves).toEqual([['upgradeProperty', 1]]); // pid 1 (cheapest/first, both equal)
  });

  test('does NOT build when group incomplete', () => {
    const G = baseG({ hasRolled: true });
    G.players[0].properties = [1];
    G.ownership = { 1: '0', 2: null };
    G.players[0].money = 1000;
    expect(decideMoves(G, ctx0, '0', {})).toEqual([['endTurn']]);
  });

  test('does NOT build when buffer would be breached', () => {
    const G = baseG({ hasRolled: true });
    ownBothRed(G, 230); // 230 - 200 = 30 < 50 upgrade cost
    expect(decideMoves(G, ctx0, '0', { cashBuffer: 200 })).toEqual([['endTurn']]);
  });

  test('buildAggression > 1 makes the bot hoard before building', () => {
    const G = baseG({ hasRolled: true });
    ownBothRed(G, 280); // 280 - 200 = 80; cost 50; aggression 2 needs >=100
    expect(decideMoves(G, ctx0, '0', { cashBuffer: 200, buildAggression: 2.0 })).toEqual([['endTurn']]);
    // lower aggression builds
    expect(decideMoves(G, ctx0, '0', { cashBuffer: 200, buildAggression: 1.0 })).toEqual([['upgradeProperty', 1]]);
  });

  test('upgradeableSpaces respects even-building rule (min level first)', () => {
    const G = baseG();
    G.players[0].properties = [1, 2];
    G.ownership = { 1: '0', 2: '0' };
    G.buildings = { 1: 1 }; // pid 1 at level 1, pid 2 at level 0
    const elig = upgradeableSpaces(G, '0');
    // only pid 2 is eligible (pid 1 is above the group min)
    expect(elig.map(e => e.pid)).toEqual([2]);
  });
});

describe('decideMoves — jail fine gate', () => {
  test('pays fine + rolls when affordable above buffer', () => {
    const G = baseG();
    G.players[0].inJail = true;
    G.players[0].money = 300; // 300 - 200 = 100 >= 50 fine
    const moves = decideMoves(G, ctx0, '0', { cashBuffer: 200, payJailFine: true });
    expect(moves[0]).toEqual(['payJailFine']);
    expect(moves[1]).toEqual(['rollDice']);
  });

  test('does NOT pay fine when it would breach buffer → just rolls', () => {
    const G = baseG();
    G.players[0].inJail = true;
    G.players[0].money = 230; // 230 - 200 = 30 < 50 fine
    expect(decideMoves(G, ctx0, '0', { cashBuffer: 200, payJailFine: true })).toEqual([['rollDice']]);
  });

  test('payJailFine policy off → never pays, just rolls', () => {
    const G = baseG();
    G.players[0].inJail = true;
    G.players[0].money = 1000;
    expect(decideMoves(G, ctx0, '0', { payJailFine: false })).toEqual([['rollDice']]);
  });
});

describe('decideMoves — blocking states', () => {
  test('pendingCard → acceptCard (before anything else)', () => {
    const G = baseG({ hasRolled: true, pendingCard: { card: {}, deck: 'chance' } });
    expect(decideMoves(G, ctx0, '0', {})).toEqual([['acceptCard']]);
  });

  test('auction → bids up to cap', () => {
    const G = baseG({ hasRolled: true });
    G.auction = {
      propertyId: 1, currentBid: 0, currentBidder: null,
      bidders: [{ playerId: '0', passed: false }], currentBidderIndex: 0,
    };
    // faceValue 100, cap 0.6 → 60; startingBid 1 <= 60 → bid 1
    expect(decideMoves(G, ctx0, '0', { auctionMaxFraction: 0.6 })).toEqual([['placeBid', 1]]);
  });

  test('auction → passes when next bid exceeds cap', () => {
    const G = baseG({ hasRolled: true });
    G.auction = {
      propertyId: 1, currentBid: 60, currentBidder: '1',
      bidders: [{ playerId: '0', passed: false }], currentBidderIndex: 0,
    };
    // next min bid = 61 > cap 60 → pass
    expect(decideMoves(G, ctx0, '0', { auctionMaxFraction: 0.6 })).toEqual([['passAuction']]);
  });
});

// --- duel (Task 7 of the duel mechanism) ---------------------------------------
// duelDecision derives its actors from G.duel.challengerId/ownerId directly (see
// bot.js), never from the `playerID`/`ctx` args — so every test below passes
// ctx0/'0' regardless of which side ('0' the challenger, '1' the owner) is
// actually deciding; only G.duel and the players' character stats matter.
describe('decideMoves — duel offer (challenger)', () => {
  function offerG(challengerStats, ownerStats) {
    const G = baseG({ hasRolled: true, totalTurns: 10 });
    G.duel = { phase: 'offer', propertyId: 1, ownerId: '1', challengerId: '0', rent: 50 };
    G.players[0].character = { stats: Object.assign({ stamina: 0, luck: 0 }, challengerStats) };
    G.players[1].character = { stats: Object.assign({ stamina: 0, luck: 0 }, ownerStats) };
    return G;
  }

  test("'never' always pays rent, regardless of stats", () => {
    const G = offerG({ stamina: 10, luck: 10 }, { stamina: 1, luck: 0 });
    expect(decideMoves(G, ctx0, '0', { duelPolicy: 'never' })).toEqual([['payRent']]);
  });

  test("'always' initiates when cooldown allows", () => {
    const G = offerG({}, {});
    G.players[0].lastDuelTurn = null; // never dueled before → no cooldown
    expect(decideMoves(G, ctx0, '0', { duelPolicy: 'always' })).toEqual([['initiateDuel']]);
  });

  test("'always' falls back to payRent when cooldown blocks (never dispatches an INVALID_MOVE)", () => {
    const G = offerG({}, {});
    G.totalTurns = 10;
    G.players[0].lastDuelTurn = 9; // 10-9=1 < default cooldownTurns 3 → blocked
    expect(decideMoves(G, ctx0, '0', { duelPolicy: 'always' })).toEqual([['payRent']]);
  });

  test("'always' initiates once the cooldown has elapsed", () => {
    const G = offerG({}, {});
    G.totalTurns = 10;
    G.players[0].lastDuelTurn = 5; // 10-5=5 >= 3 → not blocked
    expect(decideMoves(G, ctx0, '0', { duelPolicy: 'always' })).toEqual([['initiateDuel']]);
  });

  test("'strength' initiates when challenger strictly stronger (stamina + floor(luck/2))", () => {
    // challenger: 6 + floor(4/2) = 8; owner: 5 + floor(2/2) = 6
    const G = offerG({ stamina: 6, luck: 4 }, { stamina: 5, luck: 2 });
    expect(decideMoves(G, ctx0, '0', { duelPolicy: 'strength' })).toEqual([['initiateDuel']]);
  });

  test("'strength' pays rent on a tie (strict > required, ties lose)", () => {
    const G = offerG({ stamina: 5, luck: 0 }, { stamina: 5, luck: 0 });
    expect(decideMoves(G, ctx0, '0', { duelPolicy: 'strength' })).toEqual([['payRent']]);
  });

  test("'strength' pays rent when challenger is weaker", () => {
    const G = offerG({ stamina: 3, luck: 0 }, { stamina: 5, luck: 4 });
    expect(decideMoves(G, ctx0, '0', { duelPolicy: 'strength' })).toEqual([['payRent']]);
  });
});

describe('decideMoves — duel response (owner), policy-independent', () => {
  function responseG(challengerStats, ownerStats) {
    const G = baseG({ hasRolled: true });
    G.duel = { phase: 'response', propertyId: 1, ownerId: '1', challengerId: '0', rent: 50 };
    G.players[0].character = { stats: Object.assign({ stamina: 0, luck: 0 }, challengerStats) };
    G.players[1].character = { stats: Object.assign({ stamina: 0, luck: 0 }, ownerStats) };
    return G;
  }

  test('defender strictly stronger → respondDuel (fight)', () => {
    const G = responseG({ stamina: 3, luck: 0 }, { stamina: 6, luck: 4 });
    expect(decideMoves(G, ctx0, '0', { duelPolicy: 'never' })).toEqual([['respondDuel']]);
  });

  test('tie → respondDuel (matches engine tieGoesToDefender default)', () => {
    const G = responseG({ stamina: 5, luck: 0 }, { stamina: 5, luck: 0 });
    expect(decideMoves(G, ctx0, '0', { duelPolicy: 'never' })).toEqual([['respondDuel']]);
  });

  test('defender weaker → declineDuel', () => {
    const G = responseG({ stamina: 8, luck: 4 }, { stamina: 3, luck: 0 });
    expect(decideMoves(G, ctx0, '0', { duelPolicy: 'always' })).toEqual([['declineDuel']]);
  });

  test("owner's duelPolicy value never changes the response decision", () => {
    const strong = responseG({ stamina: 1, luck: 0 }, { stamina: 9, luck: 8 });
    const weak = responseG({ stamina: 1, luck: 0 }, { stamina: 9, luck: 8 });
    expect(decideMoves(strong, ctx0, '0', { duelPolicy: 'strength' }))
      .toEqual(decideMoves(weak, ctx0, '0', { duelPolicy: 'never' }));
  });
});

describe('DEFAULT_POLICY.duelPolicy', () => {
  test("defaults to 'never' (existing sim runs are byte-identical unless overridden)", () => {
    expect(DEFAULT_POLICY.duelPolicy).toBe('never');
  });
});

describe('decideMoves — mortgage to survive', () => {
  test('mortgages lowest-value holding when money is negative', () => {
    const G = baseG({ hasRolled: true });
    G.players[0].properties = [2, 1]; // pid order doesn't matter; both price 100
    G.ownership = { 1: '0', 2: '0' };
    G.board.spaces[1].price = 80;  // cheaper → mortgaged first
    G.board.spaces[2].price = 120;
    G.players[0].money = -10;
    expect(decideMoves(G, ctx0, '0', {})).toEqual([['mortgageProperty', 1]]);
  });
});

describe('chooseRoute — camper vs tourer', () => {
  // Crafted atlas board: fork at node 0. Branch A visits places {a} (homebody,
  // player already owns a), branch B visits places {b, c} (more distinct, all new).
  function forkG() {
    return {
      board: {
        movementMode: 'atlas',
        spaces: [
          { id: 0, type: 'go', name: 'Start', placeId: 'start' },
          { id: 1, type: 'property', placeId: 'a', price: 100, name: 'A1' },
          { id: 2, type: 'property', placeId: 'a', price: 100, name: 'A2' },
          { id: 3, type: 'property', placeId: 'b', price: 100, name: 'B1' },
          { id: 4, type: 'property', placeId: 'c', price: 100, name: 'C1' },
        ],
        colorGroups: { a: [1, 2], b: [3], c: [4] },
      },
      players: [{ id: '0', properties: [1, 2] }], // owns place 'a'
      ownership: { 1: '0', 2: '0', 3: null, 4: null },
    };
  }

  const choices = [
    { node: 1, route: [1, 2] },   // branch A: stays in owned place 'a'
    { node: 3, route: [3, 4] },   // branch B: two new distinct places 'b','c'
  ];

  test('camper stays near owned cluster (branch A)', () => {
    const G = forkG();
    const route = chooseRoute(G, { currentPlayer: '0' }, choices, 'camper');
    expect(route).toEqual([1, 2]);
  });

  test('tourer seeks coverage / new places (branch B)', () => {
    const G = forkG();
    const route = chooseRoute(G, { currentPlayer: '0' }, choices, 'tourer');
    expect(route).toEqual([3, 4]);
  });

  test('single choice → that route regardless of strategy', () => {
    const G = forkG();
    const one = [{ node: 1, route: [1, 2] }];
    expect(chooseRoute(G, { currentPlayer: '0' }, one, 'tourer')).toEqual([1, 2]);
    expect(chooseRoute(G, { currentPlayer: '0' }, one, 'camper')).toEqual([1, 2]);
  });

  test('no choices → empty route (legal stall)', () => {
    const G = forkG();
    expect(chooseRoute(G, { currentPlayer: '0' }, [], 'camper')).toEqual([]);
  });
});

describe('DEFAULT_POLICY', () => {
  test('exposes all knobs with sane defaults', () => {
    expect(DEFAULT_POLICY).toMatchObject({
      cashBuffer: expect.any(Number),
      buildAggression: expect.any(Number),
      auctionMaxFraction: expect.any(Number),
      routeStrategy: expect.any(String),
    });
  });
});
