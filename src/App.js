import { Client } from 'boardgame.io/client';
import { Monopoly } from './Game';
import { BOARD_SPACES, PLAYER_COLORS } from './boardData';

const BOARD_SIZE = 11; // 11x11 grid

// Map board space IDs to grid positions (row, col) — clockwise from bottom-left
function getBoardPositions() {
  const pos = {};
  // Bottom row: spaces 0-10 (right to left)
  for (let i = 0; i <= 10; i++) {
    pos[i] = { row: 10, col: 10 - i };
  }
  // Left column: spaces 11-19 (bottom to top)
  for (let i = 11; i <= 19; i++) {
    pos[i] = { row: 10 - (i - 10), col: 0 };
  }
  // Top row: spaces 20-30 (left to right)
  for (let i = 20; i <= 30; i++) {
    pos[i] = { row: 0, col: i - 20 };
  }
  // Right column: spaces 31-39 (top to bottom)
  for (let i = 31; i <= 39; i++) {
    pos[i] = { row: i - 30, col: 10 };
  }
  return pos;
}

const POSITIONS = getBoardPositions();

function getSpaceTypeIcon(space) {
  switch (space.type) {
    case 'go': return '\u{27A1}\u{FE0F}';
    case 'chance': return '\u{2753}';
    case 'community': return '\u{1F4E6}';
    case 'tax': return '\u{1F4B0}';
    case 'railroad': return '\u{1F682}';
    case 'utility': return space.name.includes('Electric') ? '\u{1F4A1}' : '\u{1F6B0}';
    case 'jail': return '\u{1F46E}';
    case 'parking': return '\u{1F17F}\u{FE0F}';
    case 'goToJail': return '\u{1F6A8}';
    default: return '';
  }
}

class MonopolyBoard {
  constructor(rootElement) {
    this.rootElement = rootElement;
    this.client = Client({
      game: Monopoly,
      numPlayers: 2,
    });
    this.client.start();
    this.client.subscribe(state => this.update(state));
    this.createLayout();
  }

  createLayout() {
    this.rootElement.innerHTML = `
      <div class="game-container">
        <div class="header">
          <h1>\u{1F3E0} MEINOPOLY \u{1F3E0}</h1>
        </div>
        <div class="main-layout">
          <div class="left-panel">
            <div id="player-info"></div>
          </div>
          <div class="board-wrapper">
            <div id="board" class="board"></div>
          </div>
          <div class="right-panel">
            <div id="dice-area"></div>
            <div id="actions"></div>
            <div id="messages"></div>
          </div>
        </div>
      </div>
    `;
    this.boardEl = document.getElementById('board');
    this.playerInfoEl = document.getElementById('player-info');
    this.diceAreaEl = document.getElementById('dice-area');
    this.actionsEl = document.getElementById('actions');
    this.messagesEl = document.getElementById('messages');
  }

  update(state) {
    if (state === null) return;
    const G = state.G;
    const ctx = state.ctx;
    this.renderBoard(G, ctx);
    this.renderPlayerInfo(G, ctx);
    this.renderDice(G);
    this.renderActions(G, ctx);
    this.renderMessages(G);
  }

  renderBoard(G, ctx) {
    let html = '';

    // Create the 11x11 grid
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        // Find if a board space belongs to this cell
        const spaceEntry = Object.entries(POSITIONS).find(
          ([id, p]) => p.row === row && p.col === col
        );

        if (spaceEntry) {
          const spaceId = parseInt(spaceEntry[0]);
          const space = BOARD_SPACES[spaceId];
          const isCorner = [0, 10, 20, 30].includes(spaceId);
          const owner = G.ownership[spaceId];
          const ownerColor = owner !== null && owner !== undefined ? PLAYER_COLORS[parseInt(owner)] : '';

          // Find players on this space
          const playersHere = G.players
            .filter(p => !p.bankrupt && p.position === spaceId)
            .map(p => `<span class="player-token" style="background:${PLAYER_COLORS[parseInt(p.id)]}">${parseInt(p.id) + 1}</span>`)
            .join('');

          const colorBar = space.color
            ? `<div class="color-bar" style="background:${space.color}"></div>`
            : '';

          const ownerDot = ownerColor
            ? `<div class="owner-dot" style="background:${ownerColor}"></div>`
            : '';

          const icon = getSpaceTypeIcon(space);
          const priceTag = space.price > 0 ? `<div class="price">$${space.price}</div>` : '';

          // Determine side for color bar placement
          let side = '';
          if (row === 10 && col > 0 && col < 10) side = 'bottom';
          else if (row === 0 && col > 0 && col < 10) side = 'top';
          else if (col === 0 && row > 0 && row < 10) side = 'left';
          else if (col === 10 && row > 0 && row < 10) side = 'right';

          html += `
            <div class="cell ${isCorner ? 'corner' : ''} side-${side}" data-space="${spaceId}">
              ${colorBar}
              <div class="cell-content">
                <div class="space-name">${icon} ${space.name}</div>
                ${priceTag}
                ${ownerDot}
                <div class="tokens">${playersHere}</div>
              </div>
            </div>`;
        } else {
          // Center area
          if (row === 4 && col === 4) {
            html += `<div class="center-area" style="grid-row: 2 / 10; grid-column: 2 / 10;">
              <div class="center-logo">
                <div class="logo-text">MEINOPOLY</div>
                <div class="logo-sub">A boardgame.io demo</div>
              </div>
            </div>`;
          } else if (row >= 1 && row <= 9 && col >= 1 && col <= 9) {
            // Skip — covered by center-area
            continue;
          } else {
            html += `<div class="cell empty"></div>`;
          }
        }
      }
    }

    this.boardEl.innerHTML = html;
  }

  renderPlayerInfo(G, ctx) {
    let html = '<h2>Players</h2>';
    G.players.forEach((player, i) => {
      const isCurrent = ctx.currentPlayer === String(i);
      const propCount = player.properties.length;
      const propList = player.properties
        .map(pid => `<span class="prop-badge" style="border-color:${BOARD_SPACES[pid].color || '#666'}">${BOARD_SPACES[pid].name}</span>`)
        .join('');

      html += `
        <div class="player-card ${isCurrent ? 'active' : ''} ${player.bankrupt ? 'bankrupt' : ''}">
          <div class="player-header">
            <span class="player-dot" style="background:${PLAYER_COLORS[i]}"></span>
            <strong>Player ${i + 1}</strong>
            ${isCurrent ? '<span class="turn-badge">\u{25C0} TURN</span>' : ''}
            ${player.bankrupt ? '<span class="bankrupt-badge">BANKRUPT</span>' : ''}
          </div>
          <div class="player-money">$${player.money}</div>
          <div class="player-position">Position: ${BOARD_SPACES[player.position].name}</div>
          ${player.inJail ? '<div class="jail-badge">\u{1F46E} IN JAIL</div>' : ''}
          <div class="player-props">${propCount} properties ${propList ? '<br>' + propList : ''}</div>
        </div>`;
    });
    this.playerInfoEl.innerHTML = html;
  }

  renderDice(G) {
    if (!G.lastDice) {
      this.diceAreaEl.innerHTML = '<div class="dice-display"><div class="dice">?</div><div class="dice">?</div></div>';
      return;
    }
    const d = G.lastDice;
    this.diceAreaEl.innerHTML = `
      <div class="dice-display">
        <div class="dice">${this.getDiceFace(d.d1)}</div>
        <div class="dice">${this.getDiceFace(d.d2)}</div>
      </div>
      <div class="dice-total">Total: ${d.total}${d.isDoubles ? ' (DOUBLES!)' : ''}</div>
    `;
  }

  getDiceFace(n) {
    const faces = ['\u2680', '\u2681', '\u2682', '\u2683', '\u2684', '\u2685'];
    return faces[n - 1] || n;
  }

  renderActions(G, ctx) {
    if (ctx.gameover) {
      this.actionsEl.innerHTML = `
        <div class="game-over">
          <h2>\u{1F3C6} Game Over!</h2>
          <p>Player ${parseInt(ctx.gameover.winner) + 1} wins!</p>
        </div>`;
      return;
    }

    const player = G.players[ctx.currentPlayer];
    let html = `<h3>Player ${parseInt(ctx.currentPlayer) + 1}'s Turn</h3>`;

    if (player.inJail && !G.hasRolled) {
      html += `<button id="btn-jail" class="btn btn-warning">Pay $50 Fine</button>`;
      html += `<button id="btn-roll" class="btn btn-primary">Roll for Doubles</button>`;
    } else if (!G.hasRolled) {
      html += `<button id="btn-roll" class="btn btn-primary">\u{1F3B2} Roll Dice</button>`;
    }

    if (G.canBuy) {
      const space = BOARD_SPACES[player.position];
      html += `<button id="btn-buy" class="btn btn-success">\u{1F3E0} Buy ${space.name} ($${space.price})</button>`;
      html += `<button id="btn-pass" class="btn btn-secondary">Pass</button>`;
    }

    if (G.hasRolled && !G.canBuy) {
      html += `<button id="btn-end" class="btn btn-end">End Turn \u{27A1}\u{FE0F}</button>`;
    }

    this.actionsEl.innerHTML = html;

    // Attach event listeners
    const rollBtn = document.getElementById('btn-roll');
    const buyBtn = document.getElementById('btn-buy');
    const passBtn = document.getElementById('btn-pass');
    const endBtn = document.getElementById('btn-end');
    const jailBtn = document.getElementById('btn-jail');

    if (rollBtn) rollBtn.onclick = () => this.client.moves.rollDice();
    if (buyBtn) buyBtn.onclick = () => this.client.moves.buyProperty();
    if (passBtn) passBtn.onclick = () => this.client.moves.passProperty();
    if (endBtn) endBtn.onclick = () => this.client.moves.endTurn();
    if (jailBtn) jailBtn.onclick = () => this.client.moves.payJailFine();
  }

  renderMessages(G) {
    const html = G.messages
      .map(m => `<div class="message">${m}</div>`)
      .join('');
    this.messagesEl.innerHTML = `<h3>\u{1F4DC} Log</h3><div class="message-list">${html}</div>`;
  }
}

const appElement = document.getElementById('app');
new MonopolyBoard(appElement);
