// Task 10: cross-client seat authorization matrix over the REAL boardgame.io
// Local() master/dispatch path.
//
// Task 9 (src/Game.js, src/__tests__/engine-seats-unit.test.js) landed
// `requireActor` guards + `setActivePlayers` envelopes, proven ONLY via direct
// `Monopoly.moves.X(G, ctx, ...)` invocation against a hand-built G/ctx — never
// through boardgame.io's actual Master/dispatch machinery, so nothing yet proved
// that a REAL wrong-seat client is actually stopped by the framework wiring (not
// just by the guard function in isolation). This file closes that gap: N distinct
// `Client()`s wired to a shared `Local()` master (src/__tests__/helpers/seatClients.js),
// each pinned to one seat via `playerID`, driving the SAME authorization surface
// end-to-end. See seatClients.js's header for the full mechanics writeup
// (isPlayerActive gate, requireActor's role, the `client:false` fix for a genuine
// v0.45 Local()-transport crash discovered while building this suite).
//
// Maps to the Task 9 reviewer's 7-item handoff list (task-10-report.md has the
// full coverage matrix):
//   1. FLAGSHIP — pending trade + target's client dispatches useReroll -> REJECTED.
//   2. Cross-client wrong-seat sweep (rollDice, upgradeProperty, mortgageProperty,
//      useReroll, endTurn) — wrong-seat rejected, right-seat accepted.
//   3. rejectTrade envelope restore (explicit).
//   4. Auction winner-exit envelope restore — both resolution paths (advanceAuction
//      in-rotation via placeBid; passAuction's own <=1-active branch).
//   5. Bankrupt high bidder never wins — NOTE ONLY (see bottom describe block):
//      unit-tier coverage (engine-seats-unit.test.js, 2 dedicated tests) is judged
//      sufficient; not cheaply reachable through the real client-dispatch path.
//   6. Credentials trust boundary.
//   7. Hot-seat inertness (single client, enforceSeats false).
//
// SEED 8: several trade-window tests need `G.hasRolled === true` durably (only
// reachable via a REAL rollDice — see seatClients.js's makeSeatClients header for
// why patchG can't set it) while ALSO avoiding jail (proposeTrade rejects a
// jailed proposer) and avoiding any card chain (both decks contain a "Go to
// Jail" card — mods/dominion/cards.js — so an unseeded roll risks a spurious,
// intermittent failure unrelated to authorization). Game def seed '8' (threaded
// via makeSeatClients' `seed` option onto the GAME DEFINITION, per v0.45's actual
// PRNG wiring — see src/sim/match.js's own header) was found by brute-force
// search over seeds 1..300 for a 2-player game's FIRST rollDice: total===3, i.e.
// a clean, unowned, card-free landing on Baltic Ave (space id 3, price 60). This
// is the SAME seed-hunt idiom src/__tests__/helpers/drive.js's `seedHunt` codifies,
// just resolved once by hand rather than at test-run time (no non-determinism to
// hunt away at runtime — the seed is fixed and reused everywhere it's needed).
import { makeSeatClients, buildSeatGame, dispatchAndWait, rollAndSettle, snapshotG } from './helpers/seatClients';
import { Client } from 'boardgame.io/client';
import { Local } from 'boardgame.io/multiplayer';
import { Monopoly, setActiveMap } from '../Game';
import { loadMap } from '../map-loader';
import classicMapJson from '../../mods/dominion/maps/classic/map.json';

const SEED_8 = '8'; // see header comment: total===3 on P0's first roll, Baltic Ave.

// Shared shape for a no-frills trade proposal.
function tradeProposal(targetPlayerId, overrides = {}) {
  return {
    targetPlayerId,
    offeredProperties: [],
    requestedProperties: [],
    offeredMoney: 0,
    requestedMoney: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Item 1 — THE FLAGSHIP regression: pending trade + target dispatches a
// currentPlayer-only move (useReroll) from ITS OWN client -> master REJECTS.
// ---------------------------------------------------------------------------
describe('item 1 (flagship): trade target cannot hijack the proposer-only useReroll', () => {
  test('target useReroll is REJECTED while a trade is pending; state and envelope both untouched', async () => {
    const [c0, c1] = makeSeatClients(2, {
      enforceSeats: true,
      seed: SEED_8,
      patchG: (G) => {
        G.phase = 'play';
        G.players[0].rerollsLeft = 1; // the proposer (currentPlayer) legitimately has a reroll
        return G;
      },
    });

    // Real roll + buy so proposeTrade's `hasRolled` precondition is satisfied
    // through actual game logic (not a patchG shortcut — see seatClients.js).
    const rollState = await dispatchAndWait(c0, 'rollDice');
    expect(rollState.G.lastDice.total).toBe(3);
    expect(rollState.G.canBuy).toBe(true);
    const buyState = await dispatchAndWait(c0, 'buyProperty');
    expect(buyState.G.ownership[3]).toBe('0');
    expect(buyState.G.hasRolled).toBe(true);

    // Real proposeTrade -> opens the REAL envelope (ctx.activePlayers), the
    // exact widening that makes the exploit possible in the first place: the
    // built-in isPlayerActive gate now admits P1, but nothing else distinguishes
    // WHICH move P1 may call.
    const proposeState = await dispatchAndWait(c0, 'proposeTrade', tradeProposal('1'));
    expect(proposeState.G.trade).not.toBeNull();
    expect(proposeState.ctx.activePlayers).toEqual({ '0': null, '1': null });

    // THE EXPLOIT ATTEMPT: P1 (the target, legitimately "active" per the
    // envelope) tries to reroll P0's dice via P1's OWN client.
    const before = snapshotG(c1);
    const beforeActivePlayers = c1.getState().ctx.activePlayers;
    const rerollResult = await dispatchAndWait(c1, 'useReroll');

    expect(rerollResult.G).toEqual(before); // fully unchanged — not just rerollsLeft
    expect(rerollResult.G.players[0].rerollsLeft).toBe(1); // proposer's reroll untouched
    expect(rerollResult.G.hasRolled).toBe(true); // dice state untouched
    expect(rerollResult.G.trade).not.toBeNull(); // trade still pending
    expect(rerollResult.ctx.activePlayers).toEqual(beforeActivePlayers); // envelope untouched by the rejection
  }, 15000);
});

// ---------------------------------------------------------------------------
// Item 2 — cross-client wrong-seat sweep over a REPRESENTATIVE sample of
// default-guarded (`requireActor(G, ctx, ctx.currentPlayer)`) moves. Per the
// handoff: "full 22 not required if the guard is uniform, but SAY so" — it is:
// Task 9's guard table (task-9-report.md) shows all 18 non-exception moves use
// the IDENTICAL `requireActor(G, ctx, ctx.currentPlayer)` as the literal first
// line of the move body. rollDice/upgradeProperty/mortgageProperty/useReroll/
// endTurn span every precondition SHAPE those 18 moves have (no extra state
// needed; hasRolled-gated; ownership-gated; hasRolled+player-state-gated;
// multi-flag end-of-turn gated) — the guard itself is not move-specific, so this
// sample is representative, not exhaustive-by-necessity.
// ---------------------------------------------------------------------------
describe('item 2: cross-client wrong-seat sweep (representative default-guarded moves)', () => {
  test('rollDice: wrong-seat rejected, right-seat accepted', async () => {
    const [c0, c1] = makeSeatClients(2, {
      enforceSeats: true,
      patchG: (G) => { G.phase = 'play'; return G; },
    });

    const before = snapshotG(c1);
    const wrong = await dispatchAndWait(c1, 'rollDice');
    expect(wrong.G).toEqual(before);
    expect(wrong.G.hasRolled).toBe(false);

    const right = await dispatchAndWait(c0, 'rollDice');
    expect(right.G.hasRolled).toBe(true);
  }, 15000);

  test('upgradeProperty: wrong-seat rejected, right-seat accepted', async () => {
    // SEED 8 (not an unseeded rollAndSettle) is deliberate here, unlike the
    // other item-2 probes: both chance and community decks include a
    // "freeUpgrade" card (mods/dominion/cards.js) that auto-upgrades one of
    // the CURRENT PLAYER's owned properties — exactly the Brown group this
    // scenario pre-owns. An unseeded roll landing on a card space intermittently
    // drew that card during this task's own investigation, silently setting
    // G.buildings[1] = 1 BEFORE the wrong-seat probe ever dispatched anything,
    // producing a flaky failure with nothing to do with authorization. Seed 8's
    // pinned landing (Baltic Ave, id 3 — already owned, no card, no chain) is
    // card-draw-free, so this test is deterministic like the trade-window ones.
    const [c0, c1] = makeSeatClients(2, {
      enforceSeats: true,
      seed: SEED_8,
      patchG: (G) => {
        G.phase = 'play';
        // Brown group (Mediterranean 1 + Baltic 3), fully owned by P0, no
        // buildings, no mortgages — upgradeProperty's every precondition
        // except hasRolled (which onBegin resets — see seatClients.js).
        G.ownership[1] = '0';
        G.ownership[3] = '0';
        G.players[0].properties = [1, 3];
        return G;
      },
    });

    const rollState = await dispatchAndWait(c0, 'rollDice');
    expect(rollState.G.lastDice.total).toBe(3); // lands on Baltic Ave (3) — already owned, no card
    expect(rollState.G.hasRolled).toBe(true);

    const before = snapshotG(c1);
    const wrong = await dispatchAndWait(c1, 'upgradeProperty', 1);
    expect(wrong.G).toEqual(before);
    expect(wrong.G.buildings[1] || 0).toBe(0);

    const right = await dispatchAndWait(c0, 'upgradeProperty', 1);
    expect(right.G.buildings[1]).toBe(1);
  }, 15000);

  test('mortgageProperty: wrong-seat rejected, right-seat accepted (no roll needed)', async () => {
    const [c0, c1] = makeSeatClients(2, {
      enforceSeats: true,
      patchG: (G) => {
        G.phase = 'play';
        G.ownership[1] = '0';
        G.players[0].properties = [1];
        return G;
      },
    });

    const before = snapshotG(c1);
    const wrong = await dispatchAndWait(c1, 'mortgageProperty', 1);
    expect(wrong.G).toEqual(before);
    expect(wrong.G.mortgaged[1]).toBeFalsy();

    const right = await dispatchAndWait(c0, 'mortgageProperty', 1);
    expect(right.G.mortgaged[1]).toBe(true);
  }, 15000);

  test('useReroll: wrong-seat rejected, right-seat accepted', async () => {
    const [c0, c1] = makeSeatClients(2, {
      enforceSeats: true,
      patchG: (G) => { G.phase = 'play'; G.players[0].rerollsLeft = 1; return G; },
    });

    const rolled = await rollAndSettle(c0);
    expect(rolled.G.hasRolled).toBe(true);

    const before = snapshotG(c1);
    const wrong = await dispatchAndWait(c1, 'useReroll');
    expect(wrong.G).toEqual(before);

    const right = await dispatchAndWait(c0, 'useReroll');
    expect(right.G.hasRolled).toBe(false); // reroll rewinds hasRolled
    expect(right.G.players[0].rerollsLeft).toBe(0);
  }, 15000);

  test('endTurn: wrong-seat rejected, right-seat accepted', async () => {
    const [c0, c1] = makeSeatClients(2, {
      enforceSeats: true,
      patchG: (G) => { G.phase = 'play'; return G; },
    });

    const rolled = await rollAndSettle(c0);
    expect(rolled.G.hasRolled).toBe(true);

    const before = snapshotG(c1);
    const wrong = await dispatchAndWait(c1, 'endTurn');
    expect(wrong.G).toEqual(before);
    expect(wrong.ctx.currentPlayer).toBe('0');

    const right = await dispatchAndWait(c0, 'endTurn');
    expect(right.ctx.currentPlayer).toBe('1');
  }, 15000);
});

// ---------------------------------------------------------------------------
// Item 3 — rejectTrade envelope restore (explicit, previously untested: Task 9's
// unit suite covered acceptTrade/cancelTrade's restore but not rejectTrade's,
// even though it shares the identical code path).
// ---------------------------------------------------------------------------
describe('item 3: rejectTrade envelope restore', () => {
  test('target rejectTrade closes the trade and restores activePlayers to {currentPlayer: null}', async () => {
    const [c0, c1] = makeSeatClients(2, {
      enforceSeats: true,
      seed: SEED_8,
      patchG: (G) => { G.phase = 'play'; return G; },
    });

    await dispatchAndWait(c0, 'rollDice'); // total 3 -> Baltic Ave
    await dispatchAndWait(c0, 'buyProperty');
    const proposeState = await dispatchAndWait(c0, 'proposeTrade', tradeProposal('1'));
    expect(proposeState.G.trade).not.toBeNull();
    expect(proposeState.ctx.activePlayers).toEqual({ '0': null, '1': null });

    // Wrong-seat probe: the PROPOSER trying to reject their own trade (that's
    // the target's exclusive privilege) is rejected too.
    const before = snapshotG(c0);
    const wrongReject = await dispatchAndWait(c0, 'rejectTrade');
    expect(wrongReject.G).toEqual(before);

    const rejectState = await dispatchAndWait(c1, 'rejectTrade');
    expect(rejectState.G.trade).toBeNull();
    expect(rejectState.ctx.activePlayers).toEqual({ '0': null }); // envelope restored to currentPlayer-only

    // Envelope genuinely restored (not just cosmetically) — the proposer can
    // keep acting; the erstwhile target is back to structurally inactive.
    const endState = await dispatchAndWait(c0, 'endTurn');
    expect(endState.ctx.currentPlayer).toBe('1');
  }, 15000);
});

// ---------------------------------------------------------------------------
// Item 4 — auction winner-exit envelope restore, BOTH resolution paths:
//   Path A: advanceAuction's own in-loop match (`bidder.playerId ===
//           auction.currentBidder`), reached via a placeBid whose rotation
//           wraps around finding every OTHER bidder already passed.
//   Path B: passAuction's own direct `activeBidders.length <= 1 &&
//           currentBidder !== null` branch, reached via a pass that leaves
//           exactly one standing bidder.
// Both must restore activePlayers to {currentPlayer: null} and leave
// currentPlayer able to continue (proven via a real rollDice).
// ---------------------------------------------------------------------------
describe('item 4: auction winner-exit envelope restore (both resolution paths)', () => {
  test('path A: advanceAuction in-rotation resolve (via placeBid)', async () => {
    const [c0, c1, c2] = makeSeatClients(3, {
      enforceSeats: true,
      patchG: (G) => {
        G.phase = 'play';
        // P1 and P2 pre-passed; only P0 (== currentPlayer, so no envelope is
        // needed for its OWN first action) is still active. When P0 bids,
        // advanceAuction's rotation skips both passed bidders and wraps
        // straight back to P0 itself -> resolves INSIDE advanceAuction.
        G.auction = {
          propertyId: 5, currentBid: 0, currentBidder: null,
          bidders: [
            { playerId: '0', passed: false },
            { playerId: '1', passed: true },
            { playerId: '2', passed: true },
          ],
          currentBidderIndex: 0,
        };
        return G;
      },
    });

    // Wrong-seat probe: an already-passed bidder is not on the clock either way.
    const before = snapshotG(c1);
    const wrongBid = await dispatchAndWait(c1, 'placeBid', 5);
    expect(wrongBid.G).toEqual(before);

    const resolved = await dispatchAndWait(c0, 'placeBid', 5);
    expect(resolved.G.auction).toBeNull();
    expect(resolved.G.ownership[5]).toBe('0');
    expect(resolved.G.players[0].money).toBe(1500 - 5);
    expect(resolved.ctx.activePlayers).toEqual({ '0': null });

    // currentPlayer (P0) can continue.
    const rollState = await dispatchAndWait(c0, 'rollDice');
    expect(rollState.G.hasRolled).toBe(true);
    void c2; // unused seat in this scenario, kept alive only to size the match at 3
  }, 15000);

  test('path B: passAuction own <=1-active resolve', async () => {
    const [c0, c1] = makeSeatClients(2, {
      enforceSeats: true,
      patchG: (G) => {
        G.phase = 'play';
        G.auction = {
          propertyId: 5, currentBid: 0, currentBidder: null,
          bidders: [{ playerId: '0', passed: false }, { playerId: '1', passed: false }],
          currentBidderIndex: 0,
        };
        return G;
      },
    });

    const bidState = await dispatchAndWait(c0, 'placeBid', 5);
    expect(bidState.G.auction.currentBid).toBe(5);
    expect(bidState.ctx.activePlayers).toEqual({ '1': null }); // real rotation opened P1's envelope

    // Wrong-seat probe: P0 (off the clock now) cannot act again.
    const before = snapshotG(c0);
    const wrongPass = await dispatchAndWait(c0, 'passAuction');
    expect(wrongPass.G).toEqual(before);

    const passState = await dispatchAndWait(c1, 'passAuction');
    expect(passState.G.auction).toBeNull();
    expect(passState.G.ownership[5]).toBe('0');
    expect(passState.ctx.activePlayers).toEqual({ '0': null });

    const rollState = await dispatchAndWait(c0, 'rollDice');
    expect(rollState.G.hasRolled).toBe(true);
  }, 15000);
});

// ---------------------------------------------------------------------------
// Item 5 — bankrupt high bidder never wins the auction. NOTE-ONLY per the
// handoff's own escape hatch ("if cheaply reachable ... else note the
// unit-tier coverage suffices"). See the describe block body for why it is NOT
// cheaply reachable here.
// ---------------------------------------------------------------------------
describe('item 5: bankrupt high bidder cannot win — note (unit-tier coverage suffices)', () => {
  test('documented: not exercised at the client-dispatch tier here', () => {
    // The only reachable path to "bankrupt while holding the standing high
    // bid" is useReroll's salary-REFUND branch (src/Game.js), which only fires
    // when `G.lastDice.salaryCollected > 0` — i.e., the player must have
    // actually PASSED GO on their most recent roll. Reaching that through a
    // REAL rollDice (patchG cannot set `G.lastDice`/`hasRolled` durably — see
    // seatClients.js's makeSeatClients header, onBegin resets them) requires
    // seeding a specific starting position near the board wrap AND a specific
    // dice total, entangling this authorization-matrix suite with an unrelated
    // bankruptcy/money invariant that:
    //   (a) is already covered by 2 dedicated, deterministic unit tests
    //       (src/__tests__/engine-seats-unit.test.js: "the STANDING HIGH BIDDER
    //       going bankrupt (not the acting bidder) cannot win the auction" and
    //       "resolveAuction refuses to award a bankrupt currentBidder even if
    //       the cleanup step is bypassed"), which directly invoke
    //       Monopoly.moves.useReroll/passAuction against a hand-built G and so
    //       can construct `lastDice.salaryCollected` directly without needing a
    //       real board-wrap roll;
    //   (b) is orthogonal to SEAT AUTHORIZATION specifically — the guard being
    //       exercised is a money/bankruptcy accounting invariant inside
    //       resolveAuction/handleBankruptcy, not a requireActor/isPlayerActive
    //       check, so a live two-client reproduction would not exercise any
    //       code path this suite's other 6 items don't already cover.
    // Judgment call, not an oversight — documented per the handoff's explicit
    // "else note" allowance.
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Item 6 — credentials trust boundary. Local() enforces playerID-based
// isPlayerActive membership; it never verifies `credentials` at all (see
// seatClients.js's header trace: LocalMaster never configures `auth`). This
// test proves exactly that boundary and documents what it does/doesn't prove.
// ---------------------------------------------------------------------------
describe('item 6: credentials trust boundary (Local() enforces playerID, NOT credentials)', () => {
  test('a client with garbage credentials still acts as whatever seat it claims; a wrong seat is still rejected regardless of credentials', async () => {
    const seatGame = buildSeatGame({
      enforceSeats: true,
      patchG: (G) => { G.phase = 'play'; return G; },
    });

    // "Rogue" claims seat 0 (the legitimate currentPlayer seat) with a
    // deliberately fabricated credential Local() never checks.
    const rogue = Client({
      game: seatGame, multiplayer: Local(), playerID: '0',
      credentials: 'totally-fabricated-not-a-real-credential',
      numPlayers: 2, debug: false,
    });
    rogue.start();
    // A second, legitimately-distinct seat with NO credentials supplied at all.
    const seat1 = Client({
      game: seatGame, multiplayer: Local(), playerID: '1',
      numPlayers: 2, debug: false,
    });
    seat1.start();

    // (a) Garbage credentials do not block seat-0 actions — proves Local()
    // performs zero credential verification.
    const rollState = await dispatchAndWait(rogue, 'rollDice');
    expect(rollState.G.hasRolled).toBe(true);

    // (b) The ONLY boundary enforced is playerID/isPlayerActive membership:
    // seat 1 (not currentPlayer, no envelope open) is rejected exactly as in
    // item 2's sweep, regardless of its (absent) credentials.
    const before = snapshotG(seat1);
    const wrongState = await dispatchAndWait(seat1, 'endTurn');
    expect(wrongState.G).toEqual(before);

    // WHAT THIS DOES NOT PROVE: that a real deployment is safe from seat
    // spoofing. Local() is an in-process test/dev transport with no network
    // boundary — "claiming playerID '0'" here is just a constructor argument,
    // not an authenticated handshake. Real credential AUTH lives in
    // SocketIOTransport + a server-side `auth.authenticateCredentials`
    // implementation (server.js / boardgame.io's server package), which this
    // test never touches. This test proves the CLIENT-VISIBLE contract: "if
    // you're not the active playerID, you're rejected" — it says nothing about
    // whether an attacker CAN legitimately obtain a given playerID's
    // credentials over the wire in the real deployed server.
  }, 15000);
});

// ---------------------------------------------------------------------------
// Item 7 — hot-seat inertness: a full scripted scenario WITHOUT enforceSeats
// (single client, matching every pre-Task-9 test in this suite), PLUS one
// explicit cross-seat-shaped action (acceptTrade from the single client, whose
// ctx.playerID never matches G.trade.targetPlayerId the way it would in a real
// multi-client match) to prove the new guards are true no-ops in hot-seat.
// ---------------------------------------------------------------------------
describe('item 7: hot-seat inertness (single client, enforceSeats false by default)', () => {
  test('acceptTrade succeeds from the single hot-seat client despite the cross-seat-shaped actor mismatch', () => {
    setActiveMap(loadMap(classicMapJson));
    // Real (unwrapped) Monopoly def, single client, no playerID, no multiplayer
    // transport — the exact shape every pre-existing hot-seat test in this repo
    // uses (src/__tests__/helpers/drive.js's makeClient, src/sim/match.js).
    // enforceSeats is false here simply because no setupData is ever supplied
    // (Monopoly.setup(ctx, setupData) -> `!!(setupData && setupData.enforceSeats)`).
    const seededGame = Object.assign({}, Monopoly, { seed: SEED_8 });
    const client = Client({ game: seededGame, numPlayers: 2, debug: false });
    client.start();

    expect(client.getState().G.enforceSeats).toBe(false);

    // Character selection first (G.phase starts 'characterSelect' — same as
    // any real game). Each selectCharacter call ends with ctx.events.endTurn(),
    // so after both seats pick, currentPlayer has cycled back to '0' — the
    // exact sequence the SEED 8 derivation script used (see header), so the
    // pinned seed still lands the first roll on Baltic Ave (total 3) here too.
    client.moves.selectCharacter('albert-victor');
    client.moves.selectCharacter('lia-startrace');
    expect(client.getState().G.phase).toBe('play');
    expect(client.getState().ctx.currentPlayer).toBe('0');

    // Synchronous dispatch + immediate getState() is valid for a single local
    // client (drive.js's own documented pattern) — no dispatchAndWait needed.
    client.moves.rollDice();
    expect(client.getState().G.lastDice.total).toBe(3); // same pinned seed, Baltic Ave
    expect(client.getState().G.canBuy).toBe(true);
    client.moves.buyProperty();
    expect(client.getState().G.ownership[3]).toBe('0');

    client.moves.proposeTrade(tradeProposal('1'));
    expect(client.getState().G.trade).not.toBeNull();

    // The cross-seat-shaped action: acceptTrade's "real" actor requirement is
    // G.trade.targetPlayerId ('1'), but this single hot-seat client's
    // ctx.playerID is always null/undefined for the whole session — exactly
    // the shape that would be rejected under enforceSeats (see item 1/3 above)
    // but must keep working unconditionally in hot-seat.
    client.moves.acceptTrade();
    expect(client.getState().G.trade).toBeNull();

    // Full turn keeps working normally afterward — inertness isn't a one-shot
    // fluke.
    client.moves.endTurn();
    expect(client.getState().ctx.currentPlayer).toBe('1');
  });
});
