// getLegalMoves(G, ctx, seat) — hand-mirrored eligibility for every engine
// move (spec §3). NOT try-dispatch. The drift test is the completeness
// oracle: listed <=> dispatch accepts. Mirror the guards in src/Game.js's
// move bodies EXACTLY — including quirks confirmed by reading Game.js (not
// assumed from the task sketch):
//   - mortgage/unmortgage/regulateProperty are NOT gated by G.hasRolled.
//   - upgradeProperty/sellBuilding ARE gated by G.hasRolled.
//   - mortgage/unmortgage/upgrade/sellBuilding/regulateProperty/useReroll are
//     NOT gated by G.auction or G.trade at all (only G.duel blocks them) —
//     Game.js's mortgageProperty/unmortgageProperty/upgradeProperty/
//     sellBuilding/regulateProperty/useReroll bodies never read G.auction or
//     G.trade. Only placeBid/passAuction/proposeTrade/endTurn explicitly
//     check G.auction; only acceptTrade/rejectTrade/cancelTrade/proposeTrade/
//     endTurn explicitly check G.trade.
//   - rollDice and rollOnly are BOTH genuinely dispatchable regardless of
//     G.board.movementMode (rollDice auto-routes on atlas when route is
//     omitted; rollOnly skips straight to performMove on loop maps) — list
//     both, don't pick one by movementMode.
//   - G.turnPhase is write-only in Game.js (never read as a guard by any
//     move) — it must never be used as an eligibility condition here.
//
// The six cross-seat response moves (acceptTrade/rejectTrade, placeBid/
// passAuction, respondDuel/declineDuel) are gated in Game.js by
// requireActor(G, ctx, expectedId) = `!G.enforceSeats || ctx.playerID ===
// String(expectedId)`. This is NOT the same as `seat === expectedId`: when
// G.enforceSeats is false (hot-seat — confirmed by reading client.ts's
// assumedPlayerID, which substitutes ctx.currentPlayer for any playerID-less
// dispatch, combined with flow.ts's IsPlayerActive gate, which then compares
// ctx.currentPlayer against itself), requireActor is PROVABLY inert — ANY
// seat that clears the outer canAct gate can actually dispatch these moves
// in hot-seat play (verified empirically: a hot-seat auction where
// ctx.currentPlayer isn't the on-the-clock bidder still accepts passAuction/
// placeBid dispatched "as" ctx.currentPlayer, because the move body reads
// the real bidder off G.auction itself, not off ctx.playerID). actorMatches
// below mirrors requireActor's exact formula rather than hardcoding
// `seat === expectedId`, so the drift test (which always audits
// seat === ctx.currentPlayer against a plain hot-seat client, G.enforceSeats
// always false there) agrees with real dispatch, while the strict per-seat
// restriction still applies whenever G.enforceSeats is true (the online/MCP
// case the targeted unit tests exercise via a mocked ctx.activePlayers).
import { RULES } from '../../mods/active-rules';
import { MODS } from '../../mods/index';
import { isDuelCooldownBlocked } from '../events';
import { getUpgradeCost } from '../Game';
import { routeChoices } from '../atlas-movement';
import { canAct, isMerchant } from './view';
import { decisionSeq, EXPECT_REQUIRED } from './move-schemas';

// Mirrors Game.js's (unexported) groupKeyOf exactly (Game.js:210).
function groupKeyOf(space) {
  return space.placeId || space.color;
}

function ownsColorGroup(G, seat, gk) {
  const ids = G.board.colorGroups[gk];
  return !!ids && ids.every(id => G.ownership[id] === seat);
}

// Mirrors Game.js's requireActor exactly (Game.js:159-161) — see file header.
function actorMatches(G, seat, expectedId) {
  return !G.enforceSeats || seat === String(expectedId);
}

function spaceName(G, id) {
  const s = G.board.spaces[id];
  return s ? s.name : `#${id}`;
}

// Local mirror of Game.js's getCurrentSeason (Game.js:256-258, not exported).
function getCurrentSeason(G) {
  return RULES.seasons.list[G.seasonIndex];
}

// Local mirror of Game.js's applyEconMods for kind:'price' ONLY (Game.js:
// 262-275, not exported) — the one branch mortgage/unmortgage math needs.
// upgrade-cost math instead reuses the REAL exported getUpgradeCost (which
// internally calls the real applyEconMods for kind:'upgrade'), so this local
// copy never needs to cover that branch.
function applyPriceEconMods(G, value) {
  const season = getCurrentSeason(G);
  const mech = G.board.mapMechanics || {};
  const mechMod = mech.priceMultiplier === undefined ? 1 : mech.priceMultiplier;
  return value * season.priceMod * mechMod;
}

function routeHint(G, p) {
  // Spec §3 pin: enumerate route choices via the SAME pure atlas-movement
  // helper the UI uses. Real signature (atlas-movement.js:76):
  // routeChoices(edges, start, steps, cap). App.js's call site (App.js:743):
  // routeChoices(G.board.edges, player.position, G.lastDice.total).
  // Wrapped in try/catch: a hint failure must NEVER make commitRoute
  // un-listable — commitRoute with no args auto-routes and is always
  // dispatchable once G.awaitingRoute is true.
  let routes = null;
  try {
    const total = G.lastDice ? G.lastDice.total : null;
    if (G.board.edges && total != null) {
      routes = routeChoices(G.board.edges, p.position, total);
    }
  } catch (e) {
    routes = null;
  }
  return { routes, rolledTotal: G.lastDice ? G.lastDice.total : null, note: 'omit route to auto-route' };
}

// Mirrors mortgageProperty/unmortgageProperty/upgradeProperty/sellBuilding/
// regulateProperty (Game.js:1451-1581) EXACTLY, guard-by-guard. NOT nested
// under any G.hasRolled/G.auction/G.trade/G.pendingCard/G.awaitingRoute
// condition at the call site — each of those guards (or their absence) is
// reproduced HERE, individually, per move, matching what Game.js actually
// checks (see file header for the auction/trade-independence quirk).
function pushAssetMoves(out, G, seat, p) {
  const upgradable = [], mortgageable = [], unmortgageable = [], sellable = [];
  for (const space of G.board.spaces) {
    if (G.ownership[space.id] !== seat) continue;
    const level = G.buildings[space.id] || 0;
    const gk = groupKeyOf(space);

    // mortgageProperty (Game.js:1500-1527): no buildings on this space, and
    // no buildings anywhere in its group. NOT gated by G.hasRolled.
    if (!G.mortgaged[space.id] && level === 0) {
      const groupHasBuildings = gk && G.board.colorGroups[gk]
        ? G.board.colorGroups[gk].some(id => (G.buildings[id] || 0) > 0)
        : false;
      if (!groupHasBuildings) mortgageable.push(space.id);
    }

    // unmortgageProperty (Game.js:1529-1547): NOT gated by G.hasRolled.
    if (G.mortgaged[space.id]) {
      const cost = Math.floor(applyPriceEconMods(G, space.price * RULES.core.unmortgageRate));
      if (p.money >= cost) unmortgageable.push(space.id);
    }

    if (space.type === 'property') {
      // upgradeProperty (Game.js:1466-1498): requires G.hasRolled, full
      // group ownership, no mortgages in group, below max level, even-build
      // (at the group minimum), and affordable.
      if (G.hasRolled && gk && ownsColorGroup(G, seat, gk)) {
        const groupIds = G.board.colorGroups[gk];
        const noMortgages = !groupIds.some(id => G.mortgaged[id]);
        const minLevel = Math.min(...groupIds.map(id => G.buildings[id] || 0));
        if (noMortgages && level < RULES.core.maxBuildingLevel && level <= minLevel) {
          const cost = getUpgradeCost(G, p, space, level + 1);
          if (p.money >= cost) upgradable.push(space.id);
        }
      }
      // sellBuilding (Game.js:1549-1581): requires G.hasRolled, has a
      // building, and is at (or above, can't happen) the group's max level
      // (even-sell-down); ungrouped properties are trivially "at max".
      if (G.hasRolled && level > 0) {
        const groupIds = gk && G.board.colorGroups[gk];
        const maxLevel = groupIds ? Math.max(...groupIds.map(id => G.buildings[id] || 0)) : level;
        if (level >= maxLevel) sellable.push(space.id);
      }
    }
  }
  if (upgradable.length) out.push({ move: 'upgradeProperty', argsHint: { propertyIds: upgradable }, description: 'Build on a completed color group.' });
  if (mortgageable.length) out.push({ move: 'mortgageProperty', argsHint: { propertyIds: mortgageable }, description: 'Mortgage a property for cash.' });
  if (unmortgageable.length) out.push({ move: 'unmortgageProperty', argsHint: { propertyIds: unmortgageable }, description: 'Unmortgage a property.' });
  if (sellable.length) out.push({ move: 'sellBuilding', argsHint: { propertyIds: sellable }, description: 'Sell a building back.' });

  // regulateProperty (Game.js:1451-1463): enforcer passive only, ANY owned
  // space (no G.hasRolled gate; Game.js unconditionally overwrites
  // player.regulatedProperty with no "already regulated" exclusion).
  if (p.character && p.character.passive && p.character.passive.id === 'enforcer') {
    const owned = G.board.spaces.filter(s => G.ownership[s.id] === seat).map(s => s.id);
    if (owned.length) out.push({ move: 'regulateProperty', argsHint: { propertyIds: owned }, description: 'Regulate one owned property (enforcer passive).' });
  }
}

export function getLegalMoves(G, ctx, seat) {
  seat = String(seat);
  if (ctx.gameover) return [];
  if (!canAct(ctx, seat)) return []; // bgio layer-1: nothing is dispatchable
  const p = G.players[Number(seat)];
  if (!p) return [];
  const out = [];
  const isCurrent = ctx.currentPlayer === seat;
  const dSeq = decisionSeq(G);
  const expectFor = (move) => (EXPECT_REQUIRED.has(move) && dSeq !== null) ? { decisionSeq: dSeq } : undefined;
  // Fail-closed listability (fix wave): a response move in EXPECT_REQUIRED
  // with dSeq === null means the decision's opening event was front-trimmed
  // out of the capped log — expectFor(move) would return undefined, but
  // make_move's layer 1 hard-errors "expect.decisionSeq is REQUIRED" (there is
  // nothing to echo) and layer 2 fails closed to stale-decision for ANY
  // supplied value. Listing the move here would be a dead end for the caller,
  // so it must not be listed at all — mirrors make_move's own fail-closed
  // behavior instead of contradicting it.
  const listable = (move) => !(EXPECT_REQUIRED.has(move) && dSeq === null);

  // --- characterSelect phase ---
  if (G.phase === 'characterSelect') {
    if (isCurrent && !p.character) {
      const modId = G.activeModId || 'dominion';
      const roster = (MODS[modId] || MODS.dominion).characters;
      const taken = new Set(G.players.filter(q => q.character).map(q => q.character.id));
      out.push({
        move: 'selectCharacter',
        argsHint: { characterIds: roster.map(c => c.id).filter(id => !taken.has(id)) },
        description: 'Pick your character for this match.',
      });
    }
    return out;
  }

  // --- G.duel blocks literally every other move (verified move-by-move
  // against Game.js: every move besides the duel quartet either explicitly
  // checks `if (G.duel) return INVALID_MOVE`, or requires a state that can't
  // structurally coexist with a pending duel in a rest state — e.g.
  // G.canBuy/G.pendingCard/G.auction/G.trade can't be set at the same time
  // as G.duel, since a duel is only offered on a rent-due landing, which is
  // mutually exclusive with the landing branches that set those fields). ---
  if (G.duel) {
    if (G.duel.phase === 'offer' && isCurrent) {
      out.push({ move: 'payRent', description: `Pay the $${G.duel.rent} rent normally.` });
      if (!isDuelCooldownBlocked(G.players[Number(G.duel.challengerId)], G.totalTurns)) {
        out.push({ move: 'initiateDuel', description: `Challenge the owner to a duel over the rent (lose = $${Math.round(RULES.duel.loseMultiplier * G.duel.rent)}).` });
      }
    } else if (G.duel.phase === 'response' && actorMatches(G, seat, G.duel.ownerId)) {
      if (listable('respondDuel')) out.push({ move: 'respondDuel', expect: expectFor('respondDuel'), description: 'Fight! (2d6 + stats per side)' });
      if (listable('declineDuel')) out.push({ move: 'declineDuel', expect: expectFor('declineDuel'), description: 'Decline — take the normal rent instead.' });
    }
    return out;
  }

  // --- Auction cross-seat response (Game.js:1841-1889). Only placeBid/
  // passAuction are auction-gated — everything else below is independently
  // evaluated on its own guards (no early return here). ---
  if (G.auction) {
    const activeBidder = G.auction.bidders[G.auction.currentBidderIndex].playerId;
    if (actorMatches(G, seat, activeBidder)) {
      const minBid = G.auction.currentBid === 0
        ? RULES.auction.startingBid
        : G.auction.currentBid + RULES.auction.minimumIncrement;
      if (minBid <= p.money && listable('placeBid')) {
        out.push({ move: 'placeBid', argsHint: { min: minBid, max: p.money }, expect: expectFor('placeBid'),
          description: `Bid on ${spaceName(G, G.auction.propertyId)} (min $${minBid}).` });
      }
      if (listable('passAuction')) out.push({ move: 'passAuction', expect: expectFor('passAuction'), description: 'Pass — drop out of this auction.' });
    }
  }

  // --- Trade cross-seat response (Game.js:1738-1832). Engine quirk mirrored
  // deliberately: mortgage/unmortgage/upgrade/sell/regulate/useReroll are
  // NOT trade-gated — the proposer may still manage assets/reroll mid-trade.
  // No early return here either. ---
  if (G.trade) {
    if (actorMatches(G, seat, G.trade.targetPlayerId)) {
      if (listable('acceptTrade')) out.push({ move: 'acceptTrade', expect: expectFor('acceptTrade'), description: 'Accept the proposed trade.' });
      if (listable('rejectTrade')) out.push({ move: 'rejectTrade', expect: expectFor('rejectTrade'), description: 'Reject the proposed trade.' });
    }
    if (isCurrent) { // G.trade.proposerId === ctx.currentPlayer is an invariant while G.trade is set
      out.push({ move: 'cancelTrade', description: 'Withdraw your trade proposal.' });
    }
  }

  // --- Everything below only ever applies to the current player (every
  // remaining move's real guard is requireActor(G, ctx, ctx.currentPlayer),
  // which — combined with hot-seat's assumedPlayerID substitution — only
  // ever admits seat === ctx.currentPlayer). ---
  if (!isCurrent || p.bankrupt) return out;

  // --- Pending card (Game.js:1410-1448): acceptCard/redrawCard. NOT an
  // early return — asset moves/regulateProperty are NOT pendingCard-gated in
  // Game.js (only useReroll explicitly checks G.pendingCard, handled below).
  if (G.pendingCard) {
    out.push({ move: 'acceptCard', description: 'Apply the drawn card.' });
    const merchant = isMerchant(p); // shared mirror (view.js) — also drives the digest's redraw hint
    if (merchant || p.luckRedraws > 0) {
      out.push({ move: 'redrawCard', description: `Redraw the card${merchant ? ' (merchant: free)' : ` (${p.luckRedraws} redraw(s) left)`}.` });
    }
  }

  // --- Awaiting an atlas route choice (Game.js:1361-1368): commitRoute. Not
  // gated on any other move here either (Game.js's awaitingRoute guard only
  // appears on commitRoute and proposeTrade — proposeTrade's own check is
  // reproduced in its own condition below).
  if (G.awaitingRoute) {
    out.push({ move: 'commitRoute', argsHint: routeHint(G, p), description: 'Commit a route (omit route to auto-route).' });
  }

  // --- Pre-roll (Game.js:1327-1358): rollDice/rollOnly are both genuinely
  // dispatchable in EITHER movementMode (see file header) — list both.
  // payJailFine (Game.js:1639-1661) requires !G.hasRolled too.
  if (!G.hasRolled) {
    out.push({ move: 'rollDice', description: 'Roll the dice and move.' });
    out.push({ move: 'rollOnly', description: 'Roll the dice (route chosen separately).' });
    if (p.inJail && p.money >= RULES.core.jailFine) {
      out.push({ move: 'payJailFine', description: `Pay the $${RULES.core.jailFine} jail fine to get out now.` });
    }
  }

  // --- Buy decision (Game.js:1584-1637) ---
  if (G.canBuy) {
    const price = G.effectivePrice;
    if (p.money >= price) out.push({ move: 'buyProperty', description: `Buy ${spaceName(G, p.position)} for $${price}.` });
    out.push({ move: 'passProperty', description: RULES.auction.enabled && RULES.auction.auctionOnPass ? 'Pass — the property goes to auction.' : 'Pass on buying.' });
  }

  // --- Reroll (Game.js:1372-1407): blocked by G.canBuy/G.pendingCard, NOT
  // by G.auction/G.trade/G.awaitingRoute (G.duel already excluded above).
  if (G.hasRolled && p.rerollsLeft > 0 && !G.canBuy && !G.pendingCard) {
    out.push({ move: 'useReroll', description: `Reroll the dice (${p.rerollsLeft} left).` });
  }

  // --- Propose a trade (Game.js:1664-1730): requires G.hasRolled; blocked
  // by G.canBuy/G.pendingCard/G.auction/G.trade/G.awaitingRoute explicitly.
  if (G.hasRolled && RULES.trading.enabled && !G.canBuy && !G.pendingCard && !G.auction && !G.trade && !G.awaitingRoute
      && (!p.inJail || RULES.trading.canTradeInJail)) {
    const anyTarget = G.players.some(q => q.id !== seat && !q.bankrupt);
    if (anyTarget) {
      out.push({ move: 'proposeTrade', argsHint: { schema: '{targetPlayerId, offeredProperties?, requestedProperties?, offeredMoney?, requestedMoney?}' },
        description: 'Propose a trade to another seat.' });
    }
  }

  // --- Asset management: independent of pendingCard/auction/trade/
  // awaitingRoute (see file header) — internally gates upgrade/sell by
  // G.hasRolled, mortgage/unmortgage/regulate are ungated by it.
  pushAssetMoves(out, G, seat, p);

  // --- End turn (Game.js:1989-2000): requires G.hasRolled; blocked by
  // G.canBuy/G.pendingCard/G.trade/G.auction. NOT blocked by G.awaitingRoute
  // (Game.js genuinely has no such guard on endTurn — confirmed by reading
  // it; a quirk, not an oversight on this module's part).
  if (G.hasRolled && !G.canBuy && !G.pendingCard && !G.trade && !G.auction) {
    out.push({ move: 'endTurn', description: 'End your turn.' });
  }

  return out;
}
