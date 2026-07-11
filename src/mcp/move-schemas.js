// Per-move arg validation + decision correlation + attribution signatures
// (spec §1 tool 7 layers 1-2 and 4). Pure module: no engine imports beyond
// nothing at all — Task 7/9 own the G-coupled logic; this file is data + zod.
import { z } from 'zod';

const NO_ARGS = z.tuple([]);
const PROPERTY_ID = z.number().int().nonnegative();
const ROUTE = z.array(z.number().int().nonnegative()); // list of space ids
const optionalRoute = z.union([z.tuple([]), z.tuple([ROUTE])]);

// Schemas validate the ARGS ARRAY (what spreads into client.moves[name](...args)).
export const MOVE_SCHEMAS = {
  selectCharacter: z.tuple([z.string().min(1)]),
  rollDice: optionalRoute,
  rollOnly: NO_ARGS, // round-3 pin: rollOnly's engine signature takes NO route
  commitRoute: z.union([z.tuple([]), z.tuple([ROUTE])]), // engine auto-routes when omitted
  useReroll: NO_ARGS,
  acceptCard: NO_ARGS,
  redrawCard: NO_ARGS,
  regulateProperty: z.tuple([PROPERTY_ID]),
  upgradeProperty: z.tuple([PROPERTY_ID]),
  mortgageProperty: z.tuple([PROPERTY_ID]),
  unmortgageProperty: z.tuple([PROPERTY_ID]),
  sellBuilding: z.tuple([PROPERTY_ID]),
  buyProperty: NO_ARGS,
  passProperty: NO_ARGS,
  payJailFine: NO_ARGS,
  proposeTrade: z.tuple([z.object({
    targetPlayerId: z.string().min(1),
    offeredProperties: z.array(PROPERTY_ID).optional(),
    requestedProperties: z.array(PROPERTY_ID).optional(),
    offeredMoney: z.number().int().nonnegative().optional(),
    requestedMoney: z.number().int().nonnegative().optional(),
  }).strict()]),
  acceptTrade: NO_ARGS,
  rejectTrade: NO_ARGS,
  cancelTrade: NO_ARGS,
  placeBid: z.tuple([z.number().int().positive()]),
  passAuction: NO_ARGS,
  payRent: NO_ARGS,
  initiateDuel: NO_ARGS,
  respondDuel: NO_ARGS,
  declineDuel: NO_ARGS,
  endTurn: NO_ARGS,
};

// The six cross-seat/slot-addressed response moves (spec §1 tool 7.2):
// expect:{decisionSeq} is REQUIRED for these — presence/shape validated at
// layer 1 (tool error), VALUE compared at layer 2 (stale-decision).
export const EXPECT_REQUIRED = new Set([
  'placeBid', 'passAuction', 'acceptTrade', 'rejectTrade', 'respondDuel', 'declineDuel',
]);

const OPENING_EVENT = { auction: 'auction_started', trade: 'trade_proposed', duel: 'duel_offered' };

// Seq of the event that OPENED the currently-active decision (latest opening
// event of the active type). null = no decision open, or the opening event has
// been front-trimmed out of the 200-cap log — callers FAIL CLOSED on null.
export function decisionSeq(G) {
  let type = null;
  if (G.auction) type = OPENING_EVENT.auction;
  else if (G.trade) type = OPENING_EVENT.trade;
  else if (G.duel) type = OPENING_EVENT.duel;
  if (!type) return null;
  for (let i = G.events.length - 1; i >= 0; i--) {
    if (G.events[i].type === type) return G.events[i].seq;
  }
  return null;
}

// Default one-event-actor'd-to-caller signatures. Only entries whose event
// type ISN'T simply "the move's own event with actor = caller" need thought;
// the full logEvent-actor vs requireActor-gate sweep (review rounds 3-4)
// found exactly TWO non-default cases: respondDuel and acceptTrade's stale
// branch. endTurn logs NO event (ctx-delta attribution -> null here).
const DEFAULT_SIGNATURE_EVENT = {
  selectCharacter: 'character_selected',
  rollDice: 'dice_rolled',
  rollOnly: 'dice_rolled',
  commitRoute: 'moved', // engine emits 'moved' via performMove — 'route_committed' is a reserved type that is NEVER logged
  useReroll: 'reroll_used',
  acceptCard: 'card_applied',
  redrawCard: 'card_redrawn',
  regulateProperty: 'property_regulated',
  upgradeProperty: 'property_upgraded',
  mortgageProperty: 'property_mortgaged',
  unmortgageProperty: 'property_unmortgaged',
  sellBuilding: 'building_sold',
  buyProperty: 'property_bought',
  passProperty: 'property_passed',
  payJailFine: 'jail_fine_paid',
  proposeTrade: 'trade_proposed',
  rejectTrade: 'trade_rejected',
  cancelTrade: 'trade_cancelled',
  placeBid: 'bid_placed',
  passAuction: 'auction_passed',
  payRent: 'rent_paid',
  initiateDuel: 'duel_initiated',
  declineDuel: 'duel_declined',
};

// -> [{type, actor, result}] acceptable outcomes, or null (signature-less).
export function moveSignature(move, preG, seat) {
  if (move === 'endTurn') return null;
  if (move === 'respondDuel') {
    // Called by the OWNER; the event is narrative-actor'd to the CHALLENGER
    // (round-3 Critical — a yourSeat rule would 100% false-negative).
    return [{ type: 'duel_resolved', actor: preG.duel ? preG.duel.challengerId : seat, result: 'accepted' }];
  }
  if (move === 'acceptTrade') {
    // Success OR the staleTrade auto-cancel branch (round-4 Critical): drift
    // since propose -> trade_cancelled actor'd to the PROPOSER, reason 'stale'.
    const proposer = preG.trade ? preG.trade.proposerId : null;
    return [
      { type: 'trade_accepted', actor: seat, result: 'accepted' },
      { type: 'trade_cancelled', actor: proposer, result: 'stale-trade' },
    ];
  }
  if (move === 'passProperty') {
    return [
      { type: 'property_passed', actor: seat, result: 'accepted' },
      { type: 'auction_started', actor: null, result: 'accepted' }, // pass triggered an auction
    ];
  }
  const type = DEFAULT_SIGNATURE_EVENT[move];
  if (!type) return null;
  return [{ type, actor: seat, result: 'accepted' }];
}
