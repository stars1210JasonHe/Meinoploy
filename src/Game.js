import { INVALID_MOVE } from 'boardgame.io/core';
import { UPGRADE_COST_MULTIPLIERS, RENT_MULTIPLIERS, BUILDING_NAMES, SEASONS, SEASON_CHANGE_INTERVAL } from './constants';
import { BOARD_SPACES, CHANCE_CARDS, COMMUNITY_CARDS, COLOR_GROUPS, getCharacterById, getStartingMoney } from '../mods/dominion';

const BASE_STARTING_MONEY = 1500;
const GO_SALARY = 200;
const JAIL_POSITION = 10;
const JAIL_FINE = 50;

function createPlayer(id) {
  return {
    id,
    money: BASE_STARTING_MONEY,
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
  if (!color || !COLOR_GROUPS[color]) return false;
  return COLOR_GROUPS[color].every(id => G.ownership[id] === playerId);
}

function getEffectiveBuyPrice(G, player, space) {
  let price = space.price;

  // Season price modifier
  price *= getSeasonPriceMod(G);

  if (!player.character) return Math.floor(price);

  // Negotiation stat: -1% per point (max -10%)
  const negDiscount = Math.min(player.character.stats.negotiation * 0.01, 0.10);
  price *= (1 - negDiscount);

  // Albert Victor passive: property price -10%
  if (getPassive(player) === 'financier') {
    price *= 0.90;
  }

  return Math.floor(price);
}

// --- Upgrade cost ---

function getUpgradeCost(G, player, space, targetLevel) {
  let cost = space.price * UPGRADE_COST_MULTIPLIERS[targetLevel - 1];

  // Season price modifier affects upgrade cost
  cost *= getSeasonPriceMod(G);

  if (player.character) {
    // Tech stat: -2% per point (max -20%)
    const techDiscount = Math.min(player.character.stats.tech * 0.02, 0.20);
    cost *= (1 - techDiscount);
    // Lia Startrace passive: -20% upgrade cost
    if (getPassive(player) === 'pioneer') {
      cost *= 0.80;
    }
  }
  return Math.floor(cost);
}

// --- Season helpers ---

function getCurrentSeason(G) {
  return SEASONS[G.seasonIndex];
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
  const d1 = Math.floor(ctx.random.Number() * 6) + 1;
  const d2 = Math.floor(ctx.random.Number() * 6) + 1;
  return { d1, d2, total: d1 + d2, isDoubles: d1 === d2 };
}

function drawCard(ctx, deck) {
  const index = Math.floor(ctx.random.Number() * deck.length);
  return deck[index];
}

// --- Rent calculation ---

function countOwnedRailroads(G, ownerID) {
  return G.players[ownerID].properties.filter(pid => {
    return BOARD_SPACES[pid].type === 'railroad';
  }).length;
}

function countOwnedUtilities(G, ownerID) {
  return G.players[ownerID].properties.filter(pid => {
    return BOARD_SPACES[pid].type === 'utility';
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
    rent = 25 * Math.pow(2, count - 1);
  } else if (space.type === 'utility') {
    const count = countOwnedUtilities(G, owner);
    rent = count === 1 ? diceTotal * 4 : diceTotal * 10;
  } else {
    const buildingLevel = G.buildings[space.id] || 0;
    if (buildingLevel > 0) {
      // Building rent replaces monopoly bonus
      rent = space.rent * RENT_MULTIPLIERS[buildingLevel];
    } else {
      rent = space.rent;
      // Monopoly bonus: double rent if owner has full color group (no buildings)
      if (space.color && ownsColorGroup(G, owner, space.color)) {
        rent *= 2;
      }
    }
  }

  // Season rent modifier (Winter: +20%)
  rent *= getSeasonRentMod(G);

  // Character effects only apply if visitor has a character
  if (visitor && visitor.character) {
    // Charisma stat: -1% per point (max -10%)
    const chaDiscount = Math.min(visitor.character.stats.charisma * 0.01, 0.10);
    rent *= (1 - chaDiscount);

    // Knox regulated property: +20% rent
    const ownerPlayer = G.players[owner];
    if (ownerPlayer.regulatedProperty === space.id) {
      rent *= 1.20;
    }

    // Renn anti-monopoly: -25% rent on full color set properties
    if (getPassive(visitor) === 'breaker' && space.color && ownsColorGroup(G, owner, space.color)) {
      rent *= 0.75;
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

  // Sophia Ember passive: gain $100 when any player goes bankrupt
  G.players.forEach(p => {
    if (p.id !== player.id && !p.bankrupt && getPassive(p) === 'arbitrageur') {
      p.money += 100;
      G.messages.push(`${playerName(p)} gains $100 from crisis arbitrage!`);
    }
  });
}

// --- Landing ---

function handleLanding(G, ctx) {
  const player = G.players[ctx.currentPlayer];
  const space = BOARD_SPACES[player.position];
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
      // Albert Victor passive: financial negative event losses -20%
      if (getPassive(player) === 'financier') {
        taxAmount = Math.floor(taxAmount * 0.80);
        messages.push(`Financial expertise reduces tax to $${taxAmount}.`);
      }
      player.money -= taxAmount;
      messages.push(`Paid $${taxAmount} in ${space.name}.`);
      if (player.money <= 0) {
        handleBankruptcy(G, ctx, player, null);
      }
      break;
    }

    case 'chance': {
      const card = drawCard(ctx, CHANCE_CARDS);
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
      const card = drawCard(ctx, COMMUNITY_CARDS);
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
      player.position = JAIL_POSITION;
      player.inJail = true;
      player.jailTurns = 0;
      messages.push('Go to Jail!');
      break;

    case 'jail':
      messages.push('Just visiting jail.');
      break;

    case 'parking':
      messages.push('Free Parking - relax!');
      break;
  }
}

function getTotalAssets(G, player) {
  let total = player.money;
  player.properties.forEach(pid => {
    total += BOARD_SPACES[pid].price;
    const level = G.buildings[pid] || 0;
    for (let i = 1; i <= level; i++) {
      total += Math.floor(BOARD_SPACES[pid].price * UPGRADE_COST_MULTIPLIERS[i - 1]);
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
      // Albert Victor passive: financial negative event losses -20%
      if (getPassive(player) === 'financier') {
        amount = Math.floor(amount * 0.80);
        G.messages.push(`Financial expertise reduces loss to $${amount}.`);
      }
      player.money -= amount;
      if (player.money <= 0) {
        handleBankruptcy(G, ctx, player, null);
      }
      break;
    }
    case 'moveTo': {
      const oldPos = player.position;
      player.position = card.value;
      if (card.value < oldPos && card.value !== JAIL_POSITION) {
        let goBonus = GO_SALARY;
        // Mira Dawnlight passive: +$50 GO bonus
        if (getPassive(player) === 'idealist') {
          goBonus += 50;
          G.messages.push('Growth vision: extra $50 from GO!');
        }
        player.money += goBonus;
        G.messages.push(`Passed GO! Collect $${goBonus}.`);
      }
      handleLanding(G, ctx);
      break;
    }
    case 'goToJail':
      player.position = JAIL_POSITION;
      player.inJail = true;
      player.jailTurns = 0;
      break;

    // --- Enhanced card actions ---

    case 'payPercent': {
      // Pay X% of total assets
      const assets = getTotalAssets(G, player);
      let amount = Math.floor(assets * card.value / 100);
      if (getPassive(player) === 'financier') {
        amount = Math.floor(amount * 0.80);
        G.messages.push(`Financial expertise reduces loss to $${amount}.`);
      }
      player.money -= amount;
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
          const sp = BOARD_SPACES[pid];
          if (sp.type !== 'property' || !sp.color) return false;
          if (!ownsColorGroup(G, player.id, sp.color)) return false;
          const level = G.buildings[pid] || 0;
          if (level >= 4) return false;
          const groupIds = COLOR_GROUPS[sp.color];
          if (groupIds.some(id => G.mortgaged[id])) return false;
          const minLevel = Math.min(...groupIds.map(id => G.buildings[id] || 0));
          return level <= minLevel;
        })
        .sort((a, b) => BOARD_SPACES[a].price - BOARD_SPACES[b].price);

      if (upgradeable.length > 0) {
        const pid = upgradeable[0];
        const level = (G.buildings[pid] || 0) + 1;
        G.buildings[pid] = level;
        G.messages.push(`Free upgrade! ${BOARD_SPACES[pid].name} upgraded to ${BUILDING_NAMES[level]}!`);
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
        G.messages.push(`Market Crash! ${BOARD_SPACES[pid].name} downgraded to ${BUILDING_NAMES[newLevel]}.`);
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
          if (BOARD_SPACES[pid].price < cheapestPrice) {
            cheapestPrice = BOARD_SPACES[pid].price;
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
          G.messages.push(`Hostile Takeover! Bought ${BOARD_SPACES[cheapestPid].name} from ${playerName(targetOwner)} for $${cost}!`);
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
  return undefined;
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
    BOARD_SPACES.forEach(space => {
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
      const newSeasonIndex = Math.floor(G.totalTurns / SEASON_CHANGE_INTERVAL) % SEASONS.length;
      if (newSeasonIndex !== G.seasonIndex) {
        G.seasonIndex = newSeasonIndex;
        const season = SEASONS[G.seasonIndex];
        G.messages.push(`${season.icon} Season changed to ${season.name}!`);
      }

      const player = G.players[ctx.currentPlayer];
      if (player.bankrupt) return;
      if (player.inJail) {
        G.messages.push(`${playerName(player)} is in jail. Pay $${JAIL_FINE} or try to roll doubles.`);
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

      // Luck stat ≥ 8: 1 free card redraw per game
      if (char.stats.luck >= 8) {
        player.luckRedraws = 1;
      }
      // Evelyn Zero passive: additional redraw
      if (char.passive.id === 'speculator') {
        player.luckRedraws += 1;
      }
      // Stamina stat ≥ 7: 1 free reroll per game
      if (char.stats.stamina >= 7) {
        player.rerollsLeft = 1;
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
        if (G.doublesCount >= 3) {
          player.position = JAIL_POSITION;
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
          if (player.jailTurns >= 3) {
            player.money -= JAIL_FINE;
            player.inJail = false;
            player.jailTurns = 0;
            G.messages.push(`3 turns in jail. Paid $${JAIL_FINE} fine.`);
            if (player.money <= 0) {
              handleBankruptcy(G, ctx, player, null);
              G.turnPhase = 'done';
              return;
            }
          } else {
            G.messages.push(`Still in jail. Turn ${player.jailTurns}/3.`);
            G.turnPhase = 'done';
            return;
          }
        }
      }

      const oldPos = player.position;
      player.position = (player.position + dice.total) % 40;

      if (player.position < oldPos && BOARD_SPACES[player.position].type !== 'goToJail') {
        let goBonus = GO_SALARY;
        // Mira Dawnlight passive: +$50 GO bonus
        if (getPassive(player) === 'idealist') {
          goBonus += 50;
          G.messages.push('Growth vision: extra $50 from GO!');
        }
        player.money += goBonus;
        G.messages.push(`Passed GO! Collect $${goBonus}.`);
      }

      G.messages.push(`Landed on ${BOARD_SPACES[player.position].name}.`);
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

      const deck = G.pendingCard.deck === 'chance' ? CHANCE_CARDS : COMMUNITY_CARDS;
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
      G.messages.push(`${playerName(player)} regulates ${BOARD_SPACES[propertyId].name}! (+20% rent)`);
    },

    // --- Property upgrades ---
    upgradeProperty: (G, ctx, propertyId) => {
      if (G.phase !== 'play') return INVALID_MOVE;
      if (!G.hasRolled) return INVALID_MOVE;

      const player = G.players[ctx.currentPlayer];
      const space = BOARD_SPACES[propertyId];

      if (!space || space.type !== 'property') return INVALID_MOVE;
      if (G.ownership[propertyId] !== ctx.currentPlayer) return INVALID_MOVE;
      if (!space.color || !ownsColorGroup(G, ctx.currentPlayer, space.color)) return INVALID_MOVE;

      // No mortgaged properties in group
      const groupIds = COLOR_GROUPS[space.color];
      if (groupIds.some(id => G.mortgaged[id])) return INVALID_MOVE;

      const currentLevel = G.buildings[propertyId] || 0;
      if (currentLevel >= 4) return INVALID_MOVE;

      // Even building: can only upgrade if at minimum level in group
      const minLevel = Math.min(...groupIds.map(id => G.buildings[id] || 0));
      if (currentLevel > minLevel) return INVALID_MOVE;

      const targetLevel = currentLevel + 1;
      const cost = getUpgradeCost(G, player, space, targetLevel);
      if (player.money < cost) return INVALID_MOVE;

      player.money -= cost;
      G.buildings[propertyId] = targetLevel;
      G.messages.push(`Built ${BUILDING_NAMES[targetLevel]} on ${space.name} for $${cost}!`);
    },

    mortgageProperty: (G, ctx, propertyId) => {
      if (G.phase !== 'play') return INVALID_MOVE;

      const player = G.players[ctx.currentPlayer];
      const space = BOARD_SPACES[propertyId];
      if (!space) return INVALID_MOVE;

      if (G.ownership[propertyId] !== ctx.currentPlayer) return INVALID_MOVE;
      if (G.mortgaged[propertyId]) return INVALID_MOVE;

      // Can't mortgage property with buildings
      if ((G.buildings[propertyId] || 0) > 0) return INVALID_MOVE;

      // Can't mortgage if any property in color group has buildings
      if (space.color && COLOR_GROUPS[space.color]) {
        if (COLOR_GROUPS[space.color].some(id => (G.buildings[id] || 0) > 0)) {
          return INVALID_MOVE;
        }
      }

      G.mortgaged[propertyId] = true;
      const mortgageValue = Math.floor(space.price * 0.5 * getSeasonPriceMod(G));
      player.money += mortgageValue;
      G.messages.push(`Mortgaged ${space.name} for $${mortgageValue}.`);
    },

    unmortgageProperty: (G, ctx, propertyId) => {
      if (G.phase !== 'play') return INVALID_MOVE;

      const player = G.players[ctx.currentPlayer];
      const space = BOARD_SPACES[propertyId];
      if (!space) return INVALID_MOVE;

      if (G.ownership[propertyId] !== ctx.currentPlayer) return INVALID_MOVE;
      if (!G.mortgaged[propertyId]) return INVALID_MOVE;

      const unmortgageCost = Math.floor(space.price * 0.55 * getSeasonPriceMod(G));
      if (player.money < unmortgageCost) return INVALID_MOVE;

      player.money -= unmortgageCost;
      G.mortgaged[propertyId] = false;
      G.messages.push(`Unmortgaged ${space.name} for $${unmortgageCost}.`);
    },

    // --- Buy property ---
    buyProperty: (G, ctx) => {
      if (!G.canBuy) return INVALID_MOVE;
      const player = G.players[ctx.currentPlayer];
      const space = BOARD_SPACES[player.position];

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
      G.messages.push('Passed on buying.');
      G.turnPhase = 'done';
    },

    payJailFine: (G, ctx) => {
      if (G.phase !== 'play') return INVALID_MOVE;
      const player = G.players[ctx.currentPlayer];
      if (!player.inJail) return INVALID_MOVE;
      if (G.hasRolled) return INVALID_MOVE;

      if (player.money < JAIL_FINE) {
        G.messages.push(`Not enough money to pay $${JAIL_FINE} fine!`);
        return INVALID_MOVE;
      }

      player.money -= JAIL_FINE;
      player.inJail = false;
      player.jailTurns = 0;
      G.messages = [`${playerName(player)} paid $${JAIL_FINE} to get out of jail.`];
    },

    endTurn: (G, ctx) => {
      if (G.phase === 'characterSelect') return INVALID_MOVE;
      if (!G.hasRolled) return INVALID_MOVE;
      if (G.canBuy) return INVALID_MOVE;
      if (G.pendingCard) return INVALID_MOVE;
      G.turnPhase = 'roll';
      ctx.events.endTurn();
    },
  },

  endIf: (G, ctx) => {
    if (G.phase !== 'play') return undefined;
    return checkGameOver(G);
  },
};
