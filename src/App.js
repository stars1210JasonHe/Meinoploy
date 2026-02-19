import { Client } from 'boardgame.io/client';
import { SocketIO } from 'boardgame.io/multiplayer';
import { Monopoly } from './Game';
import { PLAYER_COLORS, BUILDING_ICONS, BUILDING_NAMES, UPGRADE_COST_MULTIPLIERS, RENT_MULTIPLIERS, SEASONS } from './constants';
import { BOARD_SPACES, COLOR_GROUPS, CHARACTERS, getLoreById, RULES } from '../mods/dominion';
import { Lobby } from './Lobby';

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

// Render Chinese lore text: paragraphs + bold markers
function renderLoreText(text) {
  if (!text) return '';
  return text
    .split('\n\n')
    .map(p => {
      let html = p.replace(/\n/g, '<br/>');
      html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      if (html.startsWith('&gt; ') || html.startsWith('> ')) {
        html = html.replace(/^(&gt; |> )/, '');
        return `<blockquote>${html}</blockquote>`;
      }
      return `<p>${html}</p>`;
    })
    .join('');
}

// Simple stats bar renderer
function renderStatBar(label, value, max) {
  const pct = (value / max) * 100;
  return `<div class="stat-row">
    <span class="stat-label">${label}</span>
    <div class="stat-bar"><div class="stat-fill" style="width:${pct}%;"></div></div>
    <span class="stat-val">${value}</span>
  </div>`;
}

class MonopolyBoard {
  constructor(rootElement) {
    this.rootElement = rootElement;
    this.mode = null; // 'local' or 'online'
    this.onlinePlayerID = null;
    this.createLayout();
    this.showModeSelect();
  }

  showModeSelect() {
    this.charSelectEl.style.display = 'none';
    this.gameAreaEl.style.display = 'none';
    this.seasonDisplayEl.style.display = 'none';
    this.lobbyEl.style.display = 'none';
    this.playerCountEl.style.display = 'block';

    this.playerCountEl.innerHTML = `
      <div class="count-select-header">
        <h2>Select Game Mode</h2>
        <p class="count-select-sub">Play locally or online with friends</p>
      </div>
      <div class="count-grid">
        <button class="count-btn mode-btn" id="btn-mode-local">Local Game</button>
        <button class="count-btn mode-btn" id="btn-mode-online">Online Game</button>
      </div>`;

    document.getElementById('btn-mode-local').onclick = () => {
      this.mode = 'local';
      this.showPlayerCountSelect();
    };
    document.getElementById('btn-mode-online').onclick = () => {
      this.mode = 'online';
      this.showOnlineLobby();
    };
  }

  showPlayerCountSelect() {
    this.charSelectEl.style.display = 'none';
    this.gameAreaEl.style.display = 'none';
    this.seasonDisplayEl.style.display = 'none';
    this.lobbyEl.style.display = 'none';
    this.playerCountEl.style.display = 'block';

    let html = `
      <div class="count-select-header">
        <h2>How Many Players?</h2>
        <p class="count-select-sub">Select 2-10 players for local hot-seat play</p>
      </div>
      <div class="count-grid">`;
    for (let n = 2; n <= 10; n++) {
      html += `<button class="count-btn" data-count="${n}">${n} Players</button>`;
    }
    html += `</div>
      <div style="text-align:center;margin-top:16px;">
        <button id="btn-back-mode" class="btn btn-secondary" style="display:inline-block;width:auto;">Back</button>
      </div>`;
    this.playerCountEl.innerHTML = html;

    this.playerCountEl.querySelectorAll('.count-btn').forEach(btn => {
      if (btn.dataset.count) {
        btn.onclick = () => {
          this.startGameWithPlayers(parseInt(btn.dataset.count));
        };
      }
    });
    document.getElementById('btn-back-mode').onclick = () => this.showModeSelect();
  }

  showOnlineLobby() {
    this.playerCountEl.style.display = 'none';
    this.charSelectEl.style.display = 'none';
    this.gameAreaEl.style.display = 'none';
    this.lobbyEl.style.display = 'block';

    const serverUrl = window.location.protocol + '//' + window.location.hostname + ':8088';
    const lobby = new Lobby(this.lobbyEl, serverUrl, (matchID, playerID, credentials, numPlayers) => {
      this.startOnlineGame(serverUrl, matchID, playerID, credentials, numPlayers);
    });
    lobby.onBack = () => this.showModeSelect();
  }

  startOnlineGame(serverUrl, matchID, playerID, credentials, numPlayers) {
    this.lobbyEl.style.display = 'none';
    this.onlinePlayerID = playerID;
    this.client = Client({
      game: Monopoly,
      numPlayers: numPlayers,
      multiplayer: SocketIO({ server: serverUrl }),
      matchID: matchID,
      playerID: playerID,
      debug: false,
    });
    this.client.updateCredentials(credentials);
    this.client.start();
    this.client.subscribe(state => this.update(state));
  }

  startGameWithPlayers(numPlayers) {
    this.playerCountEl.style.display = 'none';
    this.client = Client({
      game: Monopoly,
      numPlayers: numPlayers,
      debug: false,
    });
    this.client.start();
    this.client.subscribe(state => this.update(state));
  }

  createLayout() {
    this.rootElement.innerHTML = `
      <div class="game-container">
        <div class="header">
          <h1>\u{1F3E0} MEINOPOLY \u{1F3E0}</h1>
          <div class="header-buttons">
            <button id="btn-load-menu" class="btn-header">Load Game</button>
          </div>
          <div id="season-display" class="season-display"></div>
        </div>
        <div id="load-panel" class="load-panel" style="display:none;"></div>
        <div id="player-count-select" class="character-select" style="display:none;"></div>
        <div id="online-lobby" class="character-select" style="display:none;"></div>
        <div id="character-select" class="character-select" style="display:none;"></div>
        <div id="game-area" class="main-layout" style="display:none;">
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
        <div id="lore-modal" class="lore-modal">
          <div class="lore-modal-content">
            <button class="lore-close">&times;</button>
            <div id="lore-body"></div>
          </div>
        </div>
      </div>
    `;
    this.playerCountEl = document.getElementById('player-count-select');
    this.lobbyEl = document.getElementById('online-lobby');
    this.charSelectEl = document.getElementById('character-select');
    this.loadPanelEl = document.getElementById('load-panel');
    this.gameAreaEl = document.getElementById('game-area');
    this.seasonDisplayEl = document.getElementById('season-display');

    // Load menu button
    document.getElementById('btn-load-menu').onclick = () => this.toggleLoadPanel();
    this.boardEl = document.getElementById('board');
    this.playerInfoEl = document.getElementById('player-info');
    this.diceAreaEl = document.getElementById('dice-area');
    this.actionsEl = document.getElementById('actions');
    this.messagesEl = document.getElementById('messages');
    this.loreModalEl = document.getElementById('lore-modal');
    this.loreBodyEl = document.getElementById('lore-body');

    // Close lore modal on backdrop or X click
    this.loreModalEl.addEventListener('click', (e) => {
      if (e.target.classList.contains('lore-modal') || e.target.classList.contains('lore-close')) {
        this.hideLoreModal();
      }
    });
  }

  update(state) {
    if (state === null) return;
    const G = state.G;
    const ctx = state.ctx;

    this.playerCountEl.style.display = 'none';

    if (G.phase === 'characterSelect') {
      this.charSelectEl.style.display = 'block';
      this.gameAreaEl.style.display = 'none';
      this.seasonDisplayEl.style.display = 'none';
      this.renderCharacterSelect(G, ctx);
    } else {
      this.charSelectEl.style.display = 'none';
      this.gameAreaEl.style.display = 'flex';
      this.seasonDisplayEl.style.display = 'flex';
      this.renderSeason(G);
      this.renderBoard(G, ctx);
      this.renderPlayerInfo(G, ctx);
      this.renderDice(G);
      this.renderActions(G, ctx);
      this.renderMessages(G);
    }
  }

  renderCharacterSelect(G, ctx) {
    const currentPlayer = parseInt(ctx.currentPlayer) + 1;
    const player = G.players[ctx.currentPlayer];

    // Find already-taken character IDs
    const takenIds = G.players
      .filter(p => p.character)
      .map(p => p.character.id);

    let html = `
      <div class="char-select-header">
        <h2>Player ${currentPlayer}, Choose Your Character</h2>
        <p class="char-select-sub">Each character has unique stats and a passive ability</p>
      </div>
      <div class="char-grid">`;

    CHARACTERS.forEach(char => {
      const taken = takenIds.includes(char.id);
      const takenBy = G.players.find(p => p.character && p.character.id === char.id);
      const takenLabel = takenBy ? ` (Player ${parseInt(takenBy.id) + 1})` : '';
      const startMoney = RULES.core.baseStartingMoney + char.stats.capital * RULES.stats.capital.startingMoneyBonus;

      html += `
        <div class="char-card ${taken ? 'taken' : ''}" data-char-id="${char.id}">
          <div class="char-portrait" style="border-color: ${char.color}">
            ${char.portrait
              ? `<img src="${char.portrait}" alt="${char.name}" />`
              : `<div class="char-placeholder">${char.name[0]}</div>`
            }
          </div>
          <div class="char-info">
            <div class="char-name" style="color: ${char.color}">${char.name}</div>
            <div class="char-title">${char.title}</div>
            <div class="char-stats">
              ${renderStatBar('CAP', char.stats.capital, 10)}
              ${renderStatBar('LCK', char.stats.luck, 10)}
              ${renderStatBar('NEG', char.stats.negotiation, 10)}
              ${renderStatBar('CHA', char.stats.charisma, 10)}
              ${renderStatBar('TEC', char.stats.tech, 10)}
              ${renderStatBar('STA', char.stats.stamina, 10)}
            </div>
            <div class="char-passive">${char.passive.name}: ${char.passive.description}</div>
            <div class="char-money">Starting: $${startMoney}</div>
            ${taken ? `<div class="char-taken">TAKEN${takenLabel}</div>` : ''}
            <button class="char-lore-btn" data-char-id="${char.id}">View Lore</button>
          </div>
        </div>`;
    });

    html += '</div>';

    // Show already selected players
    const selected = G.players.filter(p => p.character);
    if (selected.length > 0) {
      html += '<div class="char-selected-list">';
      selected.forEach(p => {
        html += `<span class="char-selected-badge" style="border-color: ${p.character.color}">
          Player ${parseInt(p.id) + 1}: ${p.character.name}
        </span>`;
      });
      html += '</div>';
    }

    this.charSelectEl.innerHTML = html;

    // Attach click handlers
    this.charSelectEl.querySelectorAll('.char-card:not(.taken)').forEach(card => {
      card.onclick = () => {
        const charId = card.dataset.charId;
        this.client.moves.selectCharacter(charId);
      };
    });

    // Lore button handlers
    this.charSelectEl.querySelectorAll('.char-lore-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        this.showLoreModal(btn.dataset.charId);
      };
    });
  }

  showLoreModal(charId) {
    const char = CHARACTERS.find(c => c.id === charId);
    const lore = getLoreById(charId);
    if (!char || !lore) return;

    this.loreBodyEl.innerHTML = `
      <div class="lore-header">
        <div class="lore-portrait" style="border-color: ${char.color}">
          ${char.portrait
            ? `<img src="${char.portrait}" alt="${char.name}" />`
            : `<div class="char-placeholder">${char.name[0]}</div>`
          }
        </div>
        <div class="lore-title-block">
          <div class="lore-name" style="color: ${char.color}">${lore.nameZh}（${char.name}）</div>
          <div class="lore-title-zh">${lore.titleZh}</div>
          <div class="lore-identity">${lore.identity}</div>
          <div class="lore-alignment">${lore.alignment}</div>
        </div>
      </div>

      <div class="lore-section">
        <h3>角色背景故事</h3>
        ${renderLoreText(lore.background)}
      </div>

      ${lore.noticed ? `<div class="lore-section">
        <h3>被议会注意到的原因</h3>
        ${renderLoreText(lore.noticed)}
      </div>` : ''}

      <div class="lore-section">
        <h3>加入维度议会</h3>
        ${renderLoreText(lore.joining)}
      </div>

      <div class="lore-section">
        <h3>行事风格</h3>
        ${lore.styleIntro ? renderLoreText(lore.styleIntro) : ''}
        <ol class="lore-beliefs">
          ${lore.style.map(s => `<li>${s.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</li>`).join('')}
        </ol>
        ${lore.styleOutro ? renderLoreText(lore.styleOutro) : ''}
      </div>

      <div class="lore-section">
        <h3>与其他代理人的关系</h3>
        <ul class="lore-relations">
          ${lore.relationships.map(r =>
            `<li><strong>${r.target}</strong>：${r.description}</li>`
          ).join('')}
        </ul>
      </div>

      <div class="lore-quote">
        <blockquote>${lore.themeSummary.replace(/\n/g, '<br/>')}</blockquote>
      </div>
    `;

    this.loreModalEl.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  hideLoreModal() {
    this.loreModalEl.style.display = 'none';
    document.body.style.overflow = '';
  }

  showTradeModal(G, ctx) {
    const player = G.players[ctx.currentPlayer];
    const opponents = G.players.filter(p => p.id !== ctx.currentPlayer && !p.bankrupt);
    if (opponents.length === 0) return;

    this._tradeState = { G, ctx, player, opponents, selectedIndex: 0 };
    this._renderTradeModalContent();
    this.loreModalEl.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  _renderTradeModalContent() {
    const { G, ctx, player, opponents, selectedIndex } = this._tradeState;
    const target = opponents[selectedIndex];

    const myProps = player.properties
      .filter(pid => (G.buildings[pid] || 0) === 0 && (!G.mortgaged[pid] || RULES.trading.allowMortgagedProperties))
      .map(pid => BOARD_SPACES[pid]);
    const targetProps = target.properties
      .filter(pid => (G.buildings[pid] || 0) === 0 && (!G.mortgaged[pid] || RULES.trading.allowMortgagedProperties))
      .map(pid => BOARD_SPACES[pid]);

    const playerName = player.character ? player.character.name : `Player ${parseInt(ctx.currentPlayer) + 1}`;
    const targetName = target.character ? target.character.name : `Player ${parseInt(target.id) + 1}`;

    // Target selector (dropdown for 3+ players)
    const targetSelector = opponents.length > 1
      ? `<div class="trade-target-select">
          <label>Trade with:
            <select id="trade-target-select">
              ${opponents.map((opp, i) => {
                const oppName = opp.character ? opp.character.name : `Player ${parseInt(opp.id) + 1}`;
                return `<option value="${i}" ${i === selectedIndex ? 'selected' : ''}>${oppName}</option>`;
              }).join('')}
            </select>
          </label>
        </div>`
      : '';

    this.loreBodyEl.innerHTML = `
      <div class="trade-modal-content">
        <h3>Propose Trade</h3>
        ${targetSelector}
        <div class="trade-builder">
          <div class="trade-col">
            <h4>${playerName} Offers:</h4>
            <div class="trade-props-select">
              ${myProps.map(sp => `
                <label class="trade-prop-option">
                  <input type="checkbox" value="${sp.id}" class="offer-prop" />
                  <span style="border-left: 3px solid ${sp.color || '#666'}; padding-left: 4px;">${sp.name}</span>
                </label>
              `).join('') || '<p>No tradeable properties</p>'}
            </div>
            ${RULES.trading.allowMoneyInTrade ? `
              <div class="trade-money-input">
                <label>Offer $: <input type="number" id="offer-money" min="0" max="${player.money}" value="0" /></label>
              </div>
            ` : ''}
          </div>
          <div class="trade-col">
            <h4>Request from ${targetName}:</h4>
            <div class="trade-props-select">
              ${targetProps.map(sp => `
                <label class="trade-prop-option">
                  <input type="checkbox" value="${sp.id}" class="request-prop" />
                  <span style="border-left: 3px solid ${sp.color || '#666'}; padding-left: 4px;">${sp.name}</span>
                </label>
              `).join('') || '<p>No tradeable properties</p>'}
            </div>
            ${RULES.trading.allowMoneyInTrade ? `
              <div class="trade-money-input">
                <label>Request $: <input type="number" id="request-money" min="0" max="${target.money}" value="0" /></label>
              </div>
            ` : ''}
          </div>
        </div>
        <div class="trade-submit">
          <button id="btn-submit-trade" class="btn btn-success">Send Proposal</button>
          <button id="btn-cancel-trade-modal" class="btn btn-secondary">Cancel</button>
        </div>
      </div>
    `;

    // Target selector change handler
    const selectEl = document.getElementById('trade-target-select');
    if (selectEl) {
      selectEl.onchange = () => {
        this._tradeState.selectedIndex = parseInt(selectEl.value);
        this._renderTradeModalContent();
      };
    }

    // Submit/cancel handlers
    document.getElementById('btn-submit-trade').onclick = () => {
      const offeredProperties = Array.from(document.querySelectorAll('.offer-prop:checked')).map(cb => parseInt(cb.value));
      const requestedProperties = Array.from(document.querySelectorAll('.request-prop:checked')).map(cb => parseInt(cb.value));
      const offerMoneyEl = document.getElementById('offer-money');
      const requestMoneyEl = document.getElementById('request-money');
      const offeredMoney = parseInt((offerMoneyEl && offerMoneyEl.value) || '0');
      const requestedMoney = parseInt((requestMoneyEl && requestMoneyEl.value) || '0');

      if (offeredProperties.length === 0 && requestedProperties.length === 0 && offeredMoney === 0 && requestedMoney === 0) {
        return;
      }

      this.client.moves.proposeTrade({
        targetPlayerId: target.id,
        offeredProperties,
        requestedProperties,
        offeredMoney,
        requestedMoney,
      });
      this.hideLoreModal();
    };
    document.getElementById('btn-cancel-trade-modal').onclick = () => {
      this.hideLoreModal();
    };
  }

  renderSeason(G) {
    const season = SEASONS[G.seasonIndex];
    let effects = '';
    if (season.priceMod !== 1.0) {
      const pct = Math.round((season.priceMod - 1) * 100);
      effects += `<span class="season-effect">Prices ${pct > 0 ? '+' : ''}${pct}%</span>`;
    }
    if (season.rentMod !== 1.0) {
      const pct = Math.round((season.rentMod - 1) * 100);
      effects += `<span class="season-effect">Rent +${pct}%</span>`;
    }
    if (season.taxMod !== 1.0) {
      effects += `<span class="season-effect">Tax x${season.taxMod}</span>`;
    }
    const turnLabel = RULES.core.maxTurns > 0
      ? `Turn ${G.totalTurns} / ${RULES.core.maxTurns}`
      : `Turn ${G.totalTurns}`;
    this.seasonDisplayEl.innerHTML = `
      <span class="season-icon">${season.icon}</span>
      <span class="season-name">${season.name}</span>
      <span class="season-turn">${turnLabel}</span>
      ${effects}
      ${RULES.core.freeParkingPot && G.freeParkingPot > 0
        ? `<span class="season-effect">Parking Pot: $${G.freeParkingPot}</span>`
        : ''}
    `;
  }

  renderBoard(G, ctx) {
    let html = '';

    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const spaceEntry = Object.entries(POSITIONS).find(
          ([id, p]) => p.row === row && p.col === col
        );

        if (spaceEntry) {
          const spaceId = parseInt(spaceEntry[0]);
          const space = BOARD_SPACES[spaceId];
          const isCorner = [0, 10, 20, 30].includes(spaceId);
          const owner = G.ownership[spaceId];
          const ownerColor = owner !== null && owner !== undefined ? PLAYER_COLORS[parseInt(owner)] : '';
          const buildingLevel = G.buildings[spaceId] || 0;
          const isMortgaged = G.mortgaged[spaceId] || false;

          const playersHere = G.players
            .filter(p => !p.bankrupt && p.position === spaceId)
            .map(p => {
              const color = p.character ? p.character.color : PLAYER_COLORS[parseInt(p.id)];
              const label = p.character ? p.character.name[0] : parseInt(p.id) + 1;
              return `<span class="player-token" style="background:${color}">${label}</span>`;
            })
            .join('');

          const colorBar = space.color
            ? `<div class="color-bar" style="background:${space.color}"></div>`
            : '';

          const ownerDot = ownerColor
            ? `<div class="owner-dot" style="background:${ownerColor}"></div>`
            : '';
          const buildingTag = buildingLevel > 0
            ? `<div class="building-icon">${BUILDING_ICONS[buildingLevel]}</div>`
            : '';
          const mortgageTag = isMortgaged
            ? `<div class="mortgage-badge">M</div>`
            : '';

          const icon = getSpaceTypeIcon(space);
          const priceTag = space.price > 0 ? `<div class="price">$${space.price}</div>` : '';
          const parkingPot = (space.type === 'parking' && RULES.core.freeParkingPot && G.freeParkingPot > 0)
            ? `<div class="parking-pot">$${G.freeParkingPot}</div>`
            : '';

          let side = '';
          if (row === 10 && col > 0 && col < 10) side = 'bottom';
          else if (row === 0 && col > 0 && col < 10) side = 'top';
          else if (col === 0 && row > 0 && row < 10) side = 'left';
          else if (col === 10 && row > 0 && row < 10) side = 'right';

          html += `
            <div class="cell ${isCorner ? 'corner' : ''} ${isMortgaged ? 'mortgaged' : ''} side-${side}" data-space="${spaceId}">
              ${colorBar}
              <div class="cell-content">
                <div class="space-name">${icon} ${space.name}</div>
                ${priceTag}
                ${buildingTag}${mortgageTag}
                ${parkingPot}
                ${ownerDot}
                <div class="tokens">${playersHere}</div>
              </div>
            </div>`;
        } else {
          if (row === 4 && col === 4) {
            html += `<div class="center-area" style="grid-row: 2 / 10; grid-column: 2 / 10;">
              <div class="center-logo">
                <div class="logo-text">MEINOPOLY</div>
                <div class="logo-sub">Dominion: Multi-dimensional World</div>
              </div>
            </div>`;
          } else if (row >= 1 && row <= 9 && col >= 1 && col <= 9) {
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
        .map(pid => {
          const sp = BOARD_SPACES[pid];
          const lvl = G.buildings[pid] || 0;
          const mort = G.mortgaged[pid] || false;
          const bIcon = lvl > 0 ? BUILDING_ICONS[lvl] + ' ' : '';
          const mTag = mort ? ' [M]' : '';
          return `<span class="prop-badge ${mort ? 'prop-mortgaged' : ''}" style="border-color:${sp.color || '#666'}">${bIcon}${sp.name}${mTag}</span>`;
        })
        .join('');

      const char = player.character;
      const displayName = char ? char.name : `Player ${i + 1}`;
      const charColor = char ? char.color : PLAYER_COLORS[i];

      // Ophelia: hide money from other players
      const isOphelia = char && char.passive.id === 'shadow';
      const hideFromOthers = isOphelia && !isCurrent;
      const moneyDisplay = hideFromOthers ? '$???' : `$${player.money}`;

      html += `
        <div class="player-card ${isCurrent ? 'active' : ''} ${player.bankrupt ? 'bankrupt' : ''}">
          <div class="player-header">
            ${char && char.portrait
              ? `<img class="player-avatar" src="${char.portrait}" alt="${char.name}" />`
              : `<span class="player-dot" style="background:${charColor}"></span>`
            }
            <div>
              <strong style="color:${charColor}">${displayName}</strong>
              ${char ? `<div class="player-title">${char.title}</div>` : ''}
            </div>
            ${isCurrent ? '<span class="turn-badge">\u{25C0} TURN</span>' : ''}
            ${player.bankrupt ? '<span class="bankrupt-badge">BANKRUPT</span>' : ''}
          </div>
          <div class="player-money ${hideFromOthers ? 'money-hidden' : ''}">${moneyDisplay}</div>
          <div class="player-position">Position: ${BOARD_SPACES[player.position].name}</div>
          ${player.inJail ? '<div class="jail-badge">\u{1F46E} IN JAIL</div>' : ''}`;

      // Show abilities status
      if (char) {
        let abilities = [];
        if (player.rerollsLeft > 0) abilities.push(`Rerolls: ${player.rerollsLeft}`);
        if (player.luckRedraws > 0) abilities.push(`Redraws: ${player.luckRedraws}`);
        if (player.regulatedProperty !== null) {
          abilities.push(`Regulated: ${BOARD_SPACES[player.regulatedProperty].name}`);
        }
        if (abilities.length > 0) {
          html += `<div class="player-abilities">${abilities.join(' | ')}</div>`;
        }
        html += `<div class="player-passive">${char.passive.name}</div>`;
      }

      html += `<div class="player-props">${propCount} properties ${propList ? '<br>' + propList : ''}</div>
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
      <div class="dice-total">Total: ${d.total}${d.isDoubles ? ` (DOUBLES! x${G.doublesCount})` : ''}</div>
    `;
  }

  getDiceFace(n) {
    const faces = ['\u2680', '\u2681', '\u2682', '\u2683', '\u2684', '\u2685'];
    return faces[n - 1] || n;
  }

  renderActions(G, ctx) {
    if (ctx.gameover) {
      const winner = G.players[ctx.gameover.winner];
      const winnerName = winner.character ? winner.character.name : `Player ${parseInt(ctx.gameover.winner) + 1}`;
      const reason = ctx.gameover.reason === 'maxTurns'
        ? `<p class="game-over-reason">Turn limit reached (${RULES.core.maxTurns} turns)</p>`
        : '';
      this.actionsEl.innerHTML = `
        <div class="game-over">
          <h2>\u{1F3C6} Game Over!</h2>
          <p>${winnerName} wins!</p>
          ${reason}
        </div>`;
      return;
    }

    const player = G.players[ctx.currentPlayer];
    const displayName = player.character ? player.character.name : `Player ${parseInt(ctx.currentPlayer) + 1}`;
    let html = `<h3>${displayName}'s Turn</h3>`;

    // Online mode: show waiting message if it's not our turn
    const isMyTurn = !this.onlinePlayerID || ctx.currentPlayer === this.onlinePlayerID;
    if (!isMyTurn) {
      html += `<div class="waiting-message">Waiting for ${displayName}...</div>`;
      this.actionsEl.innerHTML = html;
      return;
    }

    // Jail options
    if (player.inJail && !G.hasRolled) {
      html += `<button id="btn-jail" class="btn btn-warning">Pay $${RULES.core.jailFine} Fine</button>`;
      html += `<button id="btn-roll" class="btn btn-primary">Roll for Doubles</button>`;
    } else if (!G.hasRolled && G.turnPhase === 'roll') {
      html += `<button id="btn-roll" class="btn btn-primary">\u{1F3B2} Roll Dice</button>`;
    }

    // Pending card: accept or redraw
    if (G.pendingCard) {
      html += `<button id="btn-accept-card" class="btn btn-success">Accept Card</button>`;
      html += `<button id="btn-redraw-card" class="btn btn-warning">Redraw Card</button>`;
    }

    // Buy/pass
    if (G.canBuy) {
      const space = BOARD_SPACES[player.position];
      const price = G.effectivePrice || space.price;
      html += `<button id="btn-buy" class="btn btn-success">\u{1F3E0} Buy ${space.name} ($${price})</button>`;
      html += `<button id="btn-pass" class="btn btn-secondary">Pass</button>`;
    }

    // Auction UI
    if (G.auction && G.turnPhase === 'auction') {
      const auctionSpace = BOARD_SPACES[G.auction.propertyId];
      const currentBidder = G.auction.bidders[G.auction.currentBidderIndex];
      const bidderPlayer = G.players[currentBidder.playerId];
      const bidderName = bidderPlayer.character ? bidderPlayer.character.name : `Player ${parseInt(currentBidder.playerId) + 1}`;
      const minBid = G.auction.currentBid === 0
        ? RULES.auction.startingBid
        : G.auction.currentBid + RULES.auction.minimumIncrement;

      html += `<div class="auction-panel">
        <h4>Auction: ${auctionSpace.name}</h4>
        <div class="auction-info">
          <div>Current bid: <strong>$${G.auction.currentBid || 'None'}</strong></div>
          <div>Bidder: <strong>${bidderName}</strong></div>
          <div>Min bid: $${minBid}</div>
        </div>
        <div class="auction-controls">
          <input type="number" id="bid-amount" min="${minBid}" value="${minBid}" step="${RULES.auction.minimumIncrement}" class="bid-input" />
          <button id="btn-bid" class="btn btn-success">Place Bid</button>
          <button id="btn-pass-auction" class="btn btn-secondary">Pass</button>
        </div>
      </div>`;
    }

    // Trade pending UI (accept/reject for target player)
    if (G.trade && G.turnPhase === 'trade') {
      const proposer = G.players[G.trade.proposerId];
      const target = G.players[G.trade.targetPlayerId];
      const proposerName = proposer.character ? proposer.character.name : `Player ${parseInt(G.trade.proposerId) + 1}`;
      const targetName = target.character ? target.character.name : `Player ${parseInt(G.trade.targetPlayerId) + 1}`;

      html += `<div class="trade-panel">
        <h4>Trade Proposal</h4>
        <div class="trade-details">
          <div class="trade-side">
            <strong>${proposerName} offers:</strong>
            <ul>
              ${G.trade.offeredProperties.map(pid => `<li>${BOARD_SPACES[pid].name}</li>`).join('') || '<li>No properties</li>'}
              ${G.trade.offeredMoney > 0 ? `<li>$${G.trade.offeredMoney}</li>` : ''}
            </ul>
          </div>
          <div class="trade-arrow">&#x21C4;</div>
          <div class="trade-side">
            <strong>${targetName} gives:</strong>
            <ul>
              ${G.trade.requestedProperties.map(pid => `<li>${BOARD_SPACES[pid].name}</li>`).join('') || '<li>No properties</li>'}
              ${G.trade.requestedMoney > 0 ? `<li>$${G.trade.requestedMoney}</li>` : ''}
            </ul>
          </div>
        </div>
        <div class="trade-actions">
          <button id="btn-accept-trade" class="btn btn-success">Accept</button>
          <button id="btn-reject-trade" class="btn btn-danger">Reject</button>
          <button id="btn-cancel-trade" class="btn btn-secondary">Cancel</button>
        </div>
      </div>`;
    }

    // Reroll button (stamina ability)
    if (G.hasRolled && player.rerollsLeft > 0 && !G.canBuy && !G.pendingCard && G.turnPhase === 'done') {
      html += `<button id="btn-reroll" class="btn btn-warning">\u{1F3B2} Reroll (${player.rerollsLeft} left)</button>`;
    }

    // Trade propose button (during 'done' phase, if trading enabled)
    if (RULES.trading.enabled && G.hasRolled && !G.canBuy && !G.pendingCard && !G.trade && !G.auction && G.turnPhase === 'done') {
      const opponents = G.players.filter(p => p.id !== ctx.currentPlayer && !p.bankrupt);
      if (opponents.length > 0 && player.properties.length > 0) {
        html += `<button id="btn-propose-trade" class="btn btn-trade">Propose Trade</button>`;
      }
    }

    // End turn
    if (G.hasRolled && !G.canBuy && !G.pendingCard && !G.trade && !G.auction && G.turnPhase === 'done') {
      html += `<button id="btn-end" class="btn btn-end">End Turn \u{27A1}\u{FE0F}</button>`;
    }

    // Save button (always visible during play phase)
    if (G.phase === 'play') {
      html += `<button id="btn-save" class="btn btn-save">Save Game</button>`;
    }

    // Property management panel (after rolling, during 'done' phase)
    if (G.hasRolled && !G.canBuy && !G.pendingCard && player.properties.length > 0) {
      html += '<div class="prop-management"><h4>Manage Properties</h4>';
      player.properties.forEach(pid => {
        const space = BOARD_SPACES[pid];
        const level = G.buildings[pid] || 0;
        const mortgaged = G.mortgaged[pid] || false;
        const bIcon = level > 0 ? BUILDING_ICONS[level] + ' ' : '';

        html += `<div class="prop-mgmt-row">
          <span class="prop-mgmt-name" style="border-left: 3px solid ${space.color || '#666'}">
            ${bIcon}${space.name} ${mortgaged ? '<em>(M)</em>' : ''}
          </span>
          <span class="prop-mgmt-actions">`;

        if (mortgaged) {
          const cost = Math.floor(space.price * RULES.core.unmortgageRate);
          html += `<button class="btn-small btn-unmortgage" data-pid="${pid}" title="Unmortgage for $${cost}">Unmortgage $${cost}</button>`;
        } else {
          // Upgrade check
          if (space.type === 'property' && space.color && COLOR_GROUPS[space.color]) {
            const groupIds = COLOR_GROUPS[space.color];
            const ownsGroup = groupIds.every(id => G.ownership[id] === ctx.currentPlayer);
            const minLevel = Math.min(...groupIds.map(id => G.buildings[id] || 0));
            const noMortgaged = !groupIds.some(id => G.mortgaged[id]);
            if (ownsGroup && level <= minLevel && level < RULES.core.maxBuildingLevel && noMortgaged) {
              const upgCost = Math.floor(space.price * UPGRADE_COST_MULTIPLIERS[level]);
              html += `<button class="btn-small btn-upgrade" data-pid="${pid}" title="Build ${BUILDING_NAMES[level + 1]} for ~$${upgCost}">\u{2B06} ${BUILDING_NAMES[level + 1]}</button>`;
            }
          }
          // Sell building check (even-building in reverse: can only sell from highest in group)
          if (level > 0) {
            let canSell = true;
            if (space.color && COLOR_GROUPS[space.color]) {
              const groupIds = COLOR_GROUPS[space.color];
              const maxLevel = Math.max(...groupIds.map(id => G.buildings[id] || 0));
              if (level < maxLevel) canSell = false;
            }
            if (canSell) {
              html += `<button class="btn-small btn-sell" data-pid="${pid}" title="Sell ${BUILDING_NAMES[level]}">Sell</button>`;
            }
          }
          // Mortgage check (no buildings on this or group)
          let canMortgage = true;
          if (space.color && COLOR_GROUPS[space.color]) {
            canMortgage = !COLOR_GROUPS[space.color].some(id => (G.buildings[id] || 0) > 0);
          }
          if (canMortgage && level === 0) {
            const val = Math.floor(space.price * RULES.core.mortgageRate);
            html += `<button class="btn-small btn-mortgage" data-pid="${pid}" title="Mortgage for $${val}">Mortgage $${val}</button>`;
          }
        }

        html += '</span></div>';
      });
      html += '</div>';
    }

    this.actionsEl.innerHTML = html;

    // Attach event listeners
    const rollBtn = document.getElementById('btn-roll');
    const buyBtn = document.getElementById('btn-buy');
    const passBtn = document.getElementById('btn-pass');
    const endBtn = document.getElementById('btn-end');
    const jailBtn = document.getElementById('btn-jail');
    const rerollBtn = document.getElementById('btn-reroll');
    const acceptCardBtn = document.getElementById('btn-accept-card');
    const redrawCardBtn = document.getElementById('btn-redraw-card');

    if (rollBtn) rollBtn.onclick = () => this.client.moves.rollDice();
    if (buyBtn) buyBtn.onclick = () => this.client.moves.buyProperty();
    if (passBtn) passBtn.onclick = () => this.client.moves.passProperty();
    if (endBtn) endBtn.onclick = () => this.client.moves.endTurn();
    if (jailBtn) jailBtn.onclick = () => this.client.moves.payJailFine();
    if (rerollBtn) rerollBtn.onclick = () => this.client.moves.useReroll();
    if (acceptCardBtn) acceptCardBtn.onclick = () => this.client.moves.acceptCard();
    if (redrawCardBtn) redrawCardBtn.onclick = () => this.client.moves.redrawCard();

    // Auction buttons
    const bidBtn = document.getElementById('btn-bid');
    const passAuctionBtn = document.getElementById('btn-pass-auction');
    if (bidBtn) bidBtn.onclick = () => {
      const amount = parseInt(document.getElementById('bid-amount').value);
      if (!isNaN(amount)) this.client.moves.placeBid(amount);
    };
    if (passAuctionBtn) passAuctionBtn.onclick = () => this.client.moves.passAuction();

    // Trade buttons
    const proposeTradeBtn = document.getElementById('btn-propose-trade');
    const acceptTradeBtn = document.getElementById('btn-accept-trade');
    const rejectTradeBtn = document.getElementById('btn-reject-trade');
    const cancelTradeBtn = document.getElementById('btn-cancel-trade');
    if (proposeTradeBtn) proposeTradeBtn.onclick = () => this.showTradeModal(G, ctx);
    if (acceptTradeBtn) acceptTradeBtn.onclick = () => this.client.moves.acceptTrade();
    if (rejectTradeBtn) rejectTradeBtn.onclick = () => this.client.moves.rejectTrade();
    if (cancelTradeBtn) cancelTradeBtn.onclick = () => this.client.moves.cancelTrade();

    // Property management buttons
    document.querySelectorAll('.btn-upgrade').forEach(btn => {
      btn.onclick = () => this.client.moves.upgradeProperty(parseInt(btn.dataset.pid));
    });
    document.querySelectorAll('.btn-mortgage').forEach(btn => {
      btn.onclick = () => this.client.moves.mortgageProperty(parseInt(btn.dataset.pid));
    });
    document.querySelectorAll('.btn-unmortgage').forEach(btn => {
      btn.onclick = () => this.client.moves.unmortgageProperty(parseInt(btn.dataset.pid));
    });
    document.querySelectorAll('.btn-sell').forEach(btn => {
      btn.onclick = () => this.client.moves.sellBuilding(parseInt(btn.dataset.pid));
    });

    // Save game
    const saveBtn = document.getElementById('btn-save');
    if (saveBtn) saveBtn.onclick = () => this.saveGame(G, ctx);
  }

  renderMessages(G) {
    const html = G.messages
      .map(m => `<div class="message">${m}</div>`)
      .join('');
    this.messagesEl.innerHTML = `<h3>\u{1F4DC} Log</h3><div class="message-list">${html}</div>`;
  }

  toggleLoadPanel() {
    if (this.loadPanelEl.style.display === 'none') {
      const saves = MonopolyBoard.getSaves();
      const entries = Object.entries(saves);
      if (entries.length === 0) {
        this.loadPanelEl.innerHTML = `
          <div class="load-content">
            <h3>No Saved Games</h3>
            <p>Save a game during play to see it here.</p>
            <button class="btn btn-secondary" id="btn-close-load">Close</button>
          </div>`;
      } else {
        let listHtml = entries
          .sort((a, b) => b[1].timestamp - a[1].timestamp)
          .map(([name, data]) => {
            const date = new Date(data.timestamp).toLocaleString();
            const players = data.numPlayers;
            const turn = data.G.totalTurns;
            return `<div class="save-entry">
              <div class="save-info">
                <div class="save-name">${name}</div>
                <div class="save-meta">${players} players | Turn ${turn} | ${date}</div>
              </div>
              <div class="save-actions">
                <button class="btn-small btn-upgrade btn-load-save" data-save="${name}">Load</button>
                <button class="btn-small btn-mortgage btn-delete-save" data-save="${name}">Delete</button>
              </div>
            </div>`;
          }).join('');
        this.loadPanelEl.innerHTML = `
          <div class="load-content">
            <h3>Saved Games</h3>
            ${listHtml}
            <button class="btn btn-secondary" id="btn-close-load" style="margin-top:10px;">Close</button>
          </div>`;
      }
      this.loadPanelEl.style.display = 'block';

      // Attach handlers
      document.getElementById('btn-close-load').onclick = () => {
        this.loadPanelEl.style.display = 'none';
      };
      this.loadPanelEl.querySelectorAll('.btn-load-save').forEach(btn => {
        btn.onclick = () => {
          const saves = MonopolyBoard.getSaves();
          const saveData = saves[btn.dataset.save];
          if (saveData) {
            this.loadGame(saveData);
            this.loadPanelEl.style.display = 'none';
          }
        };
      });
      this.loadPanelEl.querySelectorAll('.btn-delete-save').forEach(btn => {
        btn.onclick = () => {
          MonopolyBoard.deleteSave(btn.dataset.save);
          this.toggleLoadPanel(); // Refresh
        };
      });
    } else {
      this.loadPanelEl.style.display = 'none';
    }
  }

  saveGame(G, ctx) {
    const saveData = {
      G: G,
      currentPlayer: ctx.currentPlayer,
      numPlayers: G.players.length,
      timestamp: Date.now(),
    };
    const saveName = `meinopoly_save_${new Date().toLocaleString().replace(/[/:]/g, '-')}`;
    const saves = JSON.parse(localStorage.getItem('meinopoly_saves') || '{}');
    saves[saveName] = saveData;
    localStorage.setItem('meinopoly_saves', JSON.stringify(saves));
    G.messages.push(`Game saved: ${saveName}`);
    this.renderMessages(G);
  }

  static getSaves() {
    return JSON.parse(localStorage.getItem('meinopoly_saves') || '{}');
  }

  static deleteSave(name) {
    const saves = JSON.parse(localStorage.getItem('meinopoly_saves') || '{}');
    delete saves[name];
    localStorage.setItem('meinopoly_saves', JSON.stringify(saves));
  }

  loadGame(saveData) {
    // Stop current client
    this.client.stop();
    // Re-create client with saved state injected via setup override
    const savedG = saveData.G;
    const LoadedGame = {
      ...Monopoly,
      setup: () => savedG,
    };
    this.client = Client({
      game: LoadedGame,
      numPlayers: saveData.numPlayers,
      debug: false,
    });
    this.client.start();
    this.client.subscribe(state => this.update(state));
  }
}

const appElement = document.getElementById('app');
new MonopolyBoard(appElement);
