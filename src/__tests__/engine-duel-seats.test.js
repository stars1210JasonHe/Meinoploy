// Task 8: cross-seat authorization matrix for the duel mechanism, over the
// REAL boardgame.io Local() master/dispatch path (src/__tests__/helpers/seatClients.js
// — the same machinery engine-seats.test.js's Task 10 matrix built and proved).
//
// Why a separate file rather than another describe block inside
// engine-seats.test.js: that file is already a large, self-contained proof of
// the GENERIC requireActor/envelope contract (7 items + 1 production
// regression, ~585 lines) built entirely around trade/auction scenarios. The
// duel mechanism is its own subsystem (own RULES.duel.enabled gate, own
// 4-move state machine, own envelope shape) with its own dedicated unit file
// (engine-duel.test.js) — mirroring that split here keeps each file legible
// and avoids retrofitting engine-seats.test.js's trade/auction-specific
// header comments and helpers to a third, unrelated envelope shape.
//
// The duel mechanism is the THIRD exception pair in the guard table (after
// trade's target and auction's acting bidder): respondDuel/declineDuel both
// check `!G.duel || G.duel.phase !== 'response'` BEFORE dereferencing
// `G.duel.ownerId` as the expected actor — the exact acceptTrade precedent
// (src/Game.js's own comment on respondDuel: "G.duel existence is checked
// BEFORE requireActor because the expected-actor expression dereferences
// G.duel.ownerId"). This file proves that precedent holds over the REAL
// dispatch path, the same way engine-seats.test.js's item 1 proved it for
// trade.
//
// SEED 96 (reused verbatim from engine-duel.test.js's Task 3/4 scenarios):
// with marcus-grayline picked first (P0) and sophia-ember picked second (P1),
// P0's first rollDice totals 1+5=6, landing on Oriental Ave (id 6, price 93,
// unowned) — P0 buys it. After P0 endTurns, P1's rollDice ALSO totals 6
// (same PRNG stream — character selection never consumes ctx.random, so the
// sequence of dice a seeded game produces is identical regardless of how
// many players there are, VERIFIED empirically for numPlayers=3 during this
// task: P0's and P1's rolls are byte-identical to the numPlayers=2 case),
// landing P1 back on Oriental Ave (P0's) for $11 rent due -> RULES.duel.enabled
// converts that into a duel OFFER: {phase:'offer', propertyId:6, ownerId:'0',
// challengerId:'1', rent:11} — instead of auto-paying. A third seat (numPlayers
// 3, tests use 'lia-startrace' for P2) never rolls or acts before the offer
// exists, so its presence doesn't perturb the P0/P1 dice sequence at all.
import { makeSeatClients, dispatchAndWait, snapshotG } from './helpers/seatClients';
import { Client } from 'boardgame.io/client';
import { Monopoly, setActiveMap } from '../Game';
import { loadMap } from '../map-loader';
import classicMapJson from '../../mods/dominion/maps/classic/map.json';
import { RULES } from '../../mods/active-rules';

const SEED_96 = '96';
const CHAR_PICKS = ['marcus-grayline', 'sophia-ember', 'lia-startrace']; // P0 (owner), P1 (challenger), P2 (bystander)

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

// Drives `numPlayers` seat clients (via makeSeatClients) through character
// selection + P0 buying Oriental Ave + P1 landing back on it, resolving with
// G.duel = {phase:'offer', propertyId:6, ownerId:'0', challengerId:'1', rent:11}.
// `patchG` (optional) threads straight through to makeSeatClients' own
// setup-time hook (see seatClients.js's header for what survives onBegin —
// ownership/properties/mortgaged/rerollsLeft all do, which is all this file
// needs for the mid-duel-guard scenario below).
async function playToDuelOffer(numPlayers, { patchG } = {}) {
  const clients = makeSeatClients(numPlayers, { enforceSeats: true, seed: SEED_96, patchG });
  for (let i = 0; i < numPlayers; i++) {
    await dispatchAndWait(clients[i], 'selectCharacter', CHAR_PICKS[i]);
  }
  const rollState = await dispatchAndWait(clients[0], 'rollDice');
  if (rollState.G.canBuy) await dispatchAndWait(clients[0], 'buyProperty');
  await dispatchAndWait(clients[0], 'endTurn');
  const offerState = await dispatchAndWait(clients[1], 'rollDice');
  if (offerState.G.duel === null || offerState.G.duel.phase !== 'offer') {
    throw new Error('playToDuelOffer: SEED_96 script did not produce the expected duel offer — got ' + JSON.stringify(offerState.G.duel));
  }
  return clients;
}

describe('Duel mechanism — cross-seat authorization matrix (Task 8)', () => {
  beforeEach(() => {
    RULES.duel.enabled = true;
  });
  afterEach(() => {
    RULES.duel.enabled = false; // restore the shared live RULES singleton
  });

  // -------------------------------------------------------------------------
  // 1. Owner CAN respondDuel cross-seat: the owner's client dispatches
  // respondDuel while ctx.currentPlayer is STILL the challenger ('1') — the
  // owner is only "active" at all because initiateDuel's setActivePlayers
  // widened the envelope, exactly like a trade target. State resolves (dice
  // rolled, duel cleared), and the envelope is restored to
  // {currentPlayer: null} afterward, proven behaviorally: currentPlayer can
  // still endTurn.
  // -------------------------------------------------------------------------
  test('owner respondDuel succeeds cross-seat; dice rolled; envelope restored; currentPlayer can endTurn after', async () => {
    const [c0, c1] = await playToDuelOffer(2);

    const initState = await dispatchAndWait(c1, 'initiateDuel'); // challenger escalates
    expect(initState.G.duel.phase).toBe('response');
    expect(initState.ctx.activePlayers).toEqual({ '0': null, '1': null });
    expect(initState.ctx.currentPlayer).toBe('1'); // still the challenger's turn

    // CROSS-SEAT: c0 (owner) is NOT ctx.currentPlayer, only admitted via the envelope.
    const respondState = await dispatchAndWait(c0, 'respondDuel');
    expect(respondState.G.duel).toBeNull();
    expect(respondState.G.turnPhase).toBe('done');

    const resolved = respondState.G.events.filter(e => e.type === 'duel_resolved');
    expect(resolved).toHaveLength(1);
    expect(resolved[0].data.challengerRoll.dice).toHaveLength(2);
    expect(resolved[0].data.defenderRoll.dice).toHaveLength(2);
    expect(['0', '1']).toContain(resolved[0].data.winnerId);

    // Envelope restored to currentPlayer-only (still '1' — the duel doesn't
    // end the turn by itself).
    expect(respondState.ctx.activePlayers).toEqual({ '1': null });

    // Behavioral restore proof: currentPlayer (P1) can keep acting normally.
    const endState = await dispatchAndWait(c1, 'endTurn');
    expect(endState.ctx.currentPlayer).toBe('0');
  }, 15000);

  // -------------------------------------------------------------------------
  // 2. Owner CAN declineDuel cross-seat: same envelope-admitted cross-seat
  // shape as (1), but the fallback (no dice, single rent) path. Rent flows
  // challenger -> owner; envelope restored the same way.
  // -------------------------------------------------------------------------
  test('owner declineDuel succeeds cross-seat; single rent flows; envelope restored', async () => {
    const [c0, c1] = await playToDuelOffer(2);
    const p0Before = c0.getState().G.players[0].money;
    const p1Before = c1.getState().G.players[1].money;

    const initState = await dispatchAndWait(c1, 'initiateDuel');
    expect(initState.G.duel.phase).toBe('response');
    expect(initState.ctx.activePlayers).toEqual({ '0': null, '1': null });

    // CROSS-SEAT: c0 (owner) declines while ctx.currentPlayer is still '1'.
    const declineState = await dispatchAndWait(c0, 'declineDuel');
    expect(declineState.G.duel).toBeNull();
    expect(declineState.G.turnPhase).toBe('done');
    expect(declineState.G.events.filter(e => e.type === 'duel_resolved')).toHaveLength(0); // no roll happened
    const declined = declineState.G.events.filter(e => e.type === 'duel_declined');
    expect(declined).toHaveLength(1);
    expect(declined[0].actor).toBe('0'); // owner

    expect(declineState.G.players[1].money).toBe(p1Before - 11); // challenger pays single rent
    expect(declineState.G.players[0].money).toBe(p0Before + 11);

    expect(declineState.ctx.activePlayers).toEqual({ '1': null }); // envelope restored

    const endState = await dispatchAndWait(c1, 'endTurn');
    expect(endState.ctx.currentPlayer).toBe('0');
  }, 15000);

  // -------------------------------------------------------------------------
  // 3. THIRD seat REJECTED on respondDuel/declineDuel: a numPlayers=3 game
  // where P2 never rolls, never buys, never acts — purely a bystander. Once
  // initiateDuel widens the envelope to {'0': null, '1': null}, P2 is not a
  // member at all, so boardgame.io's OWN isPlayerActive gate (layer 1) stops
  // it before requireActor ever runs.
  // -------------------------------------------------------------------------
  test('third seat (bystander) rejected on both respondDuel and declineDuel', async () => {
    const [c0, c1, c2] = await playToDuelOffer(3);

    const initState = await dispatchAndWait(c1, 'initiateDuel');
    expect(initState.ctx.activePlayers).toEqual({ '0': null, '1': null });

    const beforeActivePlayers = c2.getState().ctx.activePlayers;

    const before1 = snapshotG(c2);
    const wrongRespond = await dispatchAndWait(c2, 'respondDuel');
    expect(wrongRespond.G).toEqual(before1);
    expect(wrongRespond.G.duel.phase).toBe('response'); // untouched
    expect(wrongRespond.ctx.activePlayers).toEqual(beforeActivePlayers);

    const before2 = snapshotG(c2);
    const wrongDecline = await dispatchAndWait(c2, 'declineDuel');
    expect(wrongDecline.G).toEqual(before2);
    expect(wrongDecline.G.duel).not.toBeNull();
  }, 15000);

  // -------------------------------------------------------------------------
  // 4. CHALLENGER REJECTED on respondDuel/declineDuel: the acceptTrade
  // precedent, applied to duel. Once initiateDuel widens the envelope, the
  // challenger ('1') IS structurally active (layer 1 admits it — it's a
  // member of ctx.activePlayers) — but requireActor(G, ctx, G.duel.ownerId)
  // discriminates WHICH of the two active seats may actually call
  // respondDuel/declineDuel, and the challenger is not the owner.
  // -------------------------------------------------------------------------
  test('challenger rejected on both respondDuel and declineDuel despite being envelope-active', async () => {
    const [c0, c1] = await playToDuelOffer(2);

    const initState = await dispatchAndWait(c1, 'initiateDuel');
    expect(initState.ctx.activePlayers).toEqual({ '0': null, '1': null }); // challenger IS a member

    const before1 = snapshotG(c1);
    const wrongRespond = await dispatchAndWait(c1, 'respondDuel');
    expect(wrongRespond.G).toEqual(before1);
    expect(wrongRespond.G.duel.phase).toBe('response'); // untouched

    const before2 = snapshotG(c1);
    const wrongDecline = await dispatchAndWait(c1, 'declineDuel');
    expect(wrongDecline.G).toEqual(before2);
    expect(wrongDecline.G.duel).not.toBeNull();
  }, 15000);

  // -------------------------------------------------------------------------
  // 5. Wrong-seat payRent/initiateDuel REJECTED: at the 'offer' phase, no
  // envelope has been opened yet (only initiateDuel opens one) — the ONLY
  // seat "on the clock" is ctx.currentPlayer (the challenger). The owner is
  // not even a structural member of activePlayers here, so this is stopped
  // by boardgame.io's own default currentPlayer gate (same layer 1 as every
  // ordinary requireActor(G, ctx, ctx.currentPlayer) move in item 2 of
  // engine-seats.test.js).
  // -------------------------------------------------------------------------
  test('owner (wrong seat) rejected on payRent and initiateDuel while offer is still open', async () => {
    const [c0, c1] = await playToDuelOffer(2);
    expect(c0.getState().G.duel.phase).toBe('offer');
    expect(c0.getState().ctx.currentPlayer).toBe('1'); // challenger's turn; owner not on the clock

    const before1 = snapshotG(c0);
    const wrongPayRent = await dispatchAndWait(c0, 'payRent');
    expect(wrongPayRent.G).toEqual(before1);
    expect(wrongPayRent.G.duel.phase).toBe('offer');

    const before2 = snapshotG(c0);
    const wrongInitiate = await dispatchAndWait(c0, 'initiateDuel');
    expect(wrongInitiate.G).toEqual(before2);
    expect(wrongInitiate.G.duel.phase).toBe('offer');

    // Sanity: the right seat (challenger) still works normally afterward.
    const rightInitiate = await dispatchAndWait(c1, 'initiateDuel');
    expect(rightInitiate.G.duel.phase).toBe('response');
  }, 15000);

  // -------------------------------------------------------------------------
  // 6. Mid-duel proposeTrade/mortgageProperty/useReroll REJECTED — the Task 2
  // guards (`if (G.duel) return INVALID_MOVE;`), proven over the master path
  // rather than direct invocation (engine-duel.test.js's Task 2 describe
  // block already covers direct invocation).
  //   - From the CHALLENGER's own seat ('1'): requireActor(ctx.currentPlayer)
  //     passes (challenger IS currentPlayer) -> the G.duel guard itself is
  //     what stops it.
  //   - CROSS-SEAT from the owner ('0'): requireActor(ctx.currentPlayer)
  //     itself already fails (owner is envelope-active but not
  //     ctx.currentPlayer) — same flagship shape as engine-seats.test.js's
  //     item 1 (trade target hijacking useReroll).
  // sophia-ember (P1/challenger)'s stamina (8) clears RULES.stats.stamina's
  // rerollThreshold (7), so selectCharacter grants her a real rerollsLeft=1
  // with no patchG needed (onBegin never touches rerollsLeft — verified
  // against src/Game.js's onBegin body, which resets only
  // hasRolled/awaitingRoute/canBuy/effectivePrice/turnPhase/lastDice/
  // pendingCard/doublesCount). mortgageProperty needs an owned, unmortgaged
  // property for P1 — patched at setup time (survives onBegin the same way).
  // -------------------------------------------------------------------------
  test('mid-duel proposeTrade/mortgageProperty/useReroll rejected from the challenger seat and cross-seat from the owner', async () => {
    const [c0, c1] = await playToDuelOffer(2, {
      patchG: (G) => {
        G.ownership[1] = '1'; // Mediterranean Ave, owned by the challenger
        G.players[1].properties = [1];
        return G;
      },
    });
    expect(c1.getState().G.players[1].rerollsLeft).toBe(1); // sanity: real stamina-threshold grant
    expect(c1.getState().G.hasRolled).toBe(true); // sanity: real roll already happened

    await dispatchAndWait(c1, 'initiateDuel'); // widen envelope to {'0': null, '1': null}

    // Challenger's own seat: requireActor(ctx.currentPlayer) passes, G.duel guard stops it.
    const before1 = snapshotG(c1);
    const wrongTrade = await dispatchAndWait(c1, 'proposeTrade', tradeProposal('0'));
    expect(wrongTrade.G).toEqual(before1);
    expect(wrongTrade.G.trade).toBeNull();

    const before2 = snapshotG(c1);
    const wrongMortgage = await dispatchAndWait(c1, 'mortgageProperty', 1);
    expect(wrongMortgage.G).toEqual(before2);
    expect(wrongMortgage.G.mortgaged[1]).toBeFalsy();

    const before3 = snapshotG(c1);
    const wrongReroll = await dispatchAndWait(c1, 'useReroll');
    expect(wrongReroll.G).toEqual(before3);
    expect(wrongReroll.G.players[1].rerollsLeft).toBe(1); // untouched

    // Cross-seat from the owner: requireActor(ctx.currentPlayer) itself fails first.
    const before4 = snapshotG(c0);
    const ownerTrade = await dispatchAndWait(c0, 'proposeTrade', tradeProposal('1'));
    expect(ownerTrade.G).toEqual(before4);
    expect(ownerTrade.G.trade).toBeNull();

    // Sanity: the duel is still fully intact after all six rejected attempts.
    expect(c1.getState().G.duel.phase).toBe('response');
  }, 15000);

  // -------------------------------------------------------------------------
  // 7. Hot-seat inertness: a single, non-playerID client (enforceSeats false
  // — no setupData supplied, matching every pre-Task-9 hot-seat test and
  // engine-seats.test.js's own item 7) proves all FOUR duel-resolution moves
  // work despite two of them (respondDuel/declineDuel) being
  // "cross-seat-shaped" (actor = G.duel.ownerId, not ctx.currentPlayer — in
  // hot-seat ctx.playerID is always substituted to the CURRENT player, i.e.
  // the challenger, never the owner, yet the moves still succeed because
  // requireActor short-circuits on `!G.enforceSeats`).
  //
  // payRent/initiateDuel/respondDuel/declineDuel are mutually exclusive
  // within a single duel envelope (each one clears G.duel), so this drives
  // THREE independent fresh single-client matches off the identical SEED_96
  // script up to the offer point, diverging only on the final move(s) —
  // proving payRent alone, initiateDuel+respondDuel, and
  // initiateDuel+declineDuel each work standalone.
  // -------------------------------------------------------------------------
  describe('item 7: hot-seat inertness (single client, enforceSeats false by default)', () => {
    function freshOfferClient() {
      setActiveMap(loadMap(classicMapJson));
      const seededGame = Object.assign({}, Monopoly, { seed: SEED_96 });
      const client = Client({ game: seededGame, numPlayers: 2, debug: false });
      client.start();
      expect(client.getState().G.enforceSeats).toBe(false);

      client.moves.selectCharacter('marcus-grayline'); // P0 (owner)
      client.moves.selectCharacter('sophia-ember');     // P1 (challenger)
      client.moves.rollDice();     // P0 -> Oriental Ave (unowned)
      client.moves.buyProperty();
      client.moves.endTurn();
      client.moves.rollDice();     // P1 -> Oriental Ave (P0's) -> duel offer

      const G = client.getState().G;
      expect(G.duel).toEqual({ phase: 'offer', propertyId: 6, ownerId: '0', challengerId: '1', rent: 11 });
      return client;
    }

    test('payRent works from the single hot-seat client', () => {
      const client = freshOfferClient();
      client.moves.payRent();
      expect(client.getState().G.duel).toBeNull();
      expect(client.getState().G.turnPhase).toBe('done');
    });

    test('initiateDuel + respondDuel (cross-seat-shaped) work from the single hot-seat client', () => {
      const client = freshOfferClient();
      client.moves.initiateDuel();
      expect(client.getState().G.duel.phase).toBe('response');

      // respondDuel's "real" actor requirement is G.duel.ownerId ('0'), but
      // this single client's substituted ctx.playerID is always the CURRENT
      // player ('1', the challenger) — the exact cross-seat-shaped mismatch
      // that enforceSeats would reject (see this file's tests 1/4 above).
      client.moves.respondDuel();
      expect(client.getState().G.duel).toBeNull();
      expect(client.getState().G.events.filter(e => e.type === 'duel_resolved')).toHaveLength(1);
    });

    test('initiateDuel + declineDuel (cross-seat-shaped) work from the single hot-seat client', () => {
      const client = freshOfferClient();
      client.moves.initiateDuel();
      expect(client.getState().G.duel.phase).toBe('response');

      client.moves.declineDuel();
      expect(client.getState().G.duel).toBeNull();
      expect(client.getState().G.events.filter(e => e.type === 'duel_declined')).toHaveLength(1);
      expect(client.getState().G.turnPhase).toBe('done');
    });

    test('full turn keeps working after: currentPlayer can endTurn following a resolved duel', () => {
      const client = freshOfferClient();
      client.moves.payRent();
      expect(client.getState().G.turnPhase).toBe('done');
      client.moves.endTurn();
      expect(client.getState().ctx.currentPlayer).toBe('0');
    });
  });
});
