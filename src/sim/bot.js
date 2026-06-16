// Atlas Balance Sim — greedy-developer bot (plan D3) + route strategies (D4).
//
// PURE decision logic: decideMoves(G, ctx, playerID, policy) returns an ORDERED
// list of move tuples (e.g. [['rollOnly'], ['commitRoute', route], ['buyProperty']])
// rather than dispatching them itself. The match runner dispatches each tuple
// through the Client and re-reads state between dispatches. This keeps the
// decider unit-testable against crafted G states with NO boardgame.io coupling.
//
// boardgame.io v0.45 OLD positional API: the engine moves are move(G, ctx, ...args);
// the bot mirrors that signature so test states match what the engine sees.
//
// All thresholds live in `policy` with sane defaults (CLAUDE.md: no inline magic
// numbers). decideMoves emits AT MOST ONE blocking-state resolution per call; the
// runner loops decideMoves each time it needs the next action, so a turn that
// rolls -> resolves card -> builds -> ends is several decideMoves calls.

import { routeChoices } from '../atlas-movement';
import { RULES } from '../../mods/dominion/rules';

// Default greedy-developer policy. Every knob here is overridable per contestant
// via the `policy` arg so tournaments can vary aggression without code edits.
export const DEFAULT_POLICY = {
  // Keep this much cash untouched when deciding to buy / build (survival float).
  cashBuffer: 200,
  // Build (upgrade) only while money - cashBuffer >= upgradeCost * this. >1 makes
  // the bot hoard more before building; the default 1.0 builds as soon as affordable
  // above the buffer. This is the lever that ends the 4000-turn no-build marathons.
  buildAggression: 1.0,
  // Max fraction of a property's face value the bot will bid in an auction.
  auctionMaxFraction: 0.6,
  // Pay the jail fine to get moving again if money - cashBuffer covers the fine.
  payJailFine: true,
  // v1 keeps card resolution simple: always acceptCard (no redraw heuristic).
  useRedraws: false,
  // Route strategy on atlas forks: 'camper' | 'tourer' (D4). No-op on loop maps.
  routeStrategy: 'camper',
};

// Merge a partial policy over the defaults (shallow — all keys are scalars).
export function resolvePolicy(policy) {
  return Object.assign({}, DEFAULT_POLICY, policy || {});
}

// --- small pure helpers (mirror Game.js semantics; read-only) ---

function groupKeyOf(space) {
  return space.placeId || space.color;
}

function ownsFullGroup(G, playerID, groupKey) {
  const ids = groupKey && G.board.colorGroups[groupKey];
  if (!ids) return false;
  return ids.every(id => G.ownership[id] === playerID);
}

// Recompute an upgrade cost the same way Game.getUpgradeCost does, WITHOUT season
// or character discounts (those only make the real cost lower, so building when we
// can afford the undiscounted cost is always safe — never over-commits cash).
function baseUpgradeCost(G, space, targetLevel) {
  return Math.floor(space.price * RULES.buildings.upgradeCostMultipliers[targetLevel - 1]);
}

// All spaces the player can legally upgrade right now (full group, even-build rule,
// below max level, no mortgaged member), cheapest first. Pure — mirrors the
// upgradeProperty guards in Game.js so the runner never dispatches an INVALID_MOVE.
export function upgradeableSpaces(G, playerID) {
  const player = G.players[parseInt(playerID)];
  const out = [];
  player.properties.forEach(pid => {
    const space = G.board.spaces[pid];
    if (!space || space.type !== 'property') return;
    const gk = groupKeyOf(space);
    if (!gk || !G.board.colorGroups[gk]) return;
    if (!ownsFullGroup(G, playerID, gk)) return;
    const groupIds = G.board.colorGroups[gk];
    if (groupIds.some(id => G.mortgaged[id])) return;
    const level = G.buildings[pid] || 0;
    if (level >= RULES.core.maxBuildingLevel) return;
    // even-building: only the group's current-min-level members are eligible
    const minLevel = Math.min.apply(null, groupIds.map(id => G.buildings[id] || 0));
    if (level > minLevel) return;
    out.push({ pid: pid, level: level, cost: baseUpgradeCost(G, space, level + 1) });
  });
  out.sort((a, b) => a.cost - b.cost);
  return out;
}

// Owned, unmortgaged, building-free properties cheapest first — the order the
// survive-by-mortgaging step liquidates holdings (lowest value first, so it keeps
// the properties that matter most to its monopolies).
function mortgageableSpaces(G, playerID) {
  const player = G.players[parseInt(playerID)];
  return player.properties
    .filter(pid => {
      if (G.mortgaged[pid]) return false;
      if ((G.buildings[pid] || 0) > 0) return false;
      const gk = groupKeyOf(G.board.spaces[pid]);
      if (gk && G.board.colorGroups[gk]) {
        // Game.js forbids mortgaging when ANY group member has buildings.
        if (G.board.colorGroups[gk].some(id => (G.buildings[id] || 0) > 0)) return false;
      }
      return true;
    })
    .sort((a, b) => G.board.spaces[a].price - G.board.spaces[b].price);
}

// === Route strategy (D4) =====================================================
// chooseRoute picks ONE entry from routeChoices(...). Pure: scores each branch's
// route against the strategy and returns the winning route array.
//
// tourer: maximize NEW places seen along the branch (coverage-seeking explorer).
// camper: minimize spread — stay nearest the player's owned cluster; ties broken
//   toward the branch that revisits already-owned/seen places (homebody).
export function chooseRoute(G, ctx, choices, strategy) {
  if (!choices || choices.length === 0) return [];
  if (choices.length === 1) return choices[0].route;

  const playerID = ctx.currentPlayer;
  const player = G.players[parseInt(playerID)];
  // Places the player already "knows": ones it owns property in.
  const ownedPlaces = {};
  player.properties.forEach(pid => {
    const gk = groupKeyOf(G.board.spaces[pid]);
    if (gk) ownedPlaces[gk] = true;
  });

  function placesOnRoute(route) {
    const seen = {};
    route.forEach(id => {
      const sp = G.board.spaces[id];
      const gk = groupKeyOf(sp);
      if (gk) seen[gk] = true;
    });
    return Object.keys(seen);
  }

  let best = null;
  let bestScore = -Infinity;
  choices.forEach((choice, idx) => {
    const places = placesOnRoute(choice.route);
    const ownedHits = places.filter(p => ownedPlaces[p]).length;
    let score;
    if (strategy === 'tourer') {
      // Reward branches that touch more distinct places, and especially NEW ones.
      const newPlaces = places.length - ownedHits;
      score = places.length + newPlaces; // distinct coverage, new weighted double
    } else {
      // camper: prefer branches that keep near owned cluster (more owned hits =
      // higher score), penalize branches that wander into many distinct places.
      score = ownedHits * 10 - places.length;
    }
    // Deterministic tie-break: earliest choice (edge order) wins.
    if (score > bestScore) {
      bestScore = score;
      best = choice.route;
    } else if (score === bestScore && best === null) {
      best = choice.route;
    }
  });
  return best || choices[0].route;
}

// === Move decider (D3) =======================================================
// Returns the ordered move list to dispatch NEXT. The runner calls this in a loop
// per turn: each call returns the single highest-priority action (plus, for the
// roll case, the immediate follow-up commit), then the runner re-reads G and calls
// again until decideMoves returns [['endTurn']] (or an empty list if stuck).
//
// Priority order (D3):
//   1. jail (not yet rolled): pay fine if affordable+policy, else roll to escape
//   2. roll: rollOnly+commitRoute (atlas) or rollDice (loop), once per turn
//   3. resolve blocking card: acceptCard
//   4. resolve auction: bid up to cap, else passAuction
//   5. resolve buy decision: buyProperty if affordable above buffer, else passProperty
//   6. build: upgrade cheapest eligible full-group space while buffer allows
//   7. survive: mortgage lowest-value holdings if money < 0 (shouldn't normally
//      happen post-resolution, but covers a card/tax that dipped us negative)
//   8. endTurn
export function decideMoves(G, ctx, playerID, policy) {
  const pol = resolvePolicy(policy);
  const player = G.players[parseInt(playerID)];
  const atlas = G.board.movementMode === 'atlas';

  // --- 3/4/5: resolve blocking states FIRST so endTurn never bounces. These can
  // be set even before we've rolled (jail roll can land on a card/buy), so they
  // take precedence over a fresh roll.
  if (G.pendingCard) {
    return [['acceptCard']];
  }
  if (G.auction) {
    return auctionDecision(G, ctx, pol);
  }
  if (G.canBuy) {
    return buyDecision(G, player, pol);
  }

  // --- 1: jail handling, before the roll, while not yet rolled.
  if (player.inJail && !G.hasRolled) {
    if (pol.payJailFine && player.money - pol.cashBuffer >= RULES.core.jailFine) {
      return [['payJailFine'], ...rollMoves(G, ctx, atlas, pol)];
    }
    // else fall through to roll (try doubles / serve time)
  }

  // --- 2: roll once per turn.
  if (!G.hasRolled) {
    return rollMoves(G, ctx, atlas, pol);
  }

  // --- 6: build. One upgrade per decideMoves call so the runner re-reads cash.
  const builds = upgradeableSpaces(G, playerID);
  for (let i = 0; i < builds.length; i++) {
    const b = builds[i];
    if (player.money - pol.cashBuffer >= b.cost * pol.buildAggression) {
      return [['upgradeProperty', b.pid]];
    }
  }

  // --- 7: survive (defensive — resolve a negative balance by mortgaging).
  if (player.money < 0) {
    const m = mortgageableSpaces(G, playerID);
    if (m.length > 0) return [['mortgageProperty', m[0]]];
  }

  // --- 8: end the turn.
  return [['endTurn']];
}

// Roll sequence: atlas = rollOnly then commitRoute(chosen branch); loop = rollDice.
// On atlas, the commit route must be computed AFTER rollOnly resolves (the dice
// total isn't known until then), so the runner dispatches rollOnly, re-reads G,
// then calls decideRoute() for the commit. We express that as a two-step list with
// a deferred-route marker the runner expands.
function rollMoves(G, ctx, atlas, pol) {
  if (!atlas) return [['rollDice']];
  // ['rollOnly'] then a deferred commit: the runner sees 'commitRoute' with a null
  // route and fills it via decideRoute() once the post-roll dice total is known.
  return [['rollOnly'], ['commitRoute', null]];
}

// Called by the runner after rollOnly resolves, to pick the actual route. Returns
// the route array for commitRoute. If there's no fork the lone route is returned;
// if the player can't move at all, [] (a legal stall).
export function decideRoute(G, ctx, pol) {
  const resolved = resolvePolicy(pol);
  const player = G.players[parseInt(ctx.currentPlayer)];
  const total = G.lastDice ? G.lastDice.total : 0;
  const choices = routeChoices(G.board.edges, player.position, total);
  return chooseRoute(G, ctx, choices, resolved.routeStrategy);
}

function buyDecision(G, player, pol) {
  const space = G.board.spaces[player.position];
  const price = G.effectivePrice || (space ? space.price : Infinity);
  if (player.money - pol.cashBuffer >= price) {
    return [['buyProperty']];
  }
  return [['passProperty']];
}

function auctionDecision(G, ctx, pol) {
  const auction = G.auction;
  const bidderEntry = auction.bidders[auction.currentBidderIndex];
  // Only the active bidder acts; if it's not our seat the runner will rotate to
  // the right seat (cross-seat auctions are driven by the runner per current bidder).
  const bidder = G.players[parseInt(bidderEntry.playerId)];
  const space = G.board.spaces[auction.propertyId];
  const faceValue = space ? space.price : 0;
  const cap = Math.floor(faceValue * pol.auctionMaxFraction);
  const minBid = auction.currentBid === 0
    ? RULES.auction.startingBid
    : auction.currentBid + RULES.auction.minimumIncrement;
  if (minBid <= cap && minBid <= bidder.money) {
    return [['placeBid', minBid]];
  }
  return [['passAuction']];
}
