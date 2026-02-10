import { INVALID_MOVE } from 'boardgame.io/core';
import { BOARD_SPACES, CHANCE_CARDS, COMMUNITY_CARDS } from './boardData';

const NUM_PLAYERS = 2;
const STARTING_MONEY = 1500;
const GO_SALARY = 200;
const JAIL_POSITION = 10;
const JAIL_FINE = 50;

function createPlayer(id) {
  return {
    id,
    money: STARTING_MONEY,
    position: 0,
    properties: [],
    inJail: false,
    jailTurns: 0,
    bankrupt: false,
  };
}

function rollTwoDice(ctx) {
  const d1 = Math.floor(ctx.random.Number() * 6) + 1;
  const d2 = Math.floor(ctx.random.Number() * 6) + 1;
  return { d1, d2, total: d1 + d2, isDoubles: d1 === d2 };
}

function drawCard(ctx, deck) {
  const index = Math.floor(ctx.random.Number() * deck.length);
  return deck[index];
}

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

function calculateRent(G, space, diceTotal) {
  const owner = G.ownership[space.id];
  if (owner === null || owner === undefined) return 0;

  if (space.type === 'railroad') {
    const count = countOwnedRailroads(G, owner);
    return 25 * Math.pow(2, count - 1);
  }
  if (space.type === 'utility') {
    const count = countOwnedUtilities(G, owner);
    return count === 1 ? diceTotal * 4 : diceTotal * 10;
  }
  return space.rent;
}

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
        if (player.money >= space.price) {
          G.canBuy = true;
          messages.push(`${space.name} is available for $${space.price}. Buy or pass?`);
        } else {
          messages.push(`${space.name} costs $${space.price} but you only have $${player.money}.`);
        }
      } else if (owner !== ctx.currentPlayer) {
        const rent = calculateRent(G, space, G.lastDice.total);
        player.money -= rent;
        G.players[owner].money += rent;
        messages.push(`Paid $${rent} rent to Player ${parseInt(owner) + 1} for ${space.name}.`);
        if (player.money <= 0) {
          player.bankrupt = true;
          player.money = 0;
          messages.push(`Player ${parseInt(ctx.currentPlayer) + 1} is BANKRUPT!`);
          // Transfer properties to the rent collector
          player.properties.forEach(pid => {
            G.ownership[pid] = owner;
            G.players[owner].properties.push(pid);
          });
          player.properties = [];
        }
      } else {
        messages.push(`You own ${space.name}.`);
      }
      break;
    }

    case 'tax': {
      const taxAmount = space.rent;
      player.money -= taxAmount;
      messages.push(`Paid $${taxAmount} in ${space.name}.`);
      if (player.money <= 0) {
        player.bankrupt = true;
        player.money = 0;
        messages.push(`Player ${parseInt(ctx.currentPlayer) + 1} is BANKRUPT!`);
      }
      break;
    }

    case 'chance': {
      const card = drawCard(ctx, CHANCE_CARDS);
      messages.push(`CHANCE: ${card.text}`);
      applyCard(G, ctx, player, card);
      break;
    }

    case 'community': {
      const card = drawCard(ctx, COMMUNITY_CARDS);
      messages.push(`COMMUNITY CHEST: ${card.text}`);
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

function applyCard(G, ctx, player, card) {
  switch (card.action) {
    case 'gain':
      player.money += card.value;
      break;
    case 'pay':
      player.money -= card.value;
      if (player.money <= 0) {
        player.bankrupt = true;
        player.money = 0;
        G.messages.push(`Player ${parseInt(ctx.currentPlayer) + 1} is BANKRUPT!`);
      }
      break;
    case 'moveTo': {
      const oldPos = player.position;
      player.position = card.value;
      // Collect GO salary if passing GO
      if (card.value < oldPos && card.value !== JAIL_POSITION) {
        player.money += GO_SALARY;
        G.messages.push('Passed GO! Collect $200.');
      }
      // Handle landing on the new space
      handleLanding(G, ctx);
      break;
    }
    case 'goToJail':
      player.position = JAIL_POSITION;
      player.inJail = true;
      player.jailTurns = 0;
      break;
  }
}

function checkGameOver(G) {
  const activePlayers = G.players.filter(p => !p.bankrupt);
  if (activePlayers.length === 1) {
    return { winner: activePlayers[0].id };
  }
  return undefined;
}

export const Monopoly = {
  name: 'monopoly',

  setup: (ctx) => {
    const players = [];
    for (let i = 0; i < ctx.numPlayers; i++) {
      players.push(createPlayer(String(i)));
    }

    // ownership[spaceId] = playerID or null
    const ownership = {};
    BOARD_SPACES.forEach(space => {
      if (space.type === 'property' || space.type === 'railroad' || space.type === 'utility') {
        ownership[space.id] = null;
      }
    });

    return {
      players,
      ownership,
      lastDice: null,
      hasRolled: false,
      canBuy: false,
      messages: ['Game started! Player 1 rolls first.'],
      turnPhase: 'roll', // 'roll', 'act', 'done'
    };
  },

  turn: {
    onBegin: (G, ctx) => {
      G.hasRolled = false;
      G.canBuy = false;
      G.turnPhase = 'roll';
      G.lastDice = null;
      const player = G.players[ctx.currentPlayer];
      if (player.inJail) {
        G.messages.push(`Player ${parseInt(ctx.currentPlayer) + 1} is in jail. Pay $${JAIL_FINE} or try to roll doubles.`);
      }
    },
  },

  moves: {
    rollDice: (G, ctx) => {
      if (G.hasRolled) return INVALID_MOVE;
      const player = G.players[ctx.currentPlayer];
      if (player.bankrupt) return INVALID_MOVE;

      const dice = rollTwoDice(ctx);
      G.lastDice = dice;
      G.hasRolled = true;
      G.messages = [`Player ${parseInt(ctx.currentPlayer) + 1} rolled ${dice.d1} + ${dice.d2} = ${dice.total}`];

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
              player.bankrupt = true;
              player.money = 0;
              G.messages.push(`Player ${parseInt(ctx.currentPlayer) + 1} is BANKRUPT!`);
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

      // Move the player
      const oldPos = player.position;
      player.position = (player.position + dice.total) % 40;

      // Check if passed GO
      if (player.position < oldPos && BOARD_SPACES[player.position].type !== 'goToJail') {
        player.money += GO_SALARY;
        G.messages.push('Passed GO! Collect $200.');
      }

      G.messages.push(`Landed on ${BOARD_SPACES[player.position].name}.`);
      handleLanding(G, ctx);
      G.turnPhase = G.canBuy ? 'act' : 'done';
    },

    buyProperty: (G, ctx) => {
      if (!G.canBuy) return INVALID_MOVE;
      const player = G.players[ctx.currentPlayer];
      const space = BOARD_SPACES[player.position];

      if (player.money < space.price) return INVALID_MOVE;
      if (G.ownership[space.id] !== null) return INVALID_MOVE;

      player.money -= space.price;
      player.properties.push(space.id);
      G.ownership[space.id] = ctx.currentPlayer;
      G.canBuy = false;
      G.messages.push(`Bought ${space.name} for $${space.price}!`);
      G.turnPhase = 'done';
    },

    passProperty: (G, ctx) => {
      if (!G.canBuy) return INVALID_MOVE;
      G.canBuy = false;
      G.messages.push('Passed on buying.');
      G.turnPhase = 'done';
    },

    payJailFine: (G, ctx) => {
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
      G.messages = [`Player ${parseInt(ctx.currentPlayer) + 1} paid $${JAIL_FINE} to get out of jail.`];
    },

    endTurn: (G, ctx) => {
      if (!G.hasRolled) return INVALID_MOVE;
      if (G.canBuy) return INVALID_MOVE;
      G.turnPhase = 'roll';
      ctx.events.endTurn();
    },
  },

  endIf: (G, ctx) => {
    return checkGameOver(G);
  },
};
