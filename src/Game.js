import { INVALID_MOVE } from 'boardgame.io/core';
import { validateRoute, autoRoute } from './atlas-movement';
import { BOARD_SPACES as DEFAULT_BOARD_SPACES, COLOR_GROUPS as DEFAULT_COLOR_GROUPS } from '../mods/dominion/board';
import { CHANCE_CARDS as DEFAULT_CHANCE_CARDS, COMMUNITY_CARDS as DEFAULT_COMMUNITY_CARDS } from '../mods/dominion/cards';
import { RULES } from '../mods/dominion/rules';
import { getCharacterById, getStartingMoney } from '../mods/dominion/characters-data';

// Active map data — defaults to classic mod, can be overridden via setActiveMap().
// Per-match board config is snapshotted into G.board at setup(); all engine readers
// use G.board.*. setup() is the only code that still reads _pendingMap directly, because
// G.board does not yet exist while setup() runs (it is being built from _pendingMap).
var _mapVictory = null;        // victory config from the active map (map.json)
var _victoryOverride = null;   // per-session override from the game-start selector

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
  };
}

// --- Character helpers ---

function getPassive(player) {
  return player.character ? player.character.passive.id : null;
}

function playerName(player) {
  if (player.character) return player.character.name;
  return `Player ${parseInt(player.id) + 1}`;
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

function drawCard(ctx, deck) {
  if (!deck || deck.length === 0) return null;
  const index = Math.floor(ctx.random.Number() * deck.length);
  return deck[index];
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
  G.messages.push(`${playerName(player)} is BANKRUPT!`);

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
      G.messages.push(`${playerName(p)} gains $${RULES.passives.arbitrageur.bankruptcyBonus} from crisis arbitrage!`);
    }
  });
}

// Pay the hub-gated salary (atlas income, spec D4). Same RULES.core.goSalary
// base as classic GO, scaled by the income multiplier stack; the idealist
// passive's GO bonus migrates here as a flat add.
function payHubSalary(G, player) {
  let salary = Math.floor(applyEconMods(G, 'income', RULES.core.goSalary));
  if (getPassive(player) === 'idealist') {
    salary += RULES.passives.idealist.goBonus;
    G.messages.push(`Growth vision: extra $${RULES.passives.idealist.goBonus} at the hub!`);
  }
  player.money += salary;
  G.messages.push(`${playerName(player)} passes a capital hub! Collect $${salary}.`);
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
    G.messages.push('No path forward — the route ends here.');
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
  const messages = G.messages;

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
          if (effectivePrice < space.price) {
            messages.push(`${space.name} available! Listed $${space.price}, your price $${effectivePrice}. Buy or pass?`);
          } else {
            messages.push(`${space.name} is available for $${effectivePrice}. Buy or pass?`);
          }
        } else {
          messages.push(`${space.name} costs $${getEffectiveBuyPrice(G, player, space)} but you only have $${player.money}.`);
        }
      } else if (owner !== ctx.currentPlayer) {
        const rent = calculateRent(G, space, G.lastDice.total, player);
        player.money -= rent;
        G.players[owner].money += rent;
        messages.push(`Paid $${rent} rent to ${playerName(G.players[owner])} for ${space.name}.`);
        if (player.money <= 0) {
          handleBankruptcy(G, ctx, player, owner);
        }
      } else {
        messages.push(`You own ${space.name}.`);
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
        messages.push(`Financial expertise reduces tax to $${taxAmount}.`);
      }
      player.money -= taxAmount;
      if (RULES.core.freeParkingPot) {
        G.freeParkingPot += taxAmount;
      }
      messages.push(`Paid $${taxAmount} in ${space.name}.`);
      if (player.money <= 0) {
        handleBankruptcy(G, ctx, player, null);
      }
      break;
    }

    case 'chance': {
      const card = drawCard(ctx, G.board.chanceCards);
      if (!card) {
        messages.push('The deck is empty.');
        break;
      }
      messages.push(`CHANCE: ${card.text}`);
      // Check if player can redraw (Cassian passive OR luck redraws)
      const canRedraw = (getPassive(player) === 'merchant') ||
                        (player.luckRedraws > 0 && ['pay', 'payPercent', 'downgrade', 'goToJail'].includes(card.action));
      if (canRedraw) {
        G.pendingCard = { card, deck: 'chance' };
        G.turnPhase = 'card';
        messages.push('You may accept or redraw this card.');
        return;
      }
      applyCard(G, ctx, player, card);
      break;
    }

    case 'community': {
      const card = drawCard(ctx, G.board.communityCards);
      if (!card) {
        messages.push('The deck is empty.');
        break;
      }
      messages.push(`COMMUNITY CHEST: ${card.text}`);
      const canRedraw = (getPassive(player) === 'merchant') ||
                        (player.luckRedraws > 0 && ['pay', 'payPercent', 'downgrade', 'goToJail'].includes(card.action));
      if (canRedraw) {
        G.pendingCard = { card, deck: 'community' };
        G.turnPhase = 'card';
        messages.push('You may accept or redraw this card.');
        return;
      }
      applyCard(G, ctx, player, card);
      break;
    }

    case 'goToJail':
      sendToJail(G, player);
      messages.push('Go to Jail!');
      break;

    case 'jail':
      messages.push('Just visiting jail.');
      break;

    case 'parking':
      if (RULES.core.freeParkingPot && G.freeParkingPot > 0) {
        player.money += G.freeParkingPot;
        messages.push(`Free Parking jackpot! Collected $${G.freeParkingPot}!`);
        G.freeParkingPot = 0;
      } else {
        messages.push('Free Parking - relax!');
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

function applyCard(G, ctx, player, card) {
  switch (card.action) {
    case 'gain':
      player.money += card.value;
      break;
    case 'pay': {
      let amount = card.value;
      // Albert Victor passive: financial negative event loss reduction
      if (getPassive(player) === 'financier') {
        amount = Math.floor(amount * (1 - RULES.passives.financier.negativeEventReduction));
        G.messages.push(`Financial expertise reduces loss to $${amount}.`);
      }
      player.money -= amount;
      if (RULES.core.freeParkingPot) {
        G.freeParkingPot += amount;
      }
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
        handleLanding(G, ctx);
        break;
      }
      const oldPos = player.position;
      player.position = card.value;
      if (card.value < oldPos && card.value !== G.board.jail) {
        let goBonus = Math.floor(applyEconMods(G, 'income', RULES.core.goSalary));
        // Mira Dawnlight passive: GO bonus
        if (getPassive(player) === 'idealist') {
          goBonus += RULES.passives.idealist.goBonus;
          G.messages.push(`Growth vision: extra $${RULES.passives.idealist.goBonus} from GO!`);
        }
        player.money += goBonus;
        G.messages.push(`Passed GO! Collect $${goBonus}.`);
      }
      handleLanding(G, ctx);
      break;
    }
    case 'goToJail':
      sendToJail(G, player);
      break;

    // --- Enhanced card actions ---

    case 'payPercent': {
      // Pay X% of total assets
      const assets = getTotalAssets(G, player);
      let amount = Math.floor(assets * card.value / 100);
      if (getPassive(player) === 'financier') {
        amount = Math.floor(amount * (1 - RULES.passives.financier.negativeEventReduction));
        G.messages.push(`Financial expertise reduces loss to $${amount}.`);
      }
      player.money -= amount;
      if (RULES.core.freeParkingPot) {
        G.freeParkingPot += amount;
      }
      G.messages.push(`Total assets: $${assets}. Paid $${amount} (${card.value}%).`);
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
      G.messages.push(`All players receive $${card.value}!`);
      break;
    }

    case 'gainPerProperty': {
      // Gain $X per owned property
      const count = player.properties.length;
      const amount = card.value * count;
      player.money += amount;
      G.messages.push(`${count} properties x $${card.value} = $${amount} earned!`);
      break;
    }

    case 'freeUpgrade': {
      // Auto-upgrade the cheapest upgradeable property
      const upgradeable = player.properties
        .filter(pid => {
          const sp = G.board.spaces[pid];
          if (sp.type !== 'property' || !sp.color) return false;
          if (!ownsColorGroup(G, player.id, sp.color)) return false;
          const level = G.buildings[pid] || 0;
          if (level >= RULES.core.maxBuildingLevel) return false;
          const groupIds = G.board.colorGroups[sp.color];
          if (groupIds.some(id => G.mortgaged[id])) return false;
          const minLevel = Math.min(...groupIds.map(id => G.buildings[id] || 0));
          return level <= minLevel;
        })
        .sort((a, b) => G.board.spaces[a].price - G.board.spaces[b].price);

      if (upgradeable.length > 0) {
        const pid = upgradeable[0];
        const level = (G.buildings[pid] || 0) + 1;
        G.buildings[pid] = level;
        G.messages.push(`Free upgrade! ${G.board.spaces[pid].name} upgraded to ${RULES.buildings.names[level]}!`);
      } else {
        G.messages.push('No properties eligible for free upgrade.');
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
        G.messages.push(`Market Crash! ${G.board.spaces[pid].name} downgraded to ${RULES.buildings.names[newLevel]}.`);
      } else {
        G.messages.push('No buildings to downgrade.');
      }
      break;
    }

    case 'forceBuy': {
      // Force-buy opponent's cheapest property at X% price
      const opponents = G.players.filter(p => p.id !== player.id && !p.bankrupt && p.properties.length > 0);
      if (opponents.length === 0) {
        G.messages.push('No opponents with properties for hostile takeover.');
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
          G.messages.push(`Hostile Takeover! Bought ${G.board.spaces[cheapestPid].name} from ${playerName(targetOwner)} for $${cost}!`);
        } else {
          G.messages.push(`Can't afford hostile takeover ($${cost} needed).`);
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

  // Dominion: first to own `groupsToWin` full color groups wins instantly.
  if (v.primary === 'monopoly') {
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

function advanceAuction(G) {
  const auction = G.auction;
  let nextIndex = auction.currentBidderIndex;
  const total = auction.bidders.length;

  for (let i = 0; i < total; i++) {
    nextIndex = (nextIndex + 1) % total;
    const bidder = auction.bidders[nextIndex];
    if (!bidder.passed) {
      // Check if this is the current highest bidder (auction complete)
      if (bidder.playerId === auction.currentBidder) {
        resolveAuction(G);
        return;
      }
      auction.currentBidderIndex = nextIndex;
      const player = G.players[bidder.playerId];
      G.messages.push(`${playerName(player)}'s turn to bid.`);
      return;
    }
  }

  // All passed
  if (auction.currentBidder !== null) {
    resolveAuction(G);
  } else {
    G.messages.push(`No bids. ${G.board.spaces[auction.propertyId].name} remains unowned.`);
    G.auction = null;
    G.turnPhase = 'done';
  }
}

function resolveAuction(G) {
  const auction = G.auction;
  const winner = G.players[auction.currentBidder];
  const space = G.board.spaces[auction.propertyId];

  winner.money -= auction.currentBid;
  winner.properties.push(auction.propertyId);
  G.ownership[auction.propertyId] = auction.currentBidder;
  G.messages.push(`${playerName(winner)} wins the auction for ${space.name} at $${auction.currentBid}!`);
  G.auction = null;
  G.turnPhase = 'done';
}

// --- Game definition ---

export const Monopoly = {
  name: 'monopoly',

  setup: (ctx) => {
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
      freeParkingPot: 0,
      victory: resolveVictory(),
      _resumeLoad: false, // one-shot: set true by loadGame so the first onBegin doesn't bump turn/season
    };
  },

  turn: {
    onBegin: (G, ctx) => {
      if (G.phase === 'characterSelect') return;
      G.hasRolled = false;
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
          G.messages.push(`${season.icon} Season changed to ${season.name}!`);
        }
      }

      const player = G.players[ctx.currentPlayer];
      if (player.bankrupt) return;
      if (player.inJail) {
        G.messages.push(`${playerName(player)} is in jail. Pay $${RULES.core.jailFine} or try to roll doubles.`);
      }
    },
  },

  moves: {
    // --- Character selection ---
    selectCharacter: (G, ctx, characterId) => {
      if (G.phase !== 'characterSelect') return INVALID_MOVE;

      const char = getCharacterById(characterId);
      if (!char) return INVALID_MOVE;

      // Check not already taken
      if (G.players.some(p => p.character && p.character.id === characterId)) return INVALID_MOVE;

      const player = G.players[ctx.currentPlayer];
      if (player.character) return INVALID_MOVE; // Already selected

      player.character = char;
      player.money = getStartingMoney(char);

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

      G.messages.push(`${playerName(player)} joins the game! ($${player.money})`);

      // Check if all players have selected
      const allSelected = G.players.every(p => p.character !== null);
      if (allSelected) {
        G.phase = 'play';
        G.messages = ['All characters selected! Game begins! ' + playerName(G.players[0]) + ' rolls first.'];
      }

      ctx.events.endTurn();
    },

    // --- Dice ---
    rollDice: (G, ctx, route) => {
      if (G.phase !== 'play') return INVALID_MOVE;
      if (G.hasRolled) return INVALID_MOVE;
      const player = G.players[ctx.currentPlayer];
      if (player.bankrupt) return INVALID_MOVE;

      const dice = rollTwoDice(ctx);
      dice.preRollPosition = player.position;
      dice.preRollDistance = player.distanceTraveled || 0;
      dice.salaryCollected = 0;
      G.lastDice = dice;
      G.hasRolled = true;
      G.messages = [`${playerName(player)} rolled ${dice.d1} + ${dice.d2} = ${dice.total}`];

      // Triple doubles rule
      if (dice.isDoubles) {
        G.doublesCount++;
        if (G.doublesCount >= RULES.core.doublesJailThreshold) {
          sendToJail(G, player);
          G.messages.push('Triple doubles! Go to Jail!');
          G.turnPhase = 'done';
          return;
        }
      } else {
        G.doublesCount = 0;
      }

      if (player.inJail) {
        if (dice.isDoubles) {
          player.inJail = false;
          player.jailTurns = 0;
          G.messages.push('Doubles! You\'re free from jail!');
        } else {
          player.jailTurns++;
          if (player.jailTurns >= RULES.core.jailMaxTurns) {
            player.money -= RULES.core.jailFine;
            player.inJail = false;
            player.jailTurns = 0;
            G.messages.push(`${RULES.core.jailMaxTurns} turns in jail. Paid $${RULES.core.jailFine} fine.`);
            if (player.money <= 0) {
              handleBankruptcy(G, ctx, player, null);
              G.turnPhase = 'done';
              return;
            }
          } else {
            G.messages.push(`Still in jail. Turn ${player.jailTurns}/${RULES.core.jailMaxTurns}.`);
            G.turnPhase = 'done';
            return;
          }
        }
      }

      if (G.board.movementMode === 'atlas') {
        if (!atlasWalk(G, player, dice, route)) return INVALID_MOVE;
      } else {
        const oldPos = player.position;
        player.position = (player.position + dice.total) % G.board.boardSize;
        // `|| 0` tolerates pre-branch saves where the field doesn't exist.
        player.distanceTraveled = (player.distanceTraveled || 0) + dice.total;

        if (player.position < oldPos && G.board.spaces[player.position].type !== 'goToJail') {
          let goBonus = Math.floor(applyEconMods(G, 'income', RULES.core.goSalary));
          // Mira Dawnlight passive: GO bonus
          if (getPassive(player) === 'idealist') {
            goBonus += RULES.passives.idealist.goBonus;
            G.messages.push(`Growth vision: extra $${RULES.passives.idealist.goBonus} from GO!`);
          }
          player.money += goBonus;
          G.lastDice.salaryCollected = goBonus;
          G.messages.push(`Passed GO! Collect $${goBonus}.`);
        }
      }

      G.messages.push(`Landed on ${G.board.spaces[player.position].name}.`);
      handleLanding(G, ctx);

      // Set turnPhase based on what happened
      if (G.turnPhase !== 'card') {
        G.turnPhase = G.canBuy ? 'act' : 'done';
      }
    },

    // --- Reroll (Stamina ability) ---
    useReroll: (G, ctx) => {
      if (G.phase !== 'play') return INVALID_MOVE;
      if (!G.hasRolled) return INVALID_MOVE;
      const player = G.players[ctx.currentPlayer];
      if (player.rerollsLeft <= 0) return INVALID_MOVE;
      if (G.canBuy || G.pendingCard) return INVALID_MOVE; // Can't reroll after buying or during card

      // Reset state for re-roll
      player.rerollsLeft--;
      G.hasRolled = false;
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
      G.messages.push(`${playerName(player)} uses a reroll! (${player.rerollsLeft} left)`);
    },

    // --- Card accept/redraw ---
    acceptCard: (G, ctx) => {
      if (!G.pendingCard) return INVALID_MOVE;
      const player = G.players[ctx.currentPlayer];
      const card = G.pendingCard.card;
      G.pendingCard = null;
      applyCard(G, ctx, player, card);
      // applyCard can chain a NEW pending card (atlas moveTo onto a card
      // space) — don't clobber it or the card phase.
      if (G.turnPhase !== 'card') {
        G.turnPhase = G.canBuy ? 'act' : 'done';
      }
    },

    redrawCard: (G, ctx) => {
      if (!G.pendingCard) return INVALID_MOVE;
      const player = G.players[ctx.currentPlayer];

      // Cassian (merchant) has unlimited redraws, others consume luckRedraws
      if (getPassive(player) !== 'merchant') {
        if (player.luckRedraws <= 0) return INVALID_MOVE;
        player.luckRedraws--;
      }

      const deck = G.pendingCard.deck === 'chance' ? G.board.chanceCards : G.board.communityCards;
      const deckName = G.pendingCard.deck === 'chance' ? 'CHANCE' : 'COMMUNITY CHEST';
      G.pendingCard = null;
      const newCard = drawCard(ctx, deck);
      G.messages.push(`Redraw! ${deckName}: ${newCard.text}`);
      applyCard(G, ctx, player, newCard);
      // applyCard can chain a NEW pending card (atlas moveTo onto a card
      // space) — don't clobber it or the card phase.
      if (G.turnPhase !== 'card') {
        G.turnPhase = G.canBuy ? 'act' : 'done';
      }
    },

    // --- Knox: Regulate property ---
    regulateProperty: (G, ctx, propertyId) => {
      if (G.phase !== 'play') return INVALID_MOVE;
      const player = G.players[ctx.currentPlayer];
      if (getPassive(player) !== 'enforcer') return INVALID_MOVE;

      // Must own the property
      if (G.ownership[propertyId] !== ctx.currentPlayer) return INVALID_MOVE;
      // Can only regulate one at a time
      player.regulatedProperty = propertyId;
      G.messages.push(`${playerName(player)} regulates ${G.board.spaces[propertyId].name}! (+${RULES.passives.enforcer.regulatedRentBonus * 100}% rent)`);
    },

    // --- Property upgrades ---
    upgradeProperty: (G, ctx, propertyId) => {
      if (G.phase !== 'play') return INVALID_MOVE;
      if (!G.hasRolled) return INVALID_MOVE;

      const player = G.players[ctx.currentPlayer];
      const space = G.board.spaces[propertyId];

      if (!space || space.type !== 'property') return INVALID_MOVE;
      if (G.ownership[propertyId] !== ctx.currentPlayer) return INVALID_MOVE;
      if (!space.color || !ownsColorGroup(G, ctx.currentPlayer, space.color)) return INVALID_MOVE;

      // No mortgaged properties in group
      const groupIds = G.board.colorGroups[space.color];
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
      G.messages.push(`Built ${RULES.buildings.names[targetLevel]} on ${space.name} for $${cost}!`);
    },

    mortgageProperty: (G, ctx, propertyId) => {
      if (G.phase !== 'play') return INVALID_MOVE;

      const player = G.players[ctx.currentPlayer];
      const space = G.board.spaces[propertyId];
      if (!space) return INVALID_MOVE;

      if (G.ownership[propertyId] !== ctx.currentPlayer) return INVALID_MOVE;
      if (G.mortgaged[propertyId]) return INVALID_MOVE;

      // Can't mortgage property with buildings
      if ((G.buildings[propertyId] || 0) > 0) return INVALID_MOVE;

      // Can't mortgage if any property in color group has buildings
      if (space.color && G.board.colorGroups[space.color]) {
        if (G.board.colorGroups[space.color].some(id => (G.buildings[id] || 0) > 0)) {
          return INVALID_MOVE;
        }
      }

      G.mortgaged[propertyId] = true;
      const mortgageValue = Math.floor(applyEconMods(G, 'price', space.price * RULES.core.mortgageRate));
      player.money += mortgageValue;
      G.messages.push(`Mortgaged ${space.name} for $${mortgageValue}.`);
    },

    unmortgageProperty: (G, ctx, propertyId) => {
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
      G.messages.push(`Unmortgaged ${space.name} for $${unmortgageCost}.`);
    },

    sellBuilding: (G, ctx, propertyId) => {
      if (G.phase !== 'play') return INVALID_MOVE;
      if (!G.hasRolled) return INVALID_MOVE;

      const player = G.players[ctx.currentPlayer];
      const space = G.board.spaces[propertyId];

      if (!space || space.type !== 'property') return INVALID_MOVE;
      if (G.ownership[propertyId] !== ctx.currentPlayer) return INVALID_MOVE;

      const currentLevel = G.buildings[propertyId] || 0;
      if (currentLevel <= 0) return INVALID_MOVE;

      // Even building in reverse: can only sell from highest level in group
      if (space.color && G.board.colorGroups[space.color]) {
        const groupIds = G.board.colorGroups[space.color];
        const maxLevel = Math.max(...groupIds.map(id => G.buildings[id] || 0));
        if (currentLevel < maxLevel) return INVALID_MOVE;
      }

      // Refund = upgrade cost for this level * sellbackRate
      const refund = Math.floor(getUpgradeCost(G, player, space, currentLevel) * RULES.buildings.sellbackRate);

      G.buildings[propertyId] = currentLevel - 1;
      if (G.buildings[propertyId] === 0) delete G.buildings[propertyId];
      player.money += refund;

      const newLevel = G.buildings[propertyId] || 0;
      G.messages.push(`Sold ${RULES.buildings.names[currentLevel]} on ${space.name} for $${refund}. Now: ${RULES.buildings.names[newLevel]}.`);
    },

    // --- Buy property ---
    buyProperty: (G, ctx) => {
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
      G.messages.push(`Bought ${space.name} for $${effectivePrice}!`);
      G.turnPhase = 'done';
    },

    passProperty: (G, ctx) => {
      if (!G.canBuy) return INVALID_MOVE;
      G.canBuy = false;
      G.effectivePrice = 0;

      if (RULES.auction.enabled && RULES.auction.auctionOnPass) {
        const player = G.players[ctx.currentPlayer];
        const space = G.board.spaces[player.position];
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
          G.messages.push(`${space.name} goes to auction! Bidding starts at $${RULES.auction.startingBid}.`);
          const firstBidder = G.players[activeBidders[0].playerId];
          G.messages.push(`${playerName(firstBidder)}'s turn to bid.`);
          return;
        }
      }

      G.messages.push('Passed on buying.');
      G.turnPhase = 'done';
    },

    payJailFine: (G, ctx) => {
      if (G.phase !== 'play') return INVALID_MOVE;
      const player = G.players[ctx.currentPlayer];
      if (!player.inJail) return INVALID_MOVE;
      if (G.hasRolled) return INVALID_MOVE;

      if (player.money < RULES.core.jailFine) {
        G.messages.push(`Not enough money to pay $${RULES.core.jailFine} fine!`);
        return INVALID_MOVE;
      }

      player.money -= RULES.core.jailFine;
      player.inJail = false;
      player.jailTurns = 0;
      G.messages = [`${playerName(player)} paid $${RULES.core.jailFine} to get out of jail.`];
    },

    // --- Trading ---
    proposeTrade: (G, ctx, proposal) => {
      if (G.phase !== 'play') return INVALID_MOVE;
      if (!RULES.trading.enabled) return INVALID_MOVE;
      if (!G.hasRolled) return INVALID_MOVE;
      if (G.canBuy || G.pendingCard || G.auction) return INVALID_MOVE;
      if (G.trade) return INVALID_MOVE;

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
      G.messages.push(`${playerName(player)} proposes a trade to ${playerName(target)}!`);
    },

    acceptTrade: (G, ctx) => {
      if (!G.trade) return INVALID_MOVE;

      const { proposerId, targetPlayerId, offeredProperties, requestedProperties, offeredMoney, requestedMoney } = G.trade;
      const proposer = G.players[proposerId];
      const target = G.players[targetPlayerId];

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

      G.messages.push(`Trade accepted! ${playerName(proposer)} and ${playerName(target)} completed a trade.`);
      G.trade = null;
      G.turnPhase = 'done';
    },

    rejectTrade: (G, ctx) => {
      if (!G.trade) return INVALID_MOVE;
      const target = G.players[G.trade.targetPlayerId];
      G.messages.push(`${playerName(target)} rejected the trade.`);
      G.trade = null;
      G.turnPhase = 'done';
    },

    cancelTrade: (G, ctx) => {
      if (!G.trade) return INVALID_MOVE;
      if (G.trade.proposerId !== ctx.currentPlayer) return INVALID_MOVE;
      G.messages.push('Trade cancelled.');
      G.trade = null;
      G.turnPhase = 'done';
    },

    // --- Auctions ---
    placeBid: (G, ctx, amount) => {
      if (!G.auction) return INVALID_MOVE;

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
      G.messages.push(`${playerName(player)} bids $${amount}!`);

      // Advance to next bidder
      advanceAuction(G);
    },

    passAuction: (G, ctx) => {
      if (!G.auction) return INVALID_MOVE;

      const auction = G.auction;
      const bidderEntry = auction.bidders[auction.currentBidderIndex];
      const player = G.players[bidderEntry.playerId];

      bidderEntry.passed = true;
      G.messages.push(`${playerName(player)} passes.`);

      // Check if auction is over
      const activeBidders = auction.bidders.filter(b => !b.passed);
      if (activeBidders.length <= 1 && auction.currentBidder !== null) {
        resolveAuction(G);
      } else if (activeBidders.length === 0) {
        // Everyone passed with no bids
        G.messages.push(`No bids. ${G.board.spaces[auction.propertyId].name} remains unowned.`);
        G.auction = null;
        G.turnPhase = 'done';
      } else {
        advanceAuction(G);
      }
    },

    endTurn: (G, ctx) => {
      if (G.phase === 'characterSelect') return INVALID_MOVE;
      if (!G.hasRolled) return INVALID_MOVE;
      if (G.canBuy) return INVALID_MOVE;
      if (G.pendingCard) return INVALID_MOVE;
      if (G.trade) return INVALID_MOVE;
      if (G.auction) return INVALID_MOVE;
      G.turnPhase = 'roll';
      ctx.events.endTurn();
    },
  },

  endIf: (G, ctx) => {
    if (G.phase !== 'play') return undefined;
    return checkGameOver(G);
  },
};
