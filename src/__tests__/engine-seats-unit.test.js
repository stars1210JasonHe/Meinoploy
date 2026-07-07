// Task 9: seat authorization — single-client unit tests.
//
// Cross-client (real two-client, real master round-trip) seat tests are
// Task 10's job (per task-9-brief.md: "unit tests (guard logic only —
// cross-client tests are Task 10)"). This file proves the guard logic itself:
//   - requireActor truth table (the pure function)
//   - setup(ctx, setupData) plumbing (both a direct call and a real Client()
//     round-trip via a wrapped game def, since Local()'s public API has no
//     setupData channel — spec §4 "seats — real master round-trip")
//   - proposeTrade × awaitingRoute (route-stomping hole)
//   - bankruptcy interleaving: cancels a pending trade; advances a pending
//     auction when the ACTING bidder goes bankrupt; advanceAuction's own
//     bankrupt-bidder skip
//   - hot-seat inertness: enforceSeats false makes every guard a no-op, even
//     for a "wrong seat" shaped call (acceptTrade/placeBid explicit checks —
//     the two move pairs that would have broken hot-seat forever without the
//     `!G.enforceSeats ||` prefix, per spec §3.1)
//   - activePlayers envelopes: proposeTrade/accept/cancel (trade) and
//     start/rotate/zero-bids-exit (auction) actually queue the expected
//     setActivePlayers payload under enforceSeats
//
// Driving style matches the rest of this suite (Game.test.js,
// engine-events-emit.test.js, atlas-engine.test.js): direct move invocation
// `Monopoly.moves.X(G, ctx, ...)` against a hand-built G (via Monopoly.setup)
// and a hand-built ctx — no Client() needed except for the two setupData
// plumbing tests that specifically need to prove the real framework wiring.
import { INVALID_MOVE } from 'boardgame.io/core';
import { Client } from 'boardgame.io/client';
import { Monopoly, requireActor } from '../Game';

// --- shared helpers (mirror engine-events-emit.test.js's own; not exported from there) ---

function freshG() {
  const ctx = { numPlayers: 2, playOrder: ['0', '1'] };
  const G = Monopoly.setup(ctx);
  G.phase = 'play'; // skip character selection for gameplay tests
  return G;
}

function valForDie(n) {
  return (n - 1) / 6 + 0.01;
}

// ctx with a mocked random and playerID === currentPlayer (the hot-seat
// shape — assumedPlayerID always substitutes ctx.currentPlayer). Use
// makeCtxSeats below when a test needs playerID to diverge from currentPlayer
// (cross-seat exception moves under enforceSeats).
function makeCtx(currentPlayer = '0', d1 = 1, d2 = 2) {
  let i = 0;
  const values = [valForDie(d1), valForDie(d2)];
  return {
    currentPlayer,
    playerID: currentPlayer,
    numPlayers: 2,
    random: { Number: () => values[i++ % values.length] },
    events: { endTurn: jest.fn(), setActivePlayers: jest.fn() },
  };
}

// ctx with playerID set independently of currentPlayer — for enforceSeats
// tests exercising the two genuine cross-seat exceptions (acceptTrade/
// rejectTrade → G.trade.targetPlayerId; placeBid/passAuction → the acting
// bidder) and the envelope tests.
function makeCtxSeats(currentPlayer, playerID) {
  return {
    currentPlayer,
    playerID,
    numPlayers: 2,
    random: { Number: () => 0.5 },
    events: { endTurn: jest.fn(), setActivePlayers: jest.fn() },
  };
}

function eventsOfType(G, type) {
  return G.events.filter(e => e.type === type);
}

// ---------------------------------------------------------------------------

describe('requireActor (pure function truth table)', () => {
  test('enforceSeats false: always true, regardless of ctx.playerID', () => {
    expect(requireActor({ enforceSeats: false }, { playerID: '0' }, '1')).toBe(true);
    expect(requireActor({ enforceSeats: false }, { playerID: null }, '1')).toBe(true);
    expect(requireActor({ enforceSeats: false }, {}, '1')).toBe(true);
  });

  test('enforceSeats true: exact match only', () => {
    expect(requireActor({ enforceSeats: true }, { playerID: '0' }, '0')).toBe(true);
    expect(requireActor({ enforceSeats: true }, { playerID: '1' }, '0')).toBe(false);
    expect(requireActor({ enforceSeats: true }, { playerID: null }, '0')).toBe(false);
  });

  test('enforceSeats true: String() coercion on expectedId (numeric ids match string playerID)', () => {
    expect(requireActor({ enforceSeats: true }, { playerID: '0' }, 0)).toBe(true);
    expect(requireActor({ enforceSeats: true }, { playerID: '2' }, 2)).toBe(true);
    expect(requireActor({ enforceSeats: true }, { playerID: '2' }, 3)).toBe(false);
  });
});

describe('setup(ctx, setupData) plumbing (Task 9)', () => {
  test('direct: setupData.enforceSeats true -> G.enforceSeats true; absent setupData -> false', () => {
    const withFlag = Monopoly.setup({ numPlayers: 2, playOrder: ['0', '1'] }, { enforceSeats: true });
    expect(withFlag.enforceSeats).toBe(true);

    const withoutSetupData = Monopoly.setup({ numPlayers: 2, playOrder: ['0', '1'] });
    expect(withoutSetupData.enforceSeats).toBe(false);

    const withFalseFlag = Monopoly.setup({ numPlayers: 2, playOrder: ['0', '1'] }, { enforceSeats: false });
    expect(withFalseFlag.enforceSeats).toBe(false);
  });

  // Local()'s public Client() API has no setupData channel (verified against
  // client.d.ts, spec §3.1) — a game def that wraps setup() to inject
  // setupData is the documented workaround for proving the real Client()
  // round-trip (spec §4's "seats — real master round-trip"), mirroring the
  // exact LoadedGame stub-setup idiom already used by the Task 7
  // loadGame-backfill test in engine-events-emit.test.js.
  test('client round-trip: a game def wrapping setup(ctx, {enforceSeats:true}) yields G.enforceSeats true through a real Client()', () => {
    const seatEnforcedGame = {
      ...Monopoly,
      setup: (ctx) => Monopoly.setup(ctx, { enforceSeats: true }),
    };
    const client = Client({ game: seatEnforcedGame, numPlayers: 2, debug: false });
    client.start();
    expect(client.getState().G.enforceSeats).toBe(true);
  });

  test('client round-trip: the real Monopoly def with no setupData yields G.enforceSeats false', () => {
    const client = Client({ game: Monopoly, numPlayers: 2, debug: false });
    client.start();
    expect(client.getState().G.enforceSeats).toBe(false);
  });
});

describe('proposeTrade × awaitingRoute (Task 9 route-stomping fix)', () => {
  test('returns INVALID_MOVE and leaves G.trade untouched when a route choice is pending', () => {
    const G = freshG();
    G.hasRolled = true;
    G.awaitingRoute = true;

    const result = Monopoly.moves.proposeTrade(G, makeCtx('0'), {
      targetPlayerId: '1', offeredProperties: [], requestedProperties: [], offeredMoney: 0, requestedMoney: 0,
    });

    expect(result).toBe(INVALID_MOVE);
    expect(G.trade).toBeNull();
  });
});

describe('bankruptcy interleaving: cancels a pending trade (Task 9)', () => {
  test('rent bankruptcy with a pending trade cancels it and logs trade_cancelled (new line, documented deviation)', () => {
    const G = freshG();
    G.ownership[3] = '1'; // Baltic Ave (price 60, rent 8), owned by P1
    G.players[1].properties.push(3);
    G.players[0].money = 5; // rent (8) will bankrupt P0
    G.trade = {
      proposerId: '0', targetPlayerId: '1',
      offeredProperties: [], requestedProperties: [],
      offeredMoney: 0, requestedMoney: 0,
    };
    G.turnPhase = 'trade';
    G.hasRolled = false;

    // total 3 -> P0 (at position 0) lands exactly on Baltic Ave -> rent -> bankrupt
    Monopoly.moves.rollDice(G, makeCtx('0', 1, 2));

    expect(G.players[0].bankrupt).toBe(true);
    expect(G.trade).toBeNull();

    const bankrupt = eventsOfType(G, 'bankruptcy');
    expect(bankrupt).toHaveLength(1);

    const cancelled = eventsOfType(G, 'trade_cancelled');
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0].actor).toBe('0'); // the bankrupt player
    expect(cancelled[0].data).toEqual({ otherPartyId: '1', reason: 'bankruptcy' });
    expect(cancelled[0].seq).toBeGreaterThan(bankrupt[0].seq); // bankruptcy first, cancellation follows

    // formatEventMessage('trade_cancelled') is unconditional ('Trade cancelled.')
    // regardless of payload shape — this is the new line on a previously-
    // undefined path (no golden scenario has a pending trade at bankruptcy;
    // golden-messages.test.js is unaffected — verified by the full suite run).
    expect(G.messages).toContain('Trade cancelled.');
  });

  test('bankruptcy leaves an UNRELATED pending trade (different players) untouched', () => {
    const G = Monopoly.setup({ numPlayers: 3, playOrder: ['0', '1', '2'] });
    G.phase = 'play';
    G.ownership[3] = '2';
    G.players[2].properties.push(3);
    G.players[0].money = 5;
    G.trade = {
      proposerId: '1', targetPlayerId: '2', // does NOT involve P0, the soon-to-be-bankrupt player
      offeredProperties: [], requestedProperties: [],
      offeredMoney: 0, requestedMoney: 0,
    };
    G.turnPhase = 'trade';
    G.hasRolled = false;

    Monopoly.moves.rollDice(G, { ...makeCtx('0', 1, 2), numPlayers: 3 });

    expect(G.players[0].bankrupt).toBe(true);
    expect(G.trade).not.toBeNull(); // untouched — bankrupt player wasn't a party to it
    expect(eventsOfType(G, 'trade_cancelled')).toHaveLength(0);
  });
});

describe('advanceAuction skips bankrupt bidders (Task 9 interleaving fix)', () => {
  test('a bankrupt bidder in the rotation is skipped, advancing straight to the next live bidder', () => {
    const G = Monopoly.setup({ numPlayers: 3, playOrder: ['0', '1', '2'] });
    G.phase = 'play';
    G.auction = {
      propertyId: 5, currentBid: 0, currentBidder: null,
      bidders: [
        { playerId: '0', passed: false },
        { playerId: '1', passed: false },
        { playerId: '2', passed: false },
      ],
      currentBidderIndex: 0,
    };
    G.players[1].bankrupt = true;

    Monopoly.moves.passAuction(G, { ...makeCtx('0'), numPlayers: 3 });

    expect(G.auction).not.toBeNull();
    expect(G.auction.currentBidderIndex).toBe(2); // '1' skipped for bankruptcy
    const turns = eventsOfType(G, 'auction_turn');
    expect(turns.map(e => e.data.bidderId)).not.toContain('1');
    expect(turns[turns.length - 1].data.bidderId).toBe('2');
  });

  test('the ACTING bidder going bankrupt (mid-auction, via useReroll) advances the auction immediately', () => {
    const G = freshG();
    G.players[0].money = 5;
    G.players[0].rerollsLeft = 1;
    G.hasRolled = true;
    G.lastDice = { d1: 1, d2: 2, total: 3, preRollPosition: 0, preRollDistance: 0, salaryCollected: 10 };
    G.auction = {
      propertyId: 5, currentBid: 0, currentBidder: null,
      bidders: [
        { playerId: '0', passed: false }, // P0 is on the clock AND is currentPlayer this turn
        { playerId: '1', passed: false },
      ],
      currentBidderIndex: 0,
    };

    Monopoly.moves.useReroll(G, makeCtx('0'));

    expect(G.players[0].bankrupt).toBe(true); // refund (10) exceeds money (5)
    expect(G.auction).not.toBeNull(); // one live bidder ('1') remains — not resolved/ended
    expect(G.auction.currentBidderIndex).toBe(1); // advanced off the now-bankrupt acting bidder
  });

  // Reviewer-traced defect: P0 is a bidder AND ctx.currentPlayer for the
  // whole turn. P0 places the high bid (auction.currentBidder = '0'), the
  // rotation moves on to P1 (currentBidderIndex now points at P1, NOT P0), and
  // THEN P0 calls useReroll — legal, since useReroll is guarded only by
  // requireActor(ctx.currentPlayer), not by "is the acting bidder". The
  // salary refund bankrupts P0 while P0 is not the acting bidder, so the
  // pre-existing acting-bidder-advance check alone would never fire, leaving
  // auction.currentBidder pointing at a bankrupt player. If the sole
  // remaining live bidder (P1) then passes, resolveAuction must NOT hand the
  // property to bankrupt P0.
  test('the STANDING HIGH BIDDER going bankrupt (not the acting bidder) cannot win the auction', () => {
    const G = freshG();
    G.players[0].rerollsLeft = 1;
    G.hasRolled = true;
    G.lastDice = { d1: 1, d2: 2, total: 3, preRollPosition: 0, preRollDistance: 0, salaryCollected: 10 };
    G.players[0].money = 5; // refund (10) will bankrupt P0 (5 - 10 <= 0)
    G.auction = {
      propertyId: 5, currentBid: 50, currentBidder: '0', // P0 is the standing high bidder
      bidders: [
        { playerId: '0', passed: false },
        { playerId: '1', passed: false }, // rotation has already moved on to P1
      ],
      currentBidderIndex: 1, // P1 is on the clock, NOT P0
    };

    Monopoly.moves.useReroll(G, makeCtx('0'));

    expect(G.players[0].bankrupt).toBe(true);
    expect(G.players[0].money).toBe(0); // handleBankruptcy zeroes it; no further debit ever applied
    // (a) the bankrupt player is no longer the standing high bidder
    expect(G.auction.currentBidder).not.toBe('0');
    expect(G.auction.currentBidder).toBeNull();
    expect(G.auction.currentBid).toBe(0);
    // P1 was left untouched (still on the clock, hasn't acted) — rotation
    // wasn't force-advanced, since P0 wasn't blocking it.
    expect(G.auction.currentBidderIndex).toBe(1);

    // Drive the auction to resolution: the only live bidder (P1) passes.
    Monopoly.moves.passAuction(G, makeCtx('1'));

    // (b) bankrupt P0 never receives the property, and money never goes
    // further negative than the zero handleBankruptcy already set.
    expect(G.ownership[5]).not.toBe('0');
    expect(G.players[0].properties).not.toContain(5);
    expect(G.players[0].money).toBe(0);
    // (c) the auction ends in the unowned (no-winner) outcome.
    expect(G.auction).toBeNull();
    expect(G.ownership[5]).toBeNull();
    const ended = eventsOfType(G, 'auction_ended');
    expect(ended).toHaveLength(1);
    expect(ended[0].data).toEqual({ propertyId: 5, winnerId: null, amount: null });
  });

  // Defensive second layer (resolveAuction's own bankrupt-winner guard):
  // proves the guard holds even when a bankrupt currentBidder reaches
  // resolveAuction WITHOUT going through handleBankruptcy's cleanup (e.g. a
  // future call site that misses it). P0 is marked bankrupt directly, still
  // sitting as auction.currentBidder — resolveAuction must refuse to award
  // the property rather than relying solely on the handleBankruptcy cleanup.
  test('resolveAuction refuses to award a bankrupt currentBidder even if the cleanup step is bypassed', () => {
    const G = Monopoly.setup({ numPlayers: 2, playOrder: ['0', '1'] });
    G.phase = 'play';
    const moneyBefore = G.players[0].money;
    G.players[0].bankrupt = true; // bypasses handleBankruptcy's currentBidder cleanup entirely
    G.auction = {
      propertyId: 8, currentBid: 80, currentBidder: '0', // still points at the bankrupt player (id 8 = Vermont Ave, an ownable property)
      bidders: [
        { playerId: '0', passed: false },
        { playerId: '1', passed: false },
      ],
      currentBidderIndex: 1, // P1 on the clock
    };

    Monopoly.moves.passAuction(G, makeCtx('1'));

    expect(G.ownership[8]).toBeNull();
    expect(G.players[0].properties).not.toContain(8);
    expect(G.players[0].money).toBe(moneyBefore); // untouched — no debit applied
    expect(G.auction).toBeNull();
    const ended = eventsOfType(G, 'auction_ended');
    expect(ended).toHaveLength(1);
    expect(ended[0].data).toEqual({ propertyId: 8, winnerId: null, amount: null });
  });
});

describe('hot-seat inertness (Task 9): guards are no-ops when enforceSeats is false', () => {
  test('acceptTrade succeeds even when ctx.playerID does not match G.trade.targetPlayerId', () => {
    const G = freshG();
    expect(G.enforceSeats).toBe(false);
    G.trade = {
      proposerId: '0', targetPlayerId: '1',
      offeredProperties: [], requestedProperties: [],
      offeredMoney: 10, requestedMoney: 0,
    };
    G.players[0].money = 100;

    // ctx.playerID ('0') != the expected actor (G.trade.targetPlayerId, '1') —
    // exactly the hot-seat shape (assumedPlayerID stays ctx.currentPlayer for
    // the whole local session) that must still be authorized.
    const result = Monopoly.moves.acceptTrade(G, makeCtx('0'));

    expect(result).not.toBe(INVALID_MOVE);
    expect(G.trade).toBeNull();
    expect(eventsOfType(G, 'trade_accepted')).toHaveLength(1);
  });

  test('placeBid succeeds even when ctx.playerID does not match the acting bidder', () => {
    const G = freshG();
    expect(G.enforceSeats).toBe(false);
    G.auction = {
      propertyId: 5, currentBid: 0, currentBidder: null,
      bidders: [{ playerId: '0', passed: false }, { playerId: '1', passed: false }],
      currentBidderIndex: 1, // acting bidder is '1'
    };
    G.players[1].money = 100;

    // ctx.playerID ('0') != acting bidder ('1') — this is the guard that would
    // have broken hot-seat auctions forever without the enforceSeats prefix.
    const result = Monopoly.moves.placeBid(G, makeCtx('0'), 5);

    expect(result).not.toBe(INVALID_MOVE);
    expect(G.auction.currentBid).toBe(5);
  });
});

describe('activePlayers envelopes (Task 9, enforceSeats forced true)', () => {
  test('proposeTrade queues both seats active ({targetPlayerId: null, proposerId: null})', () => {
    const G = freshG();
    G.enforceSeats = true;
    G.hasRolled = true;
    G.players[0].money = 100;
    const ctx = makeCtxSeats('0', '0');

    Monopoly.moves.proposeTrade(G, ctx, {
      targetPlayerId: '1', offeredProperties: [], requestedProperties: [], offeredMoney: 10, requestedMoney: 0,
    });

    expect(ctx.events.setActivePlayers).toHaveBeenCalledWith({ value: { '1': null, '0': null } });
  });

  test('acceptTrade restores {currentPlayer: null} on resolution', () => {
    const G = freshG();
    G.enforceSeats = true;
    G.players[0].money = 100;
    G.trade = {
      proposerId: '0', targetPlayerId: '1',
      offeredProperties: [], requestedProperties: [], offeredMoney: 10, requestedMoney: 0,
    };
    const ctx = makeCtxSeats('0', '1'); // acceptTrade's actor is the target ('1')

    Monopoly.moves.acceptTrade(G, ctx);

    expect(ctx.events.setActivePlayers).toHaveBeenCalledWith({ currentPlayer: null });
  });

  test('cancelTrade restores {currentPlayer: null} on resolution', () => {
    const G = freshG();
    G.enforceSeats = true;
    G.trade = {
      proposerId: '0', targetPlayerId: '1',
      offeredProperties: [], requestedProperties: [], offeredMoney: 0, requestedMoney: 0,
    };
    const ctx = makeCtxSeats('0', '0'); // cancelTrade's actor is the proposer ('0')

    Monopoly.moves.cancelTrade(G, ctx);

    expect(ctx.events.setActivePlayers).toHaveBeenCalledWith({ currentPlayer: null });
  });

  test('bankruptcy-cancelled trade also restores {currentPlayer: null}', () => {
    const G = freshG();
    G.enforceSeats = true;
    G.ownership[3] = '1';
    G.players[1].properties.push(3);
    G.players[0].money = 5;
    G.trade = {
      proposerId: '0', targetPlayerId: '1',
      offeredProperties: [], requestedProperties: [], offeredMoney: 0, requestedMoney: 0,
    };
    G.turnPhase = 'trade';
    G.hasRolled = false;
    const ctx = makeCtxSeats('0', '0');
    // Deterministic dice (total 3 -> lands on Baltic Ave, id 3): reuse the
    // same die-mocking makeCtx() does, just with the seat fields grafted on.
    let i = 0;
    const values = [valForDie(1), valForDie(2)];
    ctx.random = { Number: () => values[i++ % values.length] };

    Monopoly.moves.rollDice(G, ctx);

    expect(G.players[0].bankrupt).toBe(true);
    expect(ctx.events.setActivePlayers).toHaveBeenCalledWith({ currentPlayer: null });
  });

  test('auction start (inline in passProperty) queues the first bidder active', () => {
    const G = freshG();
    G.enforceSeats = true;
    G.canBuy = true;
    G.players[0].position = 5; // Reading Railroad
    const ctx = makeCtxSeats('0', '0');

    Monopoly.moves.passProperty(G, ctx);

    expect(G.auction).not.toBeNull();
    expect(ctx.events.setActivePlayers).toHaveBeenCalledWith({ value: { '0': null } });
  });

  test('placeBid rotation queues the next bidder active', () => {
    const G = freshG();
    G.enforceSeats = true;
    G.auction = {
      propertyId: 5, currentBid: 0, currentBidder: null,
      bidders: [{ playerId: '0', passed: false }, { playerId: '1', passed: false }],
      currentBidderIndex: 0,
    };
    G.players[0].money = 100;
    const ctx = makeCtxSeats('0', '0'); // acting bidder is '0'

    Monopoly.moves.placeBid(G, ctx, 5);

    expect(ctx.events.setActivePlayers).toHaveBeenCalledWith({ value: { '1': null } });
  });

  test('passAuction zero-bids exit restores {currentPlayer: null}', () => {
    const G = freshG();
    G.enforceSeats = true;
    G.auction = {
      propertyId: 5, currentBid: 0, currentBidder: null,
      bidders: [{ playerId: '1', passed: false }], // sole remaining bidder, no bids yet
      currentBidderIndex: 0,
    };
    const ctx = makeCtxSeats('0', '1'); // acting bidder is '1'

    Monopoly.moves.passAuction(G, ctx); // the only bidder passes -> zero active bidders, no winner

    expect(G.auction).toBeNull();
    expect(ctx.events.setActivePlayers).toHaveBeenCalledWith({ currentPlayer: null });
  });
});
