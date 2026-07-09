import { INVALID_MOVE, Stage } from 'boardgame.io/core';
import { validateRoute, autoRoute } from './atlas-movement';
import { BOARD_SPACES as DEFAULT_BOARD_SPACES, COLOR_GROUPS as DEFAULT_COLOR_GROUPS } from '../mods/dominion/board';
import { CHANCE_CARDS as DEFAULT_CHANCE_CARDS, COMMUNITY_CARDS as DEFAULT_COMMUNITY_CARDS } from '../mods/dominion/cards';
import { RULES } from '../mods/active-rules';
import { MODS, PRISTINE } from '../mods/index';
import { deepMerge, DEFAULT_RULES } from './mod-loader';
import { refreshConstants } from './constants';
import { logEvent, resetMessages, playerName } from './events';

// Active map data — defaults to classic mod, can be overridden via setActiveMap().
// Per-match board config is snapshotted into G.board at setup(); all engine readers
// use G.board.*. setup() is the only code that still reads _pendingMap directly, because
// G.board does not yet exist while setup() runs (it is being built from _pendingMap).
var _mapVictory = null;        // victory config from the active map (map.json)
var _victoryOverride = null;   // per-session override from the game-start selector

// Active mod (Tier-A data bundle). Default is Dominion at module load so the engine,
// server, and sim behave byte-identically without anyone calling setActiveMod. Character
// reads (getCharacterById / getStartingMoney) route through this so a switched mod uses its
// own roster + starting-money formula. NEVER auto-call setActiveMod here (server/sim import
// Game.js under `node -r esm`; setActiveMod must be safe to define, but not run server-side).
var _activeMod = MODS.dominion;

// Active-board source for setup(). setup() wraps these into a fresh per-match G.board
// object so each match reads its OWN board config (not process-global mutable state).
// The board arrays (spaces/colorGroups/cards) are static, read-only map data, so they
// are shared by reference across matches by design — only the wrapper is per-match;
// per-match MUTABLE state (ownership, buildings, mortgaged) already lives elsewhere in G.
var _pendingMap = {
  spaces: DEFAULT_BOARD_SPACES,
  colorGroups: DEFAULT_COLOR_GROUPS,
  chanceCards: DEFAULT_CHANCE_CARDS,
  communityCards: DEFAULT_COMMUNITY_CARDS,
  boardSize: RULES.core.boardSize,
  jail: RULES.core.jailPosition,
  mapMechanics: { incomeMultiplier: 1, rentMultiplier: 1, taxMultiplier: 1, priceMultiplier: 1, upgradeCostMultiplier: 1 },
  movementMode: 'loop',
  edges: null,
  hubs: null,
  traits: null,
  winPaths: null,
};

export function setActiveMap(mapData) {
  _pendingMap = {
    spaces: mapData.spaces,
    colorGroups: mapData.colorGroupsFlat,
    chanceCards: mapData.chanceCards,
    communityCards: mapData.communityCards,
    boardSize: mapData.spaceCount,
    jail: mapData.specialSpaces.jail,
    mapMechanics: mapData.mapMechanics || { incomeMultiplier: 1, rentMultiplier: 1, taxMultiplier: 1, priceMultiplier: 1, upgradeCostMultiplier: 1 },
    movementMode: mapData.movementMode || 'loop',
    edges: mapData.edges || null,
    hubs: mapData.hubs || null,
    traits: mapData.traits || null,
    winPaths: mapData.winPaths || null,
  };
  _mapVictory = mapData.victory || null;
}

// Install a mod into the engine singletons (mirrors setActiveMap, one level up).
//
// The CRUX is RULES: it is imported by-value and read as RULES.* at ~206 sites, plus mutated
// in place by ~16 tests. The live RULES (mods/active-rules.js) shares object identity with
// Dominion's source rules. We must NEVER rebind RULES — instead we mutate the SAME object in
// place so every existing read and every test mutation keeps reaching it:
//   (a) delete ALL own keys of the live RULES;
//   (b) resolved = deepMerge(PRISTINE[modId], DEFAULT_RULES)  — mod overrides win, defaults
//       fill gaps (arg order matters). PRISTINE is a clone taken at load, so reseeding here
//       can never be corrupted by an earlier in-place mutation of the live RULES;
//   (c) deep Object.assign `resolved` INTO the live RULES object in place.
// Then re-seed the _pendingMap board DEFAULTS from the mod (so a mod chosen without a
// specific map still gets its own board) and refresh constants.js derived exports.
export function setActiveMod(modId) {
  const mod = MODS[modId];
  if (!mod) throw new Error('Unknown mod: ' + modId);

  // (a) clear own keys of the live RULES object (do NOT rebind the binding).
  for (const key of Object.keys(RULES)) {
    delete RULES[key];
  }
  // (b) resolve from the PRISTINE clone (never from the live object) so switch-back is safe.
  const resolved = deepMerge(PRISTINE[modId], DEFAULT_RULES);
  // (c) deep-assign resolved INTO the live RULES object in place.
  deepAssignInto(RULES, resolved);

  _activeMod = mod;

  // Re-seed _pendingMap board defaults from the mod (a mod with no specific map still plays
  // on its own board). Keeps movement/affinity fields neutral as before.
  _pendingMap = {
    spaces: mod.board.spaces,
    colorGroups: mod.board.colorGroups,
    chanceCards: mod.cards.chance,
    communityCards: mod.cards.community,
    boardSize: RULES.core.boardSize,
    jail: RULES.core.jailPosition,
    mapMechanics: { incomeMultiplier: 1, rentMultiplier: 1, taxMultiplier: 1, priceMultiplier: 1, upgradeCostMultiplier: 1 },
    movementMode: 'loop',
    edges: null,
    hubs: null,
    traits: null,
    winPaths: null,
  };

  // Re-derive constants.js exports from the now-updated live RULES.
  refreshConstants();
}

// Deep Object.assign: copy source's keys onto target in place, recursing into plain objects
// so nested config objects are also overwritten key-by-key (arrays/primitives assigned whole).
function deepAssignInto(target, source) {
  for (const key of Object.keys(source)) {
    const sv = source[key];
    if (sv && typeof sv === 'object' && !Array.isArray(sv)
        && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      deepAssignInto(target[key], sv);
    } else {
      target[key] = sv;
    }
  }
}

// Set a per-session victory override (from the game-start selector). Pass null to clear.
export function setVictoryConfig(cfg) {
  _victoryOverride = cfg || null;
}

// Resolve the active victory config: session override > map config > rules defaults.
// Stored into G.victory at setup() so scoring stays per-match (safe for concurrent games).
function resolveVictory() {
  const base = RULES.victory;
  const map = _mapVictory || {};
  const mapGroups = map.params && map.params.groupsToWin;
  const ovr = _victoryOverride || {};
  return {
    primary: ovr.primary || map.primary || base.primary,
    maxTurns: (ovr.maxTurns != null ? ovr.maxTurns : (map.maxTurns != null ? map.maxTurns : base.maxTurns)) || 0,
    groupsToWin: ovr.groupsToWin || mapGroups || base.groupsToWin || 3,
  };
}

// --- Seat authorization (Task 9) ---
//
// Hot-seat fact (verified against boardgame.io's Client): a local client with
// no playerID gets ctx.playerID SUBSTITUTED to the assumedPlayerID (== the
// current turn's player) — ctx.playerID is NEVER null in hot-seat. Guard
// inertness therefore comes EXCLUSIVELY from the `!G.enforceSeats` prefix; no
// code may ever branch on `ctx.playerID === null` to detect hot-seat. String()
// coercion on expectedId tolerates numeric ids (bidders/players arrays use
// string ids everywhere in this file, but callers passing a raw index are
// still matched correctly against ctx.playerID, which bgio always stores as
// a string). Exported for direct unit testing.
export function requireActor(G, ctx, expectedId) {
  return !G.enforceSeats || ctx.playerID === String(expectedId);
}

function createPlayer(id) {
  return {
    id,
    money: RULES.core.baseStartingMoney,
    position: 0,
    properties: [],
    inJail: false,
    jailTurns: 0,
    bankrupt: false,
    character: null,
    rerollsLeft: 0,
    luckRedraws: 0,
    regulatedProperty: null,
    distanceTraveled: 0,
    affinityBonus: 0,
    lastDuelTurn: null,
  };
}

// Map affinity (Atlas traits): a one-time, stat-scaled cash head-start at character
// select (spec §5, mechanism B). fit = Σ stat·trait over the map's trait leans;
// bonus = max(0, round(fit * RULES.affinity.cashPerFit)). Floored at 0 so a map only
// FAVORS (never punishes). Classic maps have no traits (null) → fit 0 → no bonus.
// Exported for unit testing. Pure (no G/ctx coupling).
export function computeAffinityBonus(char, traits) {
  if (!traits || !char || !char.stats) return 0;
  let fit = 0;
  for (const stat in traits) fit += (char.stats[stat] || 0) * traits[stat];
  return Math.max(0, Math.round(fit * RULES.affinity.cashPerFit));
}

// --- Character helpers ---

function getPassive(player) {
  return player.character ? player.character.passive.id : null;
}

function ownsColorGroup(G, playerId, color) {
  if (!color || !G.board.colorGroups[color]) return false;
  return G.board.colorGroups[color].every(id => G.ownership[id] === playerId);
}

// Resolve a space's group key. Atlas property spaces carry placeId (no color);
// classic spaces carry a hex color (no placeId). placeId-first so a future
// render pass can stamp a display color onto atlas spaces without changing the
// grouping. The two namespaces are disjoint, so this is identical for both
// current map types.
function groupKeyOf(space) {
  return space.placeId || space.color;
}

function getEffectiveBuyPrice(G, player, space) {
  let price = space.price;

  // Season price modifier
  price = applyEconMods(G, 'price', price);

  if (!player.character) return Math.floor(price);

  // Negotiation stat discount
  const negDiscount = Math.min(player.character.stats.negotiation * RULES.stats.negotiation.buyDiscountPerPoint, RULES.stats.negotiation.buyDiscountMax);
  price *= (1 - negDiscount);

  // Albert Victor passive: property price discount
  if (getPassive(player) === 'financier') {
    price *= (1 - RULES.passives.financier.buyDiscount);
  }

  return Math.floor(price);
}

// --- Upgrade cost ---

function getUpgradeCost(G, player, space, targetLevel) {
  let cost = space.price * RULES.buildings.upgradeCostMultipliers[targetLevel - 1];

  // Season price modifier affects upgrade cost
  cost = applyEconMods(G, 'upgrade', cost);

  if (player.character) {
    // Tech stat discount
    const techDiscount = Math.min(player.character.stats.tech * RULES.stats.tech.upgradeDiscountPerPoint, RULES.stats.tech.upgradeDiscountMax);
    cost *= (1 - techDiscount);
    // Lia Startrace passive: upgrade cost discount
    if (getPassive(player) === 'pioneer') {
      cost *= (1 - RULES.passives.pioneer.upgradeCostDiscount);
    }
  }
  return Math.floor(cost);
}

// --- Season helpers ---

function getCurrentSeason(G) {
  return RULES.seasons.list[G.seasonIndex];
}

// Single economic-multiplier choke point. Stack order: base × season × mapMechanics × phase × affinity.
// phase/affinity are 1.0 today. Does NOT floor — callers floor once at the end (preserves behavior).
function applyEconMods(G, kind, value) {
  const season = getCurrentSeason(G);
  const seasonMod = kind === 'rent' ? season.rentMod
                  : kind === 'tax'  ? season.taxMod
                  : kind === 'income' ? 1.0 // no season income mod exists
                  : season.priceMod; // 'price' and 'upgrade' use the season price mod (matches current behavior)
  const mech = G.board.mapMechanics || {};
  const mechMod = kind === 'rent' ? (mech.rentMultiplier === undefined ? 1 : mech.rentMultiplier)
                : kind === 'tax'  ? (mech.taxMultiplier === undefined ? 1 : mech.taxMultiplier)
                : kind === 'upgrade' ? (mech.upgradeCostMultiplier === undefined ? 1 : mech.upgradeCostMultiplier)
                : kind === 'income' ? (mech.incomeMultiplier === undefined ? 1 : mech.incomeMultiplier)
                : (mech.priceMultiplier === undefined ? 1 : mech.priceMultiplier); // 'price'
  return value * seasonMod * mechMod;
}

// --- Dice & cards ---

function rollTwoDice(ctx) {
  const d1 = Math.floor(ctx.random.Number() * RULES.core.diceSides) + 1;
  const d2 = Math.floor(ctx.random.Number() * RULES.core.diceSides) + 1;
  return { d1, d2, total: d1 + d2, isDoubles: d1 === d2 };
}

// Returns { card, index } (index into `deck`, needed downstream by
// card_drawn/card_applied/card_redrawn payloads for a stable card reference),
// or null for an empty/missing deck.
function drawCard(ctx, deck) {
  if (!deck || deck.length === 0) return null;
  const index = Math.floor(ctx.random.Number() * deck.length);
  return { card: deck[index], index };
}

// --- Rent calculation ---

function countOwnedRailroads(G, ownerID) {
  return G.players[ownerID].properties.filter(pid => {
    return G.board.spaces[pid].type === 'railroad';
  }).length;
}

function countOwnedUtilities(G, ownerID) {
  return G.players[ownerID].properties.filter(pid => {
    return G.board.spaces[pid].type === 'utility';
  }).length;
}

function calculateRent(G, space, diceTotal, visitor) {
  const owner = G.ownership[space.id];
  if (owner === null || owner === undefined) return 0;

  // Mortgaged properties collect no rent
  if (G.mortgaged[space.id]) return 0;

  let rent;
  if (space.type === 'railroad') {
    const count = countOwnedRailroads(G, owner);
    rent = RULES.rent.railroadBase * Math.pow(RULES.rent.railroadExponent, count - 1);
  } else if (space.type === 'utility') {
    const count = countOwnedUtilities(G, owner);
    rent = count === 1 ? diceTotal * RULES.rent.utilityMultiplierSingle : diceTotal * RULES.rent.utilityMultiplierBoth;
  } else {
    const buildingLevel = G.buildings[space.id] || 0;
    if (buildingLevel > 0) {
      // Building rent replaces monopoly bonus
      rent = space.rent * RULES.buildings.rentMultipliers[buildingLevel];
    } else {
      rent = space.rent;
      // Monopoly bonus: double rent if owner has full color group (no buildings)
      const gk = groupKeyOf(space);
      if (gk && ownsColorGroup(G, owner, gk)) {
        rent *= RULES.core.monopolyRentMultiplier;
      }
    }
  }

  // Season rent modifier (Winter: +20%)
  rent = applyEconMods(G, 'rent', rent);

  // Character effects only apply if visitor has a character
  if (visitor && visitor.character) {
    // Charisma stat discount
    const chaDiscount = Math.min(visitor.character.stats.charisma * RULES.stats.charisma.rentDiscountPerPoint, RULES.stats.charisma.rentDiscountMax);
    rent *= (1 - chaDiscount);

    // Knox regulated property: bonus rent
    const ownerPlayer = G.players[owner];
    if (ownerPlayer.regulatedProperty === space.id) {
      rent *= (1 + RULES.passives.enforcer.regulatedRentBonus);
    }

    // Renn anti-monopoly: reduced rent on full color set properties
    const gk = groupKeyOf(space);
    if (getPassive(visitor) === 'breaker' && gk && ownsColorGroup(G, owner, gk)) {
      rent *= (1 - RULES.passives.breaker.monopolyRentReduction);
    }
  }

  return Math.floor(rent);
}

// --- Bankruptcy ---

function handleBankruptcy(G, ctx, player, creditorId) {
  player.bankrupt = true;
  player.money = 0;
  logEvent(G, 'bankruptcy', player.id, { creditorId: (creditorId === undefined) ? null : creditorId });

  // Transfer properties to creditor (if any)
  if (creditorId !== null && creditorId !== undefined) {
    player.properties.forEach(pid => {
      G.ownership[pid] = creditorId;
      G.players[creditorId].properties.push(pid);
      // Buildings and mortgage status transfer with property
    });
  } else {
    // Bankrupt from tax/card — properties return to bank
    player.properties.forEach(pid => {
      G.ownership[pid] = null;
      delete G.buildings[pid];
      delete G.mortgaged[pid];
    });
  }
  player.properties = [];

  // Sophia Ember passive: gain bonus when any player goes bankrupt
  G.players.forEach(p => {
    if (p.id !== player.id && !p.bankrupt && getPassive(p) === 'arbitrageur') {
      p.money += RULES.passives.arbitrageur.bankruptcyBonus;
      logEvent(G, 'passive_triggered', p.id, { passive: 'arbitrageur', effect: 'bankruptcy_bonus', amount: RULES.passives.arbitrageur.bankruptcyBonus });
    }
  });

  // --- Task 9 interleaving fixes ---
  //
  // Bankruptcy during a pending trade: accepting/rejecting a trade with a
  // bankrupt party is undefined behavior, so cancel it outright. This is a
  // previously-undefined path (no G.messages site ever existed for it) — the
  // new 'trade_cancelled' line here is an accepted, documented deviation from
  // strict byte-identity (no golden scenario has a pending trade at
  // bankruptcy, so the golden gate is unaffected). Actor is the bankrupt
  // player (whichever side of the trade they were on); payload carries the
  // OTHER party's id so consumers don't need the now-nulled G.trade.
  if (G.trade && (G.trade.proposerId === player.id || G.trade.targetPlayerId === player.id)) {
    const otherPartyId = G.trade.proposerId === player.id ? G.trade.targetPlayerId : G.trade.proposerId;
    logEvent(G, 'trade_cancelled', player.id, { otherPartyId, reason: 'bankruptcy' });
    G.trade = null;
    G.turnPhase = 'done';
    if (G.enforceSeats) {
      ctx.events.setActivePlayers({ currentPlayer: Stage.NULL });
    }
  }

  // Bankruptcy during a pending auction, part 1: the bankrupt player can be
  // the STANDING HIGH BIDDER (G.auction.currentBidder) without being the
  // bidder currently on the clock (currentBidderIndex) — e.g. they bid, the
  // rotation moved on to another bidder, and THEN a same-turn refund (e.g.
  // useReroll's salary clawback, guarded only by ctx.currentPlayer, not by
  // "is the acting bidder") bankrupts them. advanceAuction's bankrupt-skip
  // only guards the ROTATION, so a bankrupt currentBidder would otherwise
  // still be handed the property once the remaining bidders pass. Clear the
  // high bid back to its pre-bid state (mirrors passProperty's auction init:
  // currentBid: 0, currentBidder: null) so bidding effectively restarts among
  // the live bidders. No new message: this is bid-state cleanup, not a
  // player-facing event, and no golden fixture exercises this interleaving.
  if (G.auction && G.auction.currentBidder === player.id) {
    G.auction.currentBidder = null;
    G.auction.currentBid = 0;
  }

  // Bankruptcy during a pending auction, part 2: advanceAuction's own bidder
  // filter (below) skips bankrupt bidders whenever the ROTATION reaches them,
  // but if the bankrupt player IS the bidder currently on the clock
  // (currentBidderIndex), they can no longer placeBid/passAuction to move the
  // rotation along — advance immediately so the auction doesn't stall
  // forever. Runs AFTER the currentBidder cleanup above so, if the bankrupt
  // player happened to be both the acting bidder and the standing high
  // bidder, advanceAuction's "all passed" fallback (which resolves to
  // auction.currentBidder when non-null) can no longer resolve to them.
  if (G.auction) {
    const actingBidder = G.auction.bidders[G.auction.currentBidderIndex];
    if (actingBidder && actingBidder.playerId === player.id) {
      advanceAuction(G, ctx);
    }
  }
}

// Pay the hub-gated salary (atlas income, spec D4). Same RULES.core.goSalary
// base as classic GO, scaled by the income multiplier stack; the idealist
// passive's GO bonus migrates here as a flat add.
function payHubSalary(G, player) {
  let salary = Math.floor(applyEconMods(G, 'income', RULES.core.goSalary));
  if (getPassive(player) === 'idealist') {
    salary += RULES.passives.idealist.goBonus;
    logEvent(G, 'passive_triggered', player.id, { passive: 'idealist', effect: 'go_bonus', amount: RULES.passives.idealist.goBonus, context: 'hub' });
  }
  player.money += salary;
  logEvent(G, 'salary_collected', player.id, { source: 'hub', amount: salary });
  return salary;
}

// Atlas movement (spec D11): walk a whole route atomically. `route` is the
// ordered node list AFTER the start position; omitted = deterministic
// auto-walk (first edge each step, stops at dead ends — no-stall fallback).
// Pays hub salary on every hub node entered. Returns false on an illegal
// route (caller maps to INVALID_MOVE).
function atlasWalk(G, player, dice, route) {
  const edges = G.board.edges;
  const steps = route === undefined ? autoRoute(edges, player.position, dice.total) : route;
  if (!validateRoute(edges, player.position, steps, dice.total)) return false;

  let salaryCollected = 0;
  steps.forEach(id => {
    player.position = id;
    // `|| 0` tolerates pre-branch saves where the field doesn't exist.
    player.distanceTraveled = (player.distanceTraveled || 0) + 1;
    if (G.board.spaces[id].isHub) {
      salaryCollected += payHubSalary(G, player);
    }
  });
  if (steps.length < dice.total) {
    logEvent(G, 'moved', player.id, { from: dice.preRollPosition, to: player.position, passedGo: false, routeExhausted: true });
  }
  G.lastDice.salaryCollected = salaryCollected;
  return true;
}

// Send a player to jail. Atlas maps have no jail node (G.board.jail === null):
// the player is detained in place — fine/doubles/turn-count release logic is
// position-independent, so everything else works unchanged.
function sendToJail(G, player) {
  if (G.board.jail !== null && G.board.jail !== undefined) {
    player.position = G.board.jail;
  }
  player.inJail = true;
  player.jailTurns = 0;
}

// --- Landing ---

function handleLanding(G, ctx) {
  const player = G.players[ctx.currentPlayer];
  const space = G.board.spaces[player.position];

  switch (space.type) {
    case 'go':
      break;

    case 'property':
    case 'railroad':
    case 'utility': {
      const owner = G.ownership[space.id];
      if (owner === null || owner === undefined) {
        const effectivePrice = getEffectiveBuyPrice(G, player, space);
        if (player.money >= effectivePrice) {
          G.canBuy = true;
          G.effectivePrice = effectivePrice;
          logEvent(G, 'landing_notice', ctx.currentPlayer, { note: 'available', propertyId: space.id, listPrice: space.price, effectivePrice });
        } else {
          logEvent(G, 'landing_notice', ctx.currentPlayer, { note: 'unaffordable', propertyId: space.id, price: getEffectiveBuyPrice(G, player, space), playerMoney: player.money });
        }
      } else if (owner !== ctx.currentPlayer) {
        const rent = calculateRent(G, space, G.lastDice.total, player);
        player.money -= rent;
        G.players[owner].money += rent;
        logEvent(G, 'rent_paid', ctx.currentPlayer, { propertyId: space.id, ownerId: owner, amount: rent });
        if (player.money <= 0) {
          handleBankruptcy(G, ctx, player, owner);
        }
      } else {
        logEvent(G, 'landing_notice', ctx.currentPlayer, { note: 'owned', propertyId: space.id });
      }
      break;
    }

    case 'tax': {
      let taxAmount = space.taxAmount !== undefined ? space.taxAmount : space.rent;
      // Season tax modifier (Winter: double tax)
      taxAmount = Math.floor(applyEconMods(G, 'tax', taxAmount));
      // Albert Victor passive: financial negative event loss reduction
      if (getPassive(player) === 'financier') {
        taxAmount = Math.floor(taxAmount * (1 - RULES.passives.financier.negativeEventReduction));
        logEvent(G, 'passive_triggered', ctx.currentPlayer, { passive: 'financier', effect: 'loss_reduced', amount: taxAmount, context: 'tax' });
      }
      player.money -= taxAmount;
      if (RULES.core.freeParkingPot) {
        G.freeParkingPot += taxAmount;
      }
      logEvent(G, 'tax_paid', ctx.currentPlayer, { amount: taxAmount, spaceId: space.id });
      if (player.money <= 0) {
        handleBankruptcy(G, ctx, player, null);
      }
      break;
    }

    case 'chance': {
      const drawn = drawCard(ctx, G.board.chanceCards);
      if (!drawn) {
        logEvent(G, 'card_drawn', ctx.currentPlayer, { deck: 'chance', cardIndex: null, text: null, empty: true });
        break;
      }
      const { card, index: cardIndex } = drawn;
      logEvent(G, 'card_drawn', ctx.currentPlayer, { deck: 'chance', cardIndex, text: card.text });
      // Check if player can redraw (Cassian passive OR luck redraws)
      const canRedraw = (getPassive(player) === 'merchant') ||
                        (player.luckRedraws > 0 && ['pay', 'payPercent', 'downgrade', 'goToJail'].includes(card.action));
      if (canRedraw) {
        G.pendingCard = { card, deck: 'chance', cardIndex };
        G.turnPhase = 'card';
        logEvent(G, 'card_prompt', ctx.currentPlayer, { deck: 'chance', cardIndex });
        return;
      }
      applyCard(G, ctx, player, card, 'chance', cardIndex);
      break;
    }

    case 'community': {
      const drawn = drawCard(ctx, G.board.communityCards);
      if (!drawn) {
        logEvent(G, 'card_drawn', ctx.currentPlayer, { deck: 'community', cardIndex: null, text: null, empty: true });
        break;
      }
      const { card, index: cardIndex } = drawn;
      logEvent(G, 'card_drawn', ctx.currentPlayer, { deck: 'community', cardIndex, text: card.text });
      const canRedraw = (getPassive(player) === 'merchant') ||
                        (player.luckRedraws > 0 && ['pay', 'payPercent', 'downgrade', 'goToJail'].includes(card.action));
      if (canRedraw) {
        G.pendingCard = { card, deck: 'community', cardIndex };
        G.turnPhase = 'card';
        logEvent(G, 'card_prompt', ctx.currentPlayer, { deck: 'community', cardIndex });
        return;
      }
      applyCard(G, ctx, player, card, 'community', cardIndex);
      break;
    }

    case 'goToJail':
      sendToJail(G, player);
      logEvent(G, 'went_to_jail', ctx.currentPlayer, { reason: 'space' });
      break;

    case 'jail':
      logEvent(G, 'landing_notice', ctx.currentPlayer, { note: 'visiting_jail' });
      break;

    case 'parking':
      if (RULES.core.freeParkingPot && G.freeParkingPot > 0) {
        player.money += G.freeParkingPot;
        logEvent(G, 'salary_collected', ctx.currentPlayer, { source: 'parking', amount: G.freeParkingPot });
        G.freeParkingPot = 0;
      } else {
        logEvent(G, 'landing_notice', ctx.currentPlayer, { note: 'parking_relax' });
      }
      break;
  }
}

function getTotalAssets(G, player) {
  let total = player.money;
  player.properties.forEach(pid => {
    // A mortgaged property is worth its mortgage value (what the bank paid out),
    // not its full price — otherwise net worth overstates a mortgaged player.
    const mortgaged = G.mortgaged && G.mortgaged[pid];
    total += mortgaged
      ? Math.floor(G.board.spaces[pid].price * RULES.core.mortgageRate)
      : G.board.spaces[pid].price;
    const level = G.buildings[pid] || 0;
    for (let i = 1; i <= level; i++) {
      total += Math.floor(G.board.spaces[pid].price * RULES.buildings.upgradeCostMultipliers[i - 1]);
    }
  });
  return total;
}

// Number of color groups fully owned by a player (for the 'monopoly'/dominion win).
function countFullGroups(G, playerId) {
  let n = 0;
  for (const color in G.board.colorGroups) {
    if (ownsColorGroup(G, playerId, color)) n++;
  }
  return n;
}

// Rank players by net worth, with a deterministic tie-break (assets → cash → id).
function rankStandings(G, players) {
  return players
    .map(p => ({ id: p.id, score: getTotalAssets(G, p), props: p.properties.length, groups: countFullGroups(G, p.id) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const am = G.players[parseInt(a.id)].money, bm = G.players[parseInt(b.id)].money;
      if (bm !== am) return bm - am;
      return parseInt(a.id) - parseInt(b.id);
    });
}

// `deck`/`cardIndex` (the card's origin deck id and index within it) are only
// known to the three callers (handleLanding's chance/community cases,
// acceptCard, redrawCard) — threaded through as params so every card_applied
// event carries a stable card reference without applyCard re-deriving it.
function applyCard(G, ctx, player, card, deck, cardIndex) {
  switch (card.action) {
    case 'gain':
      // No message ever existed for this action (silent credit) — card_applied
      // is still logged (data-only; formatter returns null) so the event
      // stream has a complete record even where G.messages doesn't.
      player.money += card.value;
      logEvent(G, 'card_applied', player.id, { deck, cardIndex, action: 'gain', text: card.text, effect: { amount: card.value } });
      break;
    case 'pay': {
      let amount = card.value;
      // Albert Victor passive: financial negative event loss reduction
      if (getPassive(player) === 'financier') {
        amount = Math.floor(amount * (1 - RULES.passives.financier.negativeEventReduction));
        logEvent(G, 'passive_triggered', player.id, { passive: 'financier', effect: 'loss_reduced', amount, context: 'pay' });
      }
      player.money -= amount;
      if (RULES.core.freeParkingPot) {
        G.freeParkingPot += amount;
      }
      // No primary message ever existed for 'pay' either (only the optional
      // financier line above) — same data-only rationale as 'gain'.
      logEvent(G, 'card_applied', player.id, { deck, cardIndex, action: 'pay', text: card.text, effect: { amount } });
      if (player.money <= 0) {
        handleBankruptcy(G, ctx, player, null);
      }
      break;
    }
    case 'moveTo': {
      if (G.board.movementMode === 'atlas') {
        // Node-targeted teleport (spec §6): no route walk, no distance, salary
        // only if the TARGET is a hub (reaching counts; loader validates ids).
        player.position = card.value;
        if (G.board.spaces[card.value].isHub) {
          // Deliberately NOT added to G.lastDice.salaryCollected: card effects
          // survive a reroll, matching classic moveTo-GO semantics.
          payHubSalary(G, player);
        }
        logEvent(G, 'card_applied', player.id, { deck, cardIndex, action: 'moveTo', text: card.text, effect: { targetSpaceId: card.value, targetSpaceName: G.board.spaces[card.value].name, movementMode: 'atlas' } });
        handleLanding(G, ctx);
        break;
      }
      const oldPos = player.position;
      player.position = card.value;
      let passedGo = false;
      let goBonus = 0;
      if (card.value < oldPos && card.value !== G.board.jail) {
        passedGo = true;
        goBonus = Math.floor(applyEconMods(G, 'income', RULES.core.goSalary));
        // Mira Dawnlight passive: GO bonus. Reuses the SAME event
        // types/text as performMove's real dice-move GO crossing (the
        // messages are byte-identical: "Growth vision: extra $X from GO!" /
        // "Passed GO! Collect $X.") — only source/context ('card' instead of
        // 'go') differs, so an event-stream consumer can still tell a
        // card-teleport GO bonus apart from an ordinary move.
        if (getPassive(player) === 'idealist') {
          goBonus += RULES.passives.idealist.goBonus;
          logEvent(G, 'passive_triggered', player.id, { passive: 'idealist', effect: 'go_bonus', amount: RULES.passives.idealist.goBonus, context: 'card' });
        }
        player.money += goBonus;
        logEvent(G, 'salary_collected', player.id, { source: 'card', amount: goBonus });
      }
      logEvent(G, 'card_applied', player.id, { deck, cardIndex, action: 'moveTo', text: card.text, effect: { targetSpaceId: card.value, targetSpaceName: G.board.spaces[card.value].name, passedGo, goBonus } });
      handleLanding(G, ctx);
      break;
    }
    case 'goToJail':
      sendToJail(G, player);
      // Event-only went_to_jail(reason:'card'): unlike the space-landing
      // goToJail (handleLanding), the pre-migration code never pushed a "Go
      // to Jail!" message for this card action (confirmed against the
      // golden jail-cycle fixture — only the CHANCE draw line appears), so
      // the formatter returns null for reason:'card' specifically (checked
      // first, before the other reasons' unconditional text) — no new
      // message, byte-identity preserved, but the jailing is still visible
      // on the event stream. card_applied is data-only for this action
      // (formatter returns null).
      logEvent(G, 'went_to_jail', player.id, { reason: 'card' });
      logEvent(G, 'card_applied', player.id, { deck, cardIndex, action: 'goToJail', text: card.text, effect: {} });
      break;

    // --- Enhanced card actions ---

    case 'payPercent': {
      // Pay X% of total assets
      const assets = getTotalAssets(G, player);
      let amount = Math.floor(assets * card.value / 100);
      if (getPassive(player) === 'financier') {
        amount = Math.floor(amount * (1 - RULES.passives.financier.negativeEventReduction));
        logEvent(G, 'passive_triggered', player.id, { passive: 'financier', effect: 'loss_reduced', amount, context: 'payPercent' });
      }
      player.money -= amount;
      if (RULES.core.freeParkingPot) {
        G.freeParkingPot += amount;
      }
      logEvent(G, 'card_applied', player.id, { deck, cardIndex, action: 'payPercent', text: card.text, effect: { assets, amount, percent: card.value } });
      if (player.money <= 0) {
        handleBankruptcy(G, ctx, player, null);
      }
      break;
    }

    case 'gainAll': {
      // All non-bankrupt players gain money
      G.players.forEach(p => {
        if (!p.bankrupt) {
          p.money += card.value;
        }
      });
      logEvent(G, 'card_applied', player.id, { deck, cardIndex, action: 'gainAll', text: card.text, effect: { amount: card.value } });
      break;
    }

    case 'gainPerProperty': {
      // Gain $X per owned property
      const count = player.properties.length;
      const amount = card.value * count;
      player.money += amount;
      logEvent(G, 'card_applied', player.id, { deck, cardIndex, action: 'gainPerProperty', text: card.text, effect: { count, perProperty: card.value, amount } });
      break;
    }

    case 'freeUpgrade': {
      // Auto-upgrade the cheapest upgradeable property
      const upgradeable = player.properties
        .filter(pid => {
          const sp = G.board.spaces[pid];
          const gk = groupKeyOf(sp);
          if (sp.type !== 'property' || !gk || !G.board.colorGroups[gk]) return false;
          if (!ownsColorGroup(G, player.id, gk)) return false;
          const level = G.buildings[pid] || 0;
          if (level >= RULES.core.maxBuildingLevel) return false;
          const groupIds = G.board.colorGroups[gk];
          if (groupIds.some(id => G.mortgaged[id])) return false;
          const minLevel = Math.min(...groupIds.map(id => G.buildings[id] || 0));
          return level <= minLevel;
        })
        .sort((a, b) => G.board.spaces[a].price - G.board.spaces[b].price);

      if (upgradeable.length > 0) {
        const pid = upgradeable[0];
        const level = (G.buildings[pid] || 0) + 1;
        G.buildings[pid] = level;
        logEvent(G, 'card_applied', player.id, { deck, cardIndex, action: 'freeUpgrade', text: card.text, effect: { outcome: 'upgraded', propertyId: pid, targetSpaceName: G.board.spaces[pid].name, newLevel: level, newLevelName: RULES.buildings.names[level] } });
      } else {
        logEvent(G, 'card_applied', player.id, { deck, cardIndex, action: 'freeUpgrade', text: card.text, effect: { outcome: 'none' } });
      }
      break;
    }

    case 'downgrade': {
      // Downgrade the highest-level building
      const withBuildings = player.properties
        .filter(pid => (G.buildings[pid] || 0) > 0)
        .sort((a, b) => (G.buildings[b] || 0) - (G.buildings[a] || 0));

      if (withBuildings.length > 0) {
        const pid = withBuildings[0];
        G.buildings[pid]--;
        if (G.buildings[pid] === 0) delete G.buildings[pid];
        const newLevel = G.buildings[pid] || 0;
        logEvent(G, 'card_applied', player.id, { deck, cardIndex, action: 'downgrade', text: card.text, effect: { outcome: 'downgraded', propertyId: pid, targetSpaceName: G.board.spaces[pid].name, newLevel, newLevelName: RULES.buildings.names[newLevel] } });
      } else {
        logEvent(G, 'card_applied', player.id, { deck, cardIndex, action: 'downgrade', text: card.text, effect: { outcome: 'none' } });
      }
      break;
    }

    case 'forceBuy': {
      // Force-buy opponent's cheapest property at X% price
      const opponents = G.players.filter(p => p.id !== player.id && !p.bankrupt && p.properties.length > 0);
      if (opponents.length === 0) {
        logEvent(G, 'card_applied', player.id, { deck, cardIndex, action: 'forceBuy', text: card.text, effect: { outcome: 'no_opponents' } });
        break;
      }
      // Find the cheapest property among all opponents
      let cheapestPid = null;
      let cheapestPrice = Infinity;
      let targetOwner = null;
      opponents.forEach(opp => {
        opp.properties.forEach(pid => {
          if (G.board.spaces[pid].price < cheapestPrice) {
            cheapestPrice = G.board.spaces[pid].price;
            cheapestPid = pid;
            targetOwner = opp;
          }
        });
      });

      if (cheapestPid !== null) {
        const cost = Math.floor(cheapestPrice * card.value / 100);
        if (player.money >= cost) {
          player.money -= cost;
          targetOwner.money += cost;
          // Transfer property
          targetOwner.properties = targetOwner.properties.filter(pid => pid !== cheapestPid);
          player.properties.push(cheapestPid);
          G.ownership[cheapestPid] = player.id;
          // Transfer buildings & mortgage status
          logEvent(G, 'card_applied', player.id, { deck, cardIndex, action: 'forceBuy', text: card.text, effect: { outcome: 'bought', propertyId: cheapestPid, targetSpaceName: G.board.spaces[cheapestPid].name, targetOwnerId: targetOwner.id, cost } });
        } else {
          logEvent(G, 'card_applied', player.id, { deck, cardIndex, action: 'forceBuy', text: card.text, effect: { outcome: 'insufficient_funds', cost } });
        }
      }
      break;
    }
  }
}

function checkGameOver(G) {
  // Fallback default keeps manually-constructed test states (no setup) working.
  const v = G.victory || { primary: 'wealth', maxTurns: 0, groupsToWin: RULES.victory.groupsToWin };
  const activePlayers = G.players.filter(p => !p.bankrupt);

  // Last player standing always wins, regardless of primary mode.
  if (activePlayers.length === 1) {
    return { winner: activePlayers[0].id, reason: 'survival', standings: rankStandings(G, activePlayers) };
  }
  if (activePlayers.length === 0) return undefined;

  // Dominion: first to own `groupsToWin` full groups wins instantly.
  // Accept both the classic UI/rules name ('monopoly') and the atlas winPaths
  // name ('dominion') — same concept, two vocabularies.
  if (v.primary === 'monopoly' || v.primary === 'dominion') {
    const need = v.groupsToWin || RULES.victory.groupsToWin;
    const achievers = activePlayers.filter(p => countFullGroups(G, p.id) >= need);
    if (achievers.length > 0) {
      const ranked = rankStandings(G, achievers); // tie → higher net worth
      return { winner: ranked[0].id, reason: 'dominion', standings: rankStandings(G, activePlayers) };
    }
  }

  // Turn cap: session/map victory.maxTurns overrides the global core.maxTurns.
  const turnLimit = v.maxTurns > 0 ? v.maxTurns : RULES.core.maxTurns;
  if (turnLimit > 0 && G.totalTurns >= turnLimit) {
    const standings = rankStandings(G, activePlayers);
    return { winner: standings[0].id, reason: 'maxTurns', standings };
  }
  return undefined;
}

// --- Auction helpers ---
//
// Both take (G, ctx) — ctx is needed to queue the seat envelope on rotation/
// exit (Task 9). All call sites updated. `ctx` is always in scope at every
// call site (move bodies and handleBankruptcy all receive it).

function advanceAuction(G, ctx) {
  const auction = G.auction;
  let nextIndex = auction.currentBidderIndex;
  const total = auction.bidders.length;

  for (let i = 0; i < total; i++) {
    nextIndex = (nextIndex + 1) % total;
    const bidder = auction.bidders[nextIndex];
    // Skip both players who have passed AND players who have since gone
    // bankrupt (Task 9 interleaving fix — bankruptcy can happen mid-auction
    // via useReroll; a bankrupt bidder can no longer bid/pass).
    if (!bidder.passed && !G.players[bidder.playerId].bankrupt) {
      // Check if this is the current highest bidder (auction complete)
      if (bidder.playerId === auction.currentBidder) {
        resolveAuction(G, ctx);
        return;
      }
      auction.currentBidderIndex = nextIndex;
      logEvent(G, 'auction_turn', null, { bidderId: bidder.playerId });
      if (G.enforceSeats) {
        ctx.events.setActivePlayers({ value: { [bidder.playerId]: Stage.NULL } });
      }
      return;
    }
  }

  // All passed (or skipped as bankrupt)
  if (auction.currentBidder !== null) {
    resolveAuction(G, ctx);
  } else {
    logEvent(G, 'auction_ended', null, { propertyId: auction.propertyId, winnerId: null, amount: null });
    G.auction = null;
    G.turnPhase = 'done';
    if (G.enforceSeats) {
      ctx.events.setActivePlayers({ currentPlayer: Stage.NULL });
    }
  }
}

function resolveAuction(G, ctx) {
  const auction = G.auction;
  const winner = G.players[auction.currentBidder];

  // Defensive second layer (Task 9 interleaving guard): a bankrupt player must
  // never receive the property or have their (already-zeroed) money driven
  // further negative. handleBankruptcy clears auction.currentBidder the
  // instant its owner goes bankrupt, so `winner` should never be missing or
  // bankrupt here — this guard exists purely so a future call site that skips
  // that cleanup can't corrupt state. Falls back to the same no-winner outcome
  // already used elsewhere (advanceAuction's all-passed branch, passAuction's
  // zero-active-bidders branch) — no new message shape.
  // Also guards a MERELY-POORER (not bankrupt) high bidder (final-review
  // Fix 2): money can drop below the standing winning bid between placeBid
  // and resolve (e.g. useReroll's salary-refund clawback) without crossing
  // into bankruptcy. Same fallback: no winner, property stays unowned.
  if (!winner || winner.bankrupt || winner.money < auction.currentBid) {
    logEvent(G, 'auction_ended', null, { propertyId: auction.propertyId, winnerId: null, amount: null });
    G.auction = null;
    G.turnPhase = 'done';
    if (G.enforceSeats) {
      ctx.events.setActivePlayers({ currentPlayer: Stage.NULL });
    }
    return;
  }

  winner.money -= auction.currentBid;
  winner.properties.push(auction.propertyId);
  G.ownership[auction.propertyId] = auction.currentBidder;
  logEvent(G, 'auction_ended', null, { propertyId: auction.propertyId, winnerId: auction.currentBidder, amount: auction.currentBid });
  G.auction = null;
  G.turnPhase = 'done';
  if (G.enforceSeats) {
    ctx.events.setActivePlayers({ currentPlayer: Stage.NULL });
  }
}

// --- Roll / movement helpers (shared by rollDice / rollOnly / commitRoute) ---

// Roll + resolve triple-doubles + jail. Shared by rollDice / rollOnly.
// Returns 'done' (turn ends here, no movement) or 'move' (proceed to movement).
function rollAndResolveJail(G, ctx) {
  const player = G.players[ctx.currentPlayer];
  const dice = rollTwoDice(ctx);
  dice.preRollPosition = player.position;
  dice.preRollDistance = player.distanceTraveled || 0;
  dice.salaryCollected = 0;
  G.lastDice = dice;
  G.hasRolled = true;
  resetMessages(G);
  logEvent(G, 'dice_rolled', ctx.currentPlayer, { d1: dice.d1, d2: dice.d2, total: dice.total, doubles: dice.isDoubles });

  if (dice.isDoubles) {
    G.doublesCount++;
    if (G.doublesCount >= RULES.core.doublesJailThreshold) {
      sendToJail(G, player);
      logEvent(G, 'went_to_jail', ctx.currentPlayer, { reason: 'triples' });
      G.turnPhase = 'done';
      return 'done';
    }
  } else {
    G.doublesCount = 0;
  }

  if (player.inJail) {
    if (dice.isDoubles) {
      player.inJail = false;
      player.jailTurns = 0;
      logEvent(G, 'left_jail', ctx.currentPlayer, { how: 'doubles' });
    } else {
      player.jailTurns++;
      if (player.jailTurns >= RULES.core.jailMaxTurns) {
        player.money -= RULES.core.jailFine;
        player.inJail = false;
        player.jailTurns = 0;
        logEvent(G, 'left_jail', ctx.currentPlayer, { how: 'served', maxTurns: RULES.core.jailMaxTurns, fine: RULES.core.jailFine });
        if (player.money <= 0) {
          handleBankruptcy(G, ctx, player, null);
          G.turnPhase = 'done';
          return 'done';
        }
      } else {
        logEvent(G, 'jail_wait', ctx.currentPlayer, { turn: player.jailTurns, maxTurns: RULES.core.jailMaxTurns });
        G.turnPhase = 'done';
        return 'done';
      }
    }
  }
  return 'move';
}

// Movement + landing. atlas: walk `route` (undefined = auto first-edge); loop:
// modulo + pass-GO salary. Returns false only on an invalid atlas route.
function performMove(G, ctx, route) {
  const player = G.players[ctx.currentPlayer];
  const dice = G.lastDice;
  let passedGo = false;
  if (G.board.movementMode === 'atlas') {
    if (!atlasWalk(G, player, dice, route)) return false;
  } else {
    const oldPos = player.position;
    player.position = (player.position + dice.total) % G.board.boardSize;
    // `|| 0` tolerates pre-branch saves where the field doesn't exist.
    player.distanceTraveled = (player.distanceTraveled || 0) + dice.total;

    if (player.position < oldPos && G.board.spaces[player.position].type !== 'goToJail') {
      passedGo = true;
      let goBonus = Math.floor(applyEconMods(G, 'income', RULES.core.goSalary));
      // Mira Dawnlight passive: GO bonus
      if (getPassive(player) === 'idealist') {
        goBonus += RULES.passives.idealist.goBonus;
        logEvent(G, 'passive_triggered', ctx.currentPlayer, { passive: 'idealist', effect: 'go_bonus', amount: RULES.passives.idealist.goBonus, context: 'go' });
      }
      player.money += goBonus;
      G.lastDice.salaryCollected = goBonus;
      logEvent(G, 'salary_collected', ctx.currentPlayer, { source: 'go', amount: goBonus });
    }
  }

  logEvent(G, 'moved', ctx.currentPlayer, { from: dice.preRollPosition, to: player.position, passedGo });
  handleLanding(G, ctx);

  // Set turnPhase based on what happened
  if (G.turnPhase !== 'card' && G.turnPhase !== 'duel') {
    G.turnPhase = G.canBuy ? 'act' : 'done';
  }
  return true;
}

// --- Game definition ---

// Production fix (client:false on every move): v0.45's client-side reducer
// (reducer-763b001e.js MAKE_MOVE case) checks `isPlayerActive` and runs the
// move body BEFORE relaying to the master. When a client-side move is
// rejected there — by our own `requireActor` INVALID_MOVE or by
// boardgame.io's structural isPlayerActive gate — the client sets a
// transient error (WithError). TransientHandlingMiddleware reacts by
// internally dispatching a payload-less STRIP_TRANSIENTS action; that action
// has no `clientOnly` marker, so TransportMiddleware relays it to the
// master like a real move. Master.onUpdate's stripCredentialsFromAction then
// unconditionally destructures `action.payload` (undefined) and throws —
// inside an async fn, so it surfaces as an unhandled promise rejection that
// aborts the match's onUpdate (no broadcast, no persist; the client just
// hangs). The reducer's own long-form skip check —
// `if (isClient && move.client === false) return state;` (L984) — runs
// BEFORE the client-side isPlayerActive check and the move body, so a move
// flagged this way never sets a client-side transient and the
// STRIP_TRANSIENTS relay never happens.
//
// Implementation note: the canonical long-form shape is a wrapper object
// (`{ move: fn, client: false }`), but this codebase's ~280 existing unit
// tests (Game.test.js, atlas-engine.test.js, engine-events-emit.test.js,
// engine-seats-unit.test.js) call `Monopoly.moves.someMove(G, ctx, ...)`
// DIRECTLY as a function — bypassing boardgame.io's Client()/reducer
// entirely. Wrapping in a plain object breaks every one of those call
// sites (confirmed by trying it: 242 failures across 4 files —
// "X is not a function"). Instead, this attaches the long-form markers
// directly ONTO each move function: `fn.move = fn` (self-reference) and
// `fn.client = false`. A function IS an `Object` in JS, so this satisfies
// boardgame.io's own duck-typing identically to the wrapper shape:
//   - `IsLongFormMove(move)` = `move instanceof Object && move.move !==
//     undefined` (L745-747) — true for a decorated function.
//   - `GetMove` (L486-513) returns whatever was stored in `moves[name]`
//     verbatim, no typeof branching.
//   - `game.processMove`'s `IsLongFormMove(moveFn) ? moveFn.move : moveFn`
//     (L725-727) resolves to the SAME function reference either way (since
//     `fn.move === fn`), then calls it as normal.
// Net effect: `Monopoly.moves.someMove` is still the exact same callable
// function (existing direct-call tests are unaffected), while
// boardgame.io's dispatch path sees a legitimate long-form move and applies
// the client-skip short-circuit. The master is unaffected either way:
// `isClient` is false there. Hot-seat is unaffected too: a `Client()` with
// no `multiplayer` transport has `isClient: false` (client-5202a476.js
// L228), so the short-circuit condition is never true and every move runs
// exactly as it did before this change (verified: full suite green, see
// task-10-report.md "PRODUCTION FINDING").
function withClientFalse(moves) {
  for (const name in moves) {
    const fn = moves[name];
    fn.client = false;
    fn.move = fn;
  }
  return moves;
}

export const Monopoly = {
  name: 'monopoly',

  setup: (ctx, setupData) => {
    const players = [];
    for (let i = 0; i < ctx.numPlayers; i++) {
      players.push(createPlayer(String(i)));
    }

    const ownership = {};
    _pendingMap.spaces.forEach(space => {
      if (space.type === 'property' || space.type === 'railroad' || space.type === 'utility') {
        ownership[space.id] = null;
      }
    });

    return {
      board: {
        spaces: _pendingMap.spaces,
        colorGroups: _pendingMap.colorGroups,
        chanceCards: _pendingMap.chanceCards,
        communityCards: _pendingMap.communityCards,
        boardSize: _pendingMap.boardSize,
        jail: _pendingMap.jail,
        mapMechanics: _pendingMap.mapMechanics,
        movementMode: _pendingMap.movementMode,
        edges: _pendingMap.edges,
        hubs: _pendingMap.hubs,
        traits: _pendingMap.traits,
        winPaths: _pendingMap.winPaths,
      },
      players,
      ownership,
      buildings: {},
      mortgaged: {},
      lastDice: null,
      hasRolled: false,
      awaitingRoute: false,
      canBuy: false,
      effectivePrice: 0,
      messages: ['Select your characters!'],
      turnPhase: 'roll',
      phase: 'characterSelect',
      pendingCard: null,
      doublesCount: 0,
      seasonIndex: 0,
      totalTurns: 0,
      trade: null,
      auction: null,
      duel: null,
      freeParkingPot: 0,
      victory: resolveVictory(),
      _resumeLoad: false, // one-shot: set true by loadGame so the first onBegin doesn't bump turn/season
      events: [],   // typed engine event log — see src/events.js (logEvent/resetMessages)
      eventSeq: 0,  // monotonic sequence counter for G.events, never reset in a match
      // Seat enforcement toggle: online matches opt in via createMatch's
      // setupData (src/Lobby.js); hot-seat Client() has no setupData channel,
      // so setupData is always undefined there and this is always false —
      // guards are inert (see requireActor above).
      enforceSeats: !!(setupData && setupData.enforceSeats),
    };
  },

  turn: {
    onBegin: (G, ctx) => {
      if (G.phase === 'characterSelect') return;
      G.hasRolled = false;
      G.awaitingRoute = false;
      G.canBuy = false;
      G.effectivePrice = 0;
      G.turnPhase = 'roll';
      G.lastDice = null;
      G.pendingCard = null;
      G.doublesCount = 0;

      // Track total turns and advance season. Skipped once after a load (loadGame sets
      // G._resumeLoad) so resuming a saved game doesn't bump the turn counter or flip the season —
      // the loaded board/money/ownership is preserved and play continues with a clean fresh turn.
      if (G._resumeLoad) {
        G._resumeLoad = false;
      } else {
        G.totalTurns++;
        const newSeasonIndex = Math.floor(G.totalTurns / RULES.seasons.changeInterval) % RULES.seasons.list.length;
        if (newSeasonIndex !== G.seasonIndex) {
          G.seasonIndex = newSeasonIndex;
          const season = RULES.seasons.list[G.seasonIndex];
          logEvent(G, 'season_changed', null, { seasonIndex: G.seasonIndex, seasonName: season.name });
        }
      }

      const player = G.players[ctx.currentPlayer];
      if (player.bankrupt) return;
      if (player.inJail) {
        logEvent(G, 'jail_reminder', ctx.currentPlayer, { fine: RULES.core.jailFine });
      }
    },
  },

  moves: withClientFalse({
    // --- Character selection ---
    selectCharacter: (G, ctx, characterId) => {
      if (!requireActor(G, ctx, ctx.currentPlayer)) return INVALID_MOVE;
      if (G.phase !== 'characterSelect') return INVALID_MOVE;

      const char = _activeMod.getCharacterById(characterId);
      if (!char) return INVALID_MOVE;

      // Check not already taken
      if (G.players.some(p => p.character && p.character.id === characterId)) return INVALID_MOVE;

      const player = G.players[ctx.currentPlayer];
      if (player.character) return INVALID_MOVE; // Already selected

      player.character = char;
      player.money = _activeMod.getStartingMoney(char);

      // Map affinity: one-time, stat-scaled head start on a traits (atlas) map.
      const affinityBonus = computeAffinityBonus(char, G.board.traits);
      if (affinityBonus > 0) {
        player.money += affinityBonus;
        player.affinityBonus = affinityBonus;
      }

      // Luck stat threshold: free card redraws
      if (char.stats.luck >= RULES.stats.luck.redrawThreshold) {
        player.luckRedraws = RULES.stats.luck.redrawCount;
      }
      // Evelyn Zero passive: additional redraws
      if (char.passive.id === 'speculator') {
        player.luckRedraws += RULES.passives.speculator.extraRedraws;
      }
      // Stamina stat threshold: free rerolls
      if (char.stats.stamina >= RULES.stats.stamina.rerollThreshold) {
        player.rerollsLeft = RULES.stats.stamina.rerollCount;
      }

      logEvent(G, 'character_selected', player.id, { characterId, money: player.money, affinityBonus });

      // Check if all players have selected
      const allSelected = G.players.every(p => p.character !== null);
      if (allSelected) {
        G.phase = 'play';
        resetMessages(G);
        logEvent(G, 'character_selected', null, { allSelected: true });
      }

      ctx.events.endTurn();
    },

    // --- Dice ---
    // Atomic roll → move. Loop maps use this; atlas auto-routes (no `route` arg
    // → first-edge walk). Body is rollAndResolveJail + performMove — identical
    // behavior to the pre-split version (the 381-test baseline is the proof).
    rollDice: (G, ctx, route) => {
      if (!requireActor(G, ctx, ctx.currentPlayer)) return INVALID_MOVE;
      if (G.phase !== 'play') return INVALID_MOVE;
      if (G.hasRolled) return INVALID_MOVE;
      if (G.players[ctx.currentPlayer].bankrupt) return INVALID_MOVE;
      if (rollAndResolveJail(G, ctx) === 'move') {
        if (!performMove(G, ctx, route)) return INVALID_MOVE;
      }
    },

    // Atlas: roll, resolve jail/doubles, then PAUSE for route choice (D11).
    rollOnly: (G, ctx) => {
      if (!requireActor(G, ctx, ctx.currentPlayer)) return INVALID_MOVE;
      if (G.phase !== 'play') return INVALID_MOVE;
      if (G.hasRolled) return INVALID_MOVE;
      if (G.players[ctx.currentPlayer].bankrupt) return INVALID_MOVE;
      if (rollAndResolveJail(G, ctx) === 'move') {
        if (G.board.movementMode === 'atlas') {
          G.awaitingRoute = true;
          G.turnPhase = 'route';
        } else {
          performMove(G, ctx, undefined); // loop: no route choice
        }
      }
    },

    // Commit the player's chosen whole route (atlas). Validated by performMove.
    commitRoute: (G, ctx, route) => {
      if (!requireActor(G, ctx, ctx.currentPlayer)) return INVALID_MOVE;
      if (G.phase !== 'play') return INVALID_MOVE;
      if (G.players[ctx.currentPlayer].bankrupt) return INVALID_MOVE;
      if (!G.awaitingRoute) return INVALID_MOVE;
      if (!performMove(G, ctx, route)) return INVALID_MOVE; // bad route → draft discarded
      G.awaitingRoute = false;
    },


    // --- Reroll (Stamina ability) ---
    useReroll: (G, ctx) => {
      if (!requireActor(G, ctx, ctx.currentPlayer)) return INVALID_MOVE;
      if (G.duel) return INVALID_MOVE;
      if (G.phase !== 'play') return INVALID_MOVE;
      if (!G.hasRolled) return INVALID_MOVE;
      const player = G.players[ctx.currentPlayer];
      if (player.rerollsLeft <= 0) return INVALID_MOVE;
      if (G.canBuy || G.pendingCard) return INVALID_MOVE; // Can't reroll after buying or during card

      // Reset state for re-roll
      player.rerollsLeft--;
      G.hasRolled = false;
      G.awaitingRoute = false;
      G.canBuy = false;
      G.turnPhase = 'roll';

      // Restore the preRoll snapshot: position, salary collected, distance.
      if (G.lastDice) {
        if (G.lastDice.preRollPosition !== undefined) {
          player.position = G.lastDice.preRollPosition;
        }
        if (G.lastDice.preRollDistance !== undefined) {
          player.distanceTraveled = G.lastDice.preRollDistance;
        }
        if (G.lastDice.salaryCollected) {
          player.money -= G.lastDice.salaryCollected;
          // The refund is a money subtraction like any other — a player who
          // spent the salary (e.g. on rent) can be wiped out by taking it back.
          if (player.money <= 0) {
            handleBankruptcy(G, ctx, player, null);
          }
        }
      }
      G.lastDice = null;
      logEvent(G, 'reroll_used', ctx.currentPlayer, { rerollsLeft: player.rerollsLeft });
    },

    // --- Card accept/redraw ---
    acceptCard: (G, ctx) => {
      if (!requireActor(G, ctx, ctx.currentPlayer)) return INVALID_MOVE;
      if (!G.pendingCard) return INVALID_MOVE;
      const player = G.players[ctx.currentPlayer];
      const { card, deck, cardIndex } = G.pendingCard;
      G.pendingCard = null;
      // acceptCard itself never had a message of its own (pre-migration) —
      // only applyCard's card_applied event/message follows.
      applyCard(G, ctx, player, card, deck, cardIndex);
      // applyCard can chain a NEW pending card (atlas moveTo onto a card
      // space) — don't clobber it or the card phase.
      if (G.turnPhase !== 'card' && G.turnPhase !== 'duel') {
        G.turnPhase = G.canBuy ? 'act' : 'done';
      }
    },

    redrawCard: (G, ctx) => {
      if (!requireActor(G, ctx, ctx.currentPlayer)) return INVALID_MOVE;
      if (!G.pendingCard) return INVALID_MOVE;
      const player = G.players[ctx.currentPlayer];

      // Cassian (merchant) has unlimited redraws, others consume luckRedraws
      if (getPassive(player) !== 'merchant') {
        if (player.luckRedraws <= 0) return INVALID_MOVE;
        player.luckRedraws--;
      }

      const deckId = G.pendingCard.deck;
      const deck = deckId === 'chance' ? G.board.chanceCards : G.board.communityCards;
      G.pendingCard = null;
      const { card: newCard, index: cardIndex } = drawCard(ctx, deck);
      logEvent(G, 'card_redrawn', player.id, { deck: deckId, newText: newCard.text });
      applyCard(G, ctx, player, newCard, deckId, cardIndex);
      // applyCard can chain a NEW pending card (atlas moveTo onto a card
      // space) — don't clobber it or the card phase.
      if (G.turnPhase !== 'card' && G.turnPhase !== 'duel') {
        G.turnPhase = G.canBuy ? 'act' : 'done';
      }
    },

    // --- Knox: Regulate property ---
    regulateProperty: (G, ctx, propertyId) => {
      if (!requireActor(G, ctx, ctx.currentPlayer)) return INVALID_MOVE;
      if (G.duel) return INVALID_MOVE;
      if (G.phase !== 'play') return INVALID_MOVE;
      const player = G.players[ctx.currentPlayer];
      if (getPassive(player) !== 'enforcer') return INVALID_MOVE;

      // Must own the property
      if (G.ownership[propertyId] !== ctx.currentPlayer) return INVALID_MOVE;
      // Can only regulate one at a time
      player.regulatedProperty = propertyId;
      logEvent(G, 'property_regulated', ctx.currentPlayer, { propertyId });
    },

    // --- Property upgrades ---
    upgradeProperty: (G, ctx, propertyId) => {
      if (!requireActor(G, ctx, ctx.currentPlayer)) return INVALID_MOVE;
      if (G.duel) return INVALID_MOVE;
      if (G.phase !== 'play') return INVALID_MOVE;
      if (!G.hasRolled) return INVALID_MOVE;

      const player = G.players[ctx.currentPlayer];
      const space = G.board.spaces[propertyId];

      if (!space || space.type !== 'property') return INVALID_MOVE;
      if (G.ownership[propertyId] !== ctx.currentPlayer) return INVALID_MOVE;
      const gk = groupKeyOf(space);
      if (!gk || !ownsColorGroup(G, ctx.currentPlayer, gk)) return INVALID_MOVE;

      // No mortgaged properties in group
      const groupIds = G.board.colorGroups[gk];
      if (groupIds.some(id => G.mortgaged[id])) return INVALID_MOVE;

      const currentLevel = G.buildings[propertyId] || 0;
      if (currentLevel >= RULES.core.maxBuildingLevel) return INVALID_MOVE;

      // Even building: can only upgrade if at minimum level in group
      const minLevel = Math.min(...groupIds.map(id => G.buildings[id] || 0));
      if (currentLevel > minLevel) return INVALID_MOVE;

      const targetLevel = currentLevel + 1;
      const cost = getUpgradeCost(G, player, space, targetLevel);
      if (player.money < cost) return INVALID_MOVE;

      player.money -= cost;
      G.buildings[propertyId] = targetLevel;
      logEvent(G, 'property_upgraded', ctx.currentPlayer, { propertyId, newLevel: targetLevel, newLevelName: RULES.buildings.names[targetLevel], cost });
    },

    mortgageProperty: (G, ctx, propertyId) => {
      if (!requireActor(G, ctx, ctx.currentPlayer)) return INVALID_MOVE;
      if (G.duel) return INVALID_MOVE;
      if (G.phase !== 'play') return INVALID_MOVE;

      const player = G.players[ctx.currentPlayer];
      const space = G.board.spaces[propertyId];
      if (!space) return INVALID_MOVE;

      if (G.ownership[propertyId] !== ctx.currentPlayer) return INVALID_MOVE;
      if (G.mortgaged[propertyId]) return INVALID_MOVE;

      // Can't mortgage property with buildings
      if ((G.buildings[propertyId] || 0) > 0) return INVALID_MOVE;

      // Can't mortgage if any property in color group has buildings
      const gk = groupKeyOf(space);
      if (gk && G.board.colorGroups[gk]) {
        if (G.board.colorGroups[gk].some(id => (G.buildings[id] || 0) > 0)) {
          return INVALID_MOVE;
        }
      }

      G.mortgaged[propertyId] = true;
      const mortgageValue = Math.floor(applyEconMods(G, 'price', space.price * RULES.core.mortgageRate));
      player.money += mortgageValue;
      logEvent(G, 'property_mortgaged', ctx.currentPlayer, { propertyId, amount: mortgageValue });
    },

    unmortgageProperty: (G, ctx, propertyId) => {
      if (!requireActor(G, ctx, ctx.currentPlayer)) return INVALID_MOVE;
      if (G.duel) return INVALID_MOVE;
      if (G.phase !== 'play') return INVALID_MOVE;

      const player = G.players[ctx.currentPlayer];
      const space = G.board.spaces[propertyId];
      if (!space) return INVALID_MOVE;

      if (G.ownership[propertyId] !== ctx.currentPlayer) return INVALID_MOVE;
      if (!G.mortgaged[propertyId]) return INVALID_MOVE;

      const unmortgageCost = Math.floor(applyEconMods(G, 'price', space.price * RULES.core.unmortgageRate));
      if (player.money < unmortgageCost) return INVALID_MOVE;

      player.money -= unmortgageCost;
      G.mortgaged[propertyId] = false;
      logEvent(G, 'property_unmortgaged', ctx.currentPlayer, { propertyId, cost: unmortgageCost });
    },

    sellBuilding: (G, ctx, propertyId) => {
      if (!requireActor(G, ctx, ctx.currentPlayer)) return INVALID_MOVE;
      if (G.duel) return INVALID_MOVE;
      if (G.phase !== 'play') return INVALID_MOVE;
      if (!G.hasRolled) return INVALID_MOVE;

      const player = G.players[ctx.currentPlayer];
      const space = G.board.spaces[propertyId];

      if (!space || space.type !== 'property') return INVALID_MOVE;
      if (G.ownership[propertyId] !== ctx.currentPlayer) return INVALID_MOVE;

      const currentLevel = G.buildings[propertyId] || 0;
      if (currentLevel <= 0) return INVALID_MOVE;

      // Even building in reverse: can only sell from highest level in group
      const gk = groupKeyOf(space);
      if (gk && G.board.colorGroups[gk]) {
        const groupIds = G.board.colorGroups[gk];
        const maxLevel = Math.max(...groupIds.map(id => G.buildings[id] || 0));
        if (currentLevel < maxLevel) return INVALID_MOVE;
      }

      // Refund = upgrade cost for this level * sellbackRate
      const refund = Math.floor(getUpgradeCost(G, player, space, currentLevel) * RULES.buildings.sellbackRate);

      G.buildings[propertyId] = currentLevel - 1;
      if (G.buildings[propertyId] === 0) delete G.buildings[propertyId];
      player.money += refund;

      const newLevel = G.buildings[propertyId] || 0;
      logEvent(G, 'building_sold', ctx.currentPlayer, { propertyId, newLevel, refund });
    },

    // --- Buy property ---
    buyProperty: (G, ctx) => {
      if (!requireActor(G, ctx, ctx.currentPlayer)) return INVALID_MOVE;
      if (!G.canBuy) return INVALID_MOVE;
      const player = G.players[ctx.currentPlayer];
      const space = G.board.spaces[player.position];

      const effectivePrice = G.effectivePrice || getEffectiveBuyPrice(G, player, space);
      if (player.money < effectivePrice) return INVALID_MOVE;
      if (G.ownership[space.id] !== null) return INVALID_MOVE;

      player.money -= effectivePrice;
      player.properties.push(space.id);
      G.ownership[space.id] = ctx.currentPlayer;
      G.canBuy = false;
      G.effectivePrice = 0;
      logEvent(G, 'property_bought', ctx.currentPlayer, { propertyId: space.id, listPrice: space.price, paidPrice: effectivePrice });
      G.turnPhase = 'done';
    },

    passProperty: (G, ctx) => {
      if (!requireActor(G, ctx, ctx.currentPlayer)) return INVALID_MOVE;
      if (!G.canBuy) return INVALID_MOVE;
      G.canBuy = false;
      G.effectivePrice = 0;

      const player = G.players[ctx.currentPlayer];
      const space = G.board.spaces[player.position];

      if (RULES.auction.enabled && RULES.auction.auctionOnPass) {
        const activeBidders = G.players
          .filter(p => !p.bankrupt)
          .map(p => ({ playerId: p.id, passed: false }));

        if (activeBidders.length > 0) {
          G.auction = {
            propertyId: space.id,
            currentBid: 0,
            currentBidder: null,
            bidders: activeBidders,
            currentBidderIndex: 0,
          };
          G.turnPhase = 'auction';
          logEvent(G, 'auction_started', null, { propertyId: space.id, bidders: activeBidders.map(b => b.playerId) });
          logEvent(G, 'auction_turn', null, { bidderId: activeBidders[0].playerId });
          if (G.enforceSeats) {
            ctx.events.setActivePlayers({ value: { [activeBidders[0].playerId]: Stage.NULL } });
          }
          return;
        }
      }

      logEvent(G, 'property_passed', ctx.currentPlayer, { propertyId: space.id });
      G.turnPhase = 'done';
    },

    payJailFine: (G, ctx) => {
      if (!requireActor(G, ctx, ctx.currentPlayer)) return INVALID_MOVE;
      if (G.phase !== 'play') return INVALID_MOVE;
      const player = G.players[ctx.currentPlayer];
      if (!player.inJail) return INVALID_MOVE;
      if (G.hasRolled) return INVALID_MOVE;

      // No logEvent here (final-review Fix 4): INVALID_MOVE discards every
      // mutation this move made, including a logEvent push onto G.events/
      // G.messages — the pre-migration code never had a G.messages site on
      // this branch either (bgio's INVALID_MOVE handling always dropped it),
      // so the event was never actually observable. Emitting-then-discarding
      // was dead weight, not parity.
      if (player.money < RULES.core.jailFine) {
        return INVALID_MOVE;
      }

      player.money -= RULES.core.jailFine;
      player.inJail = false;
      player.jailTurns = 0;
      resetMessages(G);
      logEvent(G, 'jail_fine_paid', ctx.currentPlayer, { fine: RULES.core.jailFine });
    },

    // --- Trading ---
    proposeTrade: (G, ctx, proposal) => {
      if (!requireActor(G, ctx, ctx.currentPlayer)) return INVALID_MOVE;
      if (G.duel) return INVALID_MOVE;
      if (G.phase !== 'play') return INVALID_MOVE;
      if (!RULES.trading.enabled) return INVALID_MOVE;
      if (!G.hasRolled) return INVALID_MOVE;
      if (G.canBuy || G.pendingCard || G.auction) return INVALID_MOVE;
      if (G.trade) return INVALID_MOVE;
      // Route-stomping hole (Task 9): proposing mid-route-choice (atlas) would
      // silently clobber turnPhase and skip the pending movement entirely.
      if (G.awaitingRoute) return INVALID_MOVE;

      const player = G.players[ctx.currentPlayer];
      if (!RULES.trading.canTradeInJail && player.inJail) return INVALID_MOVE;

      const { targetPlayerId, offeredProperties, requestedProperties, offeredMoney, requestedMoney } = proposal;
      const target = G.players[targetPlayerId];
      if (!target || target.bankrupt || targetPlayerId === ctx.currentPlayer) return INVALID_MOVE;

      // Validate offered properties belong to proposer and have no buildings
      if (offeredProperties && offeredProperties.length > 0) {
        for (const pid of offeredProperties) {
          if (G.ownership[pid] !== ctx.currentPlayer) return INVALID_MOVE;
          if ((G.buildings[pid] || 0) > 0) return INVALID_MOVE;
          if (!RULES.trading.allowMortgagedProperties && G.mortgaged[pid]) return INVALID_MOVE;
        }
      }

      // Validate requested properties belong to target and have no buildings
      if (requestedProperties && requestedProperties.length > 0) {
        for (const pid of requestedProperties) {
          if (G.ownership[pid] !== targetPlayerId) return INVALID_MOVE;
          if ((G.buildings[pid] || 0) > 0) return INVALID_MOVE;
          if (!RULES.trading.allowMortgagedProperties && G.mortgaged[pid]) return INVALID_MOVE;
        }
      }

      // Validate money
      if (!RULES.trading.allowMoneyInTrade && ((offeredMoney || 0) > 0 || (requestedMoney || 0) > 0)) return INVALID_MOVE;
      if ((offeredMoney || 0) > player.money) return INVALID_MOVE;
      if ((requestedMoney || 0) > target.money) return INVALID_MOVE;

      G.trade = {
        proposerId: ctx.currentPlayer,
        targetPlayerId,
        offeredProperties: offeredProperties || [],
        requestedProperties: requestedProperties || [],
        offeredMoney: offeredMoney || 0,
        requestedMoney: requestedMoney || 0,
      };
      G.turnPhase = 'trade';
      logEvent(G, 'trade_proposed', ctx.currentPlayer, {
        targetPlayerId: G.trade.targetPlayerId,
        offeredProperties: G.trade.offeredProperties,
        requestedProperties: G.trade.requestedProperties,
        offeredMoney: G.trade.offeredMoney,
        requestedMoney: G.trade.requestedMoney,
      });
      if (G.enforceSeats) {
        ctx.events.setActivePlayers({ value: { [G.trade.targetPlayerId]: Stage.NULL, [G.trade.proposerId]: Stage.NULL } });
      }
    },

    // acceptTrade/rejectTrade are the genuine cross-seat exception: the
    // ACTOR is the trade's target, not ctx.currentPlayer (the proposer is
    // still mid-turn while the target responds).
    acceptTrade: (G, ctx) => {
      if (!G.trade) return INVALID_MOVE;
      if (!requireActor(G, ctx, G.trade.targetPlayerId)) return INVALID_MOVE;

      const { proposerId, targetPlayerId, offeredProperties, requestedProperties, offeredMoney, requestedMoney } = G.trade;
      const proposer = G.players[proposerId];
      const target = G.players[targetPlayerId];

      // Re-validate against CURRENT state (final-review Fix 1): mortgage/
      // unmortgage aren't trade-gated, so between propose and accept either
      // side's money or a traded property's ownership/building/mortgage
      // status can have drifted from the snapshot proposeTrade validated at
      // propose-time. Mirrors proposeTrade's checks exactly, for BOTH sides
      // (ownership, no buildings, mortgage rule per RULES.trading, money >=
      // the amount that side offered). A failure here is treated as an
      // auto-cancel, not INVALID_MOVE: INVALID_MOVE would discard the
      // G.trade = null cleanup along with everything else, stranding the
      // seat envelope on a trade that can never again be accepted, rejected,
      // or cancelled. Payload mirrors cancelTrade's normal-path shape
      // ({targetPlayerId}) plus a reason field, same convention already used
      // by handleBankruptcy's own auto-cancel (reason:'bankruptcy') — the
      // formatter for 'trade_cancelled' is unconditional ('Trade
      // cancelled.') and ignores payload shape entirely, so this stays
      // byte-identical to the normal cancel line by construction.
      const staleTrade =
        offeredProperties.some(pid => G.ownership[pid] !== proposerId || (G.buildings[pid] || 0) > 0 || (!RULES.trading.allowMortgagedProperties && G.mortgaged[pid])) ||
        requestedProperties.some(pid => G.ownership[pid] !== targetPlayerId || (G.buildings[pid] || 0) > 0 || (!RULES.trading.allowMortgagedProperties && G.mortgaged[pid])) ||
        offeredMoney > proposer.money ||
        requestedMoney > target.money;

      if (staleTrade) {
        logEvent(G, 'trade_cancelled', proposerId, { targetPlayerId, reason: 'stale' });
        G.trade = null;
        G.turnPhase = 'done';
        if (G.enforceSeats) {
          ctx.events.setActivePlayers({ currentPlayer: Stage.NULL });
        }
        return;
      }

      // Transfer offered properties (proposer → target)
      for (const pid of offeredProperties) {
        proposer.properties = proposer.properties.filter(p => p !== pid);
        target.properties.push(pid);
        G.ownership[pid] = targetPlayerId;
      }

      // Transfer requested properties (target → proposer)
      for (const pid of requestedProperties) {
        target.properties = target.properties.filter(p => p !== pid);
        proposer.properties.push(pid);
        G.ownership[pid] = proposerId;
      }

      // Transfer money
      if (offeredMoney > 0) {
        proposer.money -= offeredMoney;
        target.money += offeredMoney;
      }
      if (requestedMoney > 0) {
        target.money -= requestedMoney;
        proposer.money += requestedMoney;
      }

      logEvent(G, 'trade_accepted', targetPlayerId, { proposerId });
      G.trade = null;
      G.turnPhase = 'done';
      if (G.enforceSeats) {
        ctx.events.setActivePlayers({ currentPlayer: Stage.NULL });
      }
    },

    rejectTrade: (G, ctx) => {
      if (!G.trade) return INVALID_MOVE;
      if (!requireActor(G, ctx, G.trade.targetPlayerId)) return INVALID_MOVE;
      const { proposerId, targetPlayerId } = G.trade;
      logEvent(G, 'trade_rejected', targetPlayerId, { proposerId });
      G.trade = null;
      G.turnPhase = 'done';
      if (G.enforceSeats) {
        ctx.events.setActivePlayers({ currentPlayer: Stage.NULL });
      }
    },

    cancelTrade: (G, ctx) => {
      if (!requireActor(G, ctx, ctx.currentPlayer)) return INVALID_MOVE;
      if (!G.trade) return INVALID_MOVE;
      if (G.trade.proposerId !== ctx.currentPlayer) return INVALID_MOVE;
      logEvent(G, 'trade_cancelled', ctx.currentPlayer, { targetPlayerId: G.trade.targetPlayerId });
      G.trade = null;
      G.turnPhase = 'done';
      if (G.enforceSeats) {
        ctx.events.setActivePlayers({ currentPlayer: Stage.NULL });
      }
    },

    // --- Auctions ---
    // placeBid/passAuction are the other genuine cross-seat exception: the
    // ACTOR is whichever bidder is currently on the clock (bidder rotation is
    // independent of ctx.currentPlayer — the property's original owner stays
    // ctx.currentPlayer for the whole auction).
    placeBid: (G, ctx, amount) => {
      if (!G.auction) return INVALID_MOVE;
      if (!requireActor(G, ctx, G.auction.bidders[G.auction.currentBidderIndex].playerId)) return INVALID_MOVE;

      const auction = G.auction;
      const bidderEntry = auction.bidders[auction.currentBidderIndex];
      const player = G.players[bidderEntry.playerId];

      // Validate bid
      const minBid = auction.currentBid === 0
        ? RULES.auction.startingBid
        : auction.currentBid + RULES.auction.minimumIncrement;
      if (amount < minBid) return INVALID_MOVE;
      if (amount > player.money) return INVALID_MOVE;

      auction.currentBid = amount;
      auction.currentBidder = bidderEntry.playerId;
      logEvent(G, 'bid_placed', bidderEntry.playerId, { propertyId: auction.propertyId, amount });

      // Advance to next bidder
      advanceAuction(G, ctx);
    },

    passAuction: (G, ctx) => {
      if (!G.auction) return INVALID_MOVE;
      if (!requireActor(G, ctx, G.auction.bidders[G.auction.currentBidderIndex].playerId)) return INVALID_MOVE;

      const auction = G.auction;
      const bidderEntry = auction.bidders[auction.currentBidderIndex];

      bidderEntry.passed = true;
      logEvent(G, 'auction_passed', bidderEntry.playerId, { propertyId: auction.propertyId });

      // Check if auction is over
      const activeBidders = auction.bidders.filter(b => !b.passed);
      if (activeBidders.length <= 1 && auction.currentBidder !== null) {
        resolveAuction(G, ctx);
      } else if (activeBidders.length === 0) {
        // Everyone passed with no bids
        logEvent(G, 'auction_ended', null, { propertyId: auction.propertyId, winnerId: null, amount: null });
        G.auction = null;
        G.turnPhase = 'done';
        if (G.enforceSeats) {
          ctx.events.setActivePlayers({ currentPlayer: Stage.NULL });
        }
      } else {
        advanceAuction(G, ctx);
      }
    },

    endTurn: (G, ctx) => {
      if (!requireActor(G, ctx, ctx.currentPlayer)) return INVALID_MOVE;
      if (G.duel) return INVALID_MOVE;
      if (G.phase === 'characterSelect') return INVALID_MOVE;
      if (!G.hasRolled) return INVALID_MOVE;
      if (G.canBuy) return INVALID_MOVE;
      if (G.pendingCard) return INVALID_MOVE;
      if (G.trade) return INVALID_MOVE;
      if (G.auction) return INVALID_MOVE;
      G.turnPhase = 'roll';
      ctx.events.endTurn();
    },
  }),

  endIf: (G, ctx) => {
    if (G.phase !== 'play') return undefined;
    return checkGameOver(G);
  },

  // Fires once, when endIf's return value ends the match. G here is the same
  // mutable Immer draft moves/endIf receive — the mutation persists into the
  // final state (verified pattern, not a guess). No pre-migration G.messages
  // site existed for game-over, so this is event-only from day one.
  onEnd: (G, ctx) => {
    logEvent(G, 'game_over', null, { result: ctx.gameover });
  },
};
