import { Client } from 'boardgame.io/client';
import { Monopoly } from './Game';
import { PLAYER_COLORS, BUILDING_ICONS, BUILDING_NAMES, UPGRADE_COST_MULTIPLIERS, RENT_MULTIPLIERS, SEASONS } from './constants';
import { BOARD_SPACES, COLOR_GROUPS, CHARACTERS, getLoreById } from '../mods/dominion';

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
    this.createLayout();
    this.client = Client({
      game: Monopoly,
      numPlayers: 2,
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
          <div id="season-display" class="season-display"></div>
        </div>
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
    this.charSelectEl = document.getElementById('character-select');
    this.gameAreaEl = document.getElementById('game-area');
    this.seasonDisplayEl = document.getElementById('season-display');
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
      const startMoney = 1500 + char.stats.capital * 50;

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
    this.seasonDisplayEl.innerHTML = `
      <span class="season-icon">${season.icon}</span>
      <span class="season-name">${season.name}</span>
      <span class="season-turn">Turn ${G.totalTurns}</span>
      ${effects}
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
      this.actionsEl.innerHTML = `
        <div class="game-over">
          <h2>\u{1F3C6} Game Over!</h2>
          <p>${winnerName} wins!</p>
        </div>`;
      return;
    }

    const player = G.players[ctx.currentPlayer];
    const displayName = player.character ? player.character.name : `Player ${parseInt(ctx.currentPlayer) + 1}`;
    let html = `<h3>${displayName}'s Turn</h3>`;

    // Jail options
    if (player.inJail && !G.hasRolled) {
      html += `<button id="btn-jail" class="btn btn-warning">Pay $50 Fine</button>`;
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

    // Reroll button (stamina ability)
    if (G.hasRolled && player.rerollsLeft > 0 && !G.canBuy && !G.pendingCard && G.turnPhase === 'done') {
      html += `<button id="btn-reroll" class="btn btn-warning">\u{1F3B2} Reroll (${player.rerollsLeft} left)</button>`;
    }

    // End turn
    if (G.hasRolled && !G.canBuy && !G.pendingCard && G.turnPhase === 'done') {
      html += `<button id="btn-end" class="btn btn-end">End Turn \u{27A1}\u{FE0F}</button>`;
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
          const cost = Math.floor(space.price * 0.55);
          html += `<button class="btn-small btn-unmortgage" data-pid="${pid}" title="Unmortgage for $${cost}">Unmortgage $${cost}</button>`;
        } else {
          // Upgrade check
          if (space.type === 'property' && space.color && COLOR_GROUPS[space.color]) {
            const groupIds = COLOR_GROUPS[space.color];
            const ownsGroup = groupIds.every(id => G.ownership[id] === ctx.currentPlayer);
            const minLevel = Math.min(...groupIds.map(id => G.buildings[id] || 0));
            const noMortgaged = !groupIds.some(id => G.mortgaged[id]);
            if (ownsGroup && level <= minLevel && level < 4 && noMortgaged) {
              const upgCost = Math.floor(space.price * UPGRADE_COST_MULTIPLIERS[level]);
              html += `<button class="btn-small btn-upgrade" data-pid="${pid}" title="Build ${BUILDING_NAMES[level + 1]} for ~$${upgCost}">\u{2B06} ${BUILDING_NAMES[level + 1]}</button>`;
            }
          }
          // Mortgage check (no buildings on this or group)
          let canMortgage = true;
          if (space.color && COLOR_GROUPS[space.color]) {
            canMortgage = !COLOR_GROUPS[space.color].some(id => (G.buildings[id] || 0) > 0);
          }
          if (canMortgage && level === 0) {
            const val = Math.floor(space.price * 0.5);
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
