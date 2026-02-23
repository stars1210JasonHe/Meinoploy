import { INVALID_MOVE } from 'boardgame.io/core';
import { BOARD_SPACES as DEFAULT_BOARD_SPACES, COLOR_GROUPS as DEFAULT_COLOR_GROUPS } from '../mods/dominion/board';
import { CHANCE_CARDS as DEFAULT_CHANCE_CARDS, COMMUNITY_CARDS as DEFAULT_COMMUNITY_CARDS } from '../mods/dominion/cards';
import { RULES } from '../mods/dominion/rules';
import { getCharacterById, getStartingMoney } from '../mods/dominion/characters-data';

// Active map data — defaults to classic mod, can be overridden via setActiveMap()
var _boardSpaces = DEFAULT_BOARD_SPACES;
var _colorGroups = DEFAULT_COLOR_GROUPS;
var _chanceCards = DEFAULT_CHANCE_CARDS;
var _communityCards = DEFAULT_COMMUNITY_CARDS;
var _boardSize = RULES.core.boardSize;
var _jailPosition = RULES.core.jailPosition;

export function setActiveMap(mapData) {
  _boardSpaces = mapData.spaces;
  _colorGroups = mapData.colorGroupsFlat;
  _chanceCards = mapData.chanceCards;
  _communityCards = mapData.communityCards;
  _boardSize = mapData.spaceCount;
  _jailPosition = mapData.specialSpaces.jail;
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
  if (!color || !_colorGroups[color]) return false;
  return _colorGroups[color].every(id => G.ownership[id] === playerId);
}

function getEffectiveBuyPrice(G, player, space) {
  let price = space.price;

  // Season price modifier
  price *= getSeasonPriceMod(G);

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
  cost *= getSeasonPriceMod(G);

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

function getSeasonPriceMod(G) {
  return getCurrentSeason(G).priceMod;
}

function getSeasonRentMod(G) {
  return getCurrentSeason(G).rentMod;
}

function getSeasonTaxMod(G) {
  return getCurrentSeason(G).taxMod;
}

// --- Dice & cards ---

function rollTwoDice(ctx) {
  const d1 = Math.floor(ctx.random.Number() * RULES.core.diceSides) + 1;
  const d2 = Math.floor(ctx.random.Number() * RULES.core.diceSides) + 1;
  return { d1, d2, total: d1 + d2, isDoubles: d1 === d2 };
}

function drawCard(ctx, deck) {
  const index = Math.floor(ctx.random.Number() * deck.length);
  return deck[index];
}

// --- Rent calculation ---

function countOwnedRailroads(G, ownerID) {
  return G.players[ownerID].properties.filter(pid => {
    return _boardSpaces[pid].type === 'railroad';
  }).length;
}

function countOwnedUtilities(G, ownerID) {
  return G.players[ownerID].properties.filter(pid => {
    return _boardSpaces[pid].type === 'utility';
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
      if (space.color && ownsColorGroup(G, owner, space.color)) {
        rent *= RULES.core.monopolyRentMultiplier;
      }
    }
  }

  // Season rent modifier (Winter: +20%)
  rent *= getSeasonRentMod(G);

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
    if (getPassive(visitor) === 'breaker' && space.color && ownsColorGroup(G, owner, space.color)) {
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

// --- Landing ---

function handleLanding(G, ctx) {
  const player = G.players[ctx.currentPlayer];
  const space = _boardSpaces[player.position];
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
      let taxAmount = space.rent;
      // Season tax modifier (Winter: double tax)
      taxAmount = Math.floor(taxAmount * getSeasonTaxMod(G));
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
      const card = drawCard(ctx, _chanceCards);
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
      const card = drawCard(ctx, _communityCards);
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
      player.position = _jailPosition;
      player.inJail = true;
      player.jailTurns = 0;
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
    total += _boardSpaces[pid].price;
    const level = G.buildings[pid] || 0;
    for (let i = 1; i <= level; i++) {
      total += Math.floor(_boardSpaces[pid].price * RULES.buildings.upgradeCostMultipliers[i - 1]);
    }
  });
  return total;
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
      const oldPos = player.position;
      player.position = card.value;
      if (card.value < oldPos && card.value !== _jailPosition) {
        let goBonus = RULES.core.goSalary;
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
      player.position = _jailPosition;
      player.inJail = true;
      player.jailTurns = 0;
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
          const sp = _boardSpaces[pid];
          if (sp.type !== 'property' || !sp.color) return false;
          if (!ownsColorGroup(G, player.id, sp.color)) return false;
          const level = G.buildings[pid] || 0;
          if (level >= RULES.core.maxBuildingLevel) return false;
          const groupIds = _colorGroups[sp.color];
          if (groupIds.some(id => G.mortgaged[id])) return false;
          const minLevel = Math.min(...groupIds.map(id => G.buildings[id] || 0));
          return level <= minLevel;
        })
        .sort((a, b) => _boardSpaces[a].price - _boardSpaces[b].price);

      if (upgradeable.length > 0) {
        const pid = upgradeable[0];
        const level = (G.buildings[pid] || 0) + 1;
        G.buildings[pid] = level;
        G.messages.push(`Free upgrade! ${_boardSpaces[pid].name} upgraded to ${RULES.buildings.names[level]}!`);
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
        G.messages.push(`Market Crash! ${_boardSpaces[pid].name} downgraded to ${RULES.buildings.names[newLevel]}.`);
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
          if (_boardSpaces[pid].price < cheapestPrice) {
            cheapestPrice = _boardSpaces[pid].price;
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
          G.messages.push(`Hostile Takeover! Bought ${_boardSpaces[cheapestPid].name} from ${playerName(targetOwner)} for $${cost}!`);
        } else {
          G.messages.push(`Can't afford hostile takeover ($${cost} needed).`);
        }
      }
      break;
    }
  }
}

function checkGameOver(G) {
  const activePlayers = G.players.filter(p => !p.bankrupt);
  if (activePlayers.length === 1) {
    return { winner: activePlayers[0].id };
  }
  // Max turns: compare total assets
  if (RULES.core.maxTurns > 0 && G.totalTurns >= RULES.core.maxTurns) {
    const sorted = activePlayers
      .map(p => ({ id: p.id, assets: getTotalAssets(G, p) }))
      .sort((a, b) => b.assets - a.assets);
    return { winner: sorted[0].id, reason: 'maxTurns' };
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
    G.messages.push(`No bids. ${_boardSpaces[auction.propertyId].name} remains unowned.`);
    G.auction = null;
    G.turnPhase = 'done';
  }
}

function resolveAuction(G) {
  const auction = G.auction;
  const winner = G.players[auction.currentBidder];
  const space = _boardSpaces[auction.propertyId];

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
    _boardSpaces.forEach(space => {
      if (space.type === 'property' || space.type === 'railroad' || space.type === 'utility') {
        ownership[space.id] = null;
      }
    });

    return {
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

      // Track total turns and advance season
      G.totalTurns++;
      const newSeasonIndex = Math.floor(G.totalTurns / RULES.seasons.changeInterval) % RULES.seasons.list.length;
      if (newSeasonIndex !== G.seasonIndex) {
        G.seasonIndex = newSeasonIndex;
        const season = RULES.seasons.list[G.seasonIndex];
        G.messages.push(`${season.icon} Season changed to ${season.name}!`);
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
    rollDice: (G, ctx) => {
      if (G.phase !== 'play') return INVALID_MOVE;
      if (G.hasRolled) return INVALID_MOVE;
      const player = G.players[ctx.currentPlayer];
      if (player.bankrupt) return INVALID_MOVE;

      const dice = rollTwoDice(ctx);
      dice.preRollPosition = player.position;
      G.lastDice = dice;
      G.hasRolled = true;
      G.messages = [`${playerName(player)} rolled ${dice.d1} + ${dice.d2} = ${dice.total}`];

      // Triple doubles rule
      if (dice.isDoubles) {
        G.doublesCount++;
        if (G.doublesCount >= RULES.core.doublesJailThreshold) {
          player.position = _jailPosition;
          player.inJail = true;
          player.jailTurns = 0;
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

      const oldPos = player.position;
      player.position = (player.position + dice.total) % _boardSize;

      if (player.position < oldPos && _boardSpaces[player.position].type !== 'goToJail') {
        let goBonus = RULES.core.goSalary;
        // Mira Dawnlight passive: GO bonus
        if (getPassive(player) === 'idealist') {
          goBonus += RULES.passives.idealist.goBonus;
          G.messages.push(`Growth vision: extra $${RULES.passives.idealist.goBonus} from GO!`);
        }
        player.money += goBonus;
        G.messages.push(`Passed GO! Collect $${goBonus}.`);
      }

      G.messages.push(`Landed on ${_boardSpaces[player.position].name}.`);
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

      // Undo the position change — put player back
      // We need to store the old position. For simplicity, we'll just allow re-rolling
      // which means the player rolls again from their current position.
      // Actually, we should revert to the position before the roll.
      // Store pre-roll position in lastDice for this purpose.
      if (G.lastDice && G.lastDice.preRollPosition !== undefined) {
        player.position = G.lastDice.preRollPosition;
      }
      G.lastDice = null;
      G.messages.push(`${playerName(player)} uses a reroll! (${player.rerollsLeft} left)`);
    },

    // --- Card accept/redraw ---
    acceptCard: (G, ctx) => {
      if (!G.pendingCard) return INVALID_MOVE;
      const player = G.players[ctx.currentPlayer];
      applyCard(G, ctx, player, G.pendingCard.card);
      G.pendingCard = null;
      G.turnPhase = G.canBuy ? 'act' : 'done';
    },

    redrawCard: (G, ctx) => {
      if (!G.pendingCard) return INVALID_MOVE;
      const player = G.players[ctx.currentPlayer];

      // Cassian (merchant) has unlimited redraws, others consume luckRedraws
      if (getPassive(player) !== 'merchant') {
        if (player.luckRedraws <= 0) return INVALID_MOVE;
        player.luckRedraws--;
      }

      const deck = G.pendingCard.deck === 'chance' ? _chanceCards : _communityCards;
      const newCard = drawCard(ctx, deck);
      const deckName = G.pendingCard.deck === 'chance' ? 'CHANCE' : 'COMMUNITY CHEST';
      G.messages.push(`Redraw! ${deckName}: ${newCard.text}`);
      applyCard(G, ctx, player, newCard);
      G.pendingCard = null;
      G.turnPhase = G.canBuy ? 'act' : 'done';
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
      G.messages.push(`${playerName(player)} regulates ${_boardSpaces[propertyId].name}! (+${RULES.passives.enforcer.regulatedRentBonus * 100}% rent)`);
    },

    // --- Property upgrades ---
    upgradeProperty: (G, ctx, propertyId) => {
      if (G.phase !== 'play') return INVALID_MOVE;
      if (!G.hasRolled) return INVALID_MOVE;

      const player = G.players[ctx.currentPlayer];
      const space = _boardSpaces[propertyId];

      if (!space || space.type !== 'property') return INVALID_MOVE;
      if (G.ownership[propertyId] !== ctx.currentPlayer) return INVALID_MOVE;
      if (!space.color || !ownsColorGroup(G, ctx.currentPlayer, space.color)) return INVALID_MOVE;

      // No mortgaged properties in group
      const groupIds = _colorGroups[space.color];
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
      const space = _boardSpaces[propertyId];
      if (!space) return INVALID_MOVE;

      if (G.ownership[propertyId] !== ctx.currentPlayer) return INVALID_MOVE;
      if (G.mortgaged[propertyId]) return INVALID_MOVE;

      // Can't mortgage property with buildings
      if ((G.buildings[propertyId] || 0) > 0) return INVALID_MOVE;

      // Can't mortgage if any property in color group has buildings
      if (space.color && _colorGroups[space.color]) {
        if (_colorGroups[space.color].some(id => (G.buildings[id] || 0) > 0)) {
          return INVALID_MOVE;
        }
      }

      G.mortgaged[propertyId] = true;
      const mortgageValue = Math.floor(space.price * RULES.core.mortgageRate * getSeasonPriceMod(G));
      player.money += mortgageValue;
      G.messages.push(`Mortgaged ${space.name} for $${mortgageValue}.`);
    },

    unmortgageProperty: (G, ctx, propertyId) => {
      if (G.phase !== 'play') return INVALID_MOVE;

      const player = G.players[ctx.currentPlayer];
      const space = _boardSpaces[propertyId];
      if (!space) return INVALID_MOVE;

      if (G.ownership[propertyId] !== ctx.currentPlayer) return INVALID_MOVE;
      if (!G.mortgaged[propertyId]) return INVALID_MOVE;

      const unmortgageCost = Math.floor(space.price * RULES.core.unmortgageRate * getSeasonPriceMod(G));
      if (player.money < unmortgageCost) return INVALID_MOVE;

      player.money -= unmortgageCost;
      G.mortgaged[propertyId] = false;
      G.messages.push(`Unmortgaged ${space.name} for $${unmortgageCost}.`);
    },

    sellBuilding: (G, ctx, propertyId) => {
      if (G.phase !== 'play') return INVALID_MOVE;
      if (!G.hasRolled) return INVALID_MOVE;

      const player = G.players[ctx.currentPlayer];
      const space = _boardSpaces[propertyId];

      if (!space || space.type !== 'property') return INVALID_MOVE;
      if (G.ownership[propertyId] !== ctx.currentPlayer) return INVALID_MOVE;

      const currentLevel = G.buildings[propertyId] || 0;
      if (currentLevel <= 0) return INVALID_MOVE;

      // Even building in reverse: can only sell from highest level in group
      if (space.color && _colorGroups[space.color]) {
        const groupIds = _colorGroups[space.color];
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
      const space = _boardSpaces[player.position];

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
        const space = _boardSpaces[player.position];
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
        G.messages.push(`No bids. ${_boardSpaces[auction.propertyId].name} remains unowned.`);
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
