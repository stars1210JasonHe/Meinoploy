import { Client } from 'boardgame.io/client';
import { SocketIO } from 'boardgame.io/multiplayer';
import { Monopoly, setActiveMap, setActiveMod, setVictoryConfig } from './Game';
import { PLAYER_COLORS, BUILDING_ICONS, BUILDING_NAMES, UPGRADE_COST_MULTIPLIERS, RENT_MULTIPLIERS, SEASONS } from './constants';
// RULES is the live engine singleton (mutated in place by setActiveMod) — NOT the Dominion
// barrel. Mod CONTENT (characters/lore/maps/keyart/atlas) is read off `this.activeMod` (the
// active mod's Tier-B client bundle), so swapping mods doesn't depend on Parcel rebinding.
import { RULES } from '../mods/active-rules';
import { Lobby } from './Lobby';
import { loadMap, getGridDimensions, positionsToGrid } from './map-loader';
import { CharacterAI, VERBOSITY, mapEngineEventToAi, consumeNewEvents } from './character-ai';
import { loadWorld } from './world-loader';
import { routeChoices } from './atlas-movement';
import { miniMapSvg, pluralize, breadcrumbSteps } from './entry-ui';
import { isDuelCooldownBlocked } from './events';
import { createAnimator, DICE_TUMBLE_MS } from './anim';
import { createAudio } from './audio';
import { chipHtml, chipDetailHtml, drawerShellHtml, tokenVisual } from './game-chrome';

// Client-side mod registry — static bundle imports (Parcel v1 forces all imports static, so
// every registered mod is bundled at build; only WHICH is active is chosen at runtime). This
// mirrors AVAILABLE_MAPS one level up. Each entry is a Tier-B client bundle with images:
// { id, name, characters (portrait-merged), portraits, getLoreById, maps, worlds, keyArt,
//   atlasAssets, getGlobe }. Stage 3 adds more entries here.
import dominionMod from '../mods/dominion/bundle.client';
import terraTitansMod from '../mods/terra-titans/bundle.client';
import ancientEmpiresMod from '../mods/ancient-empires/bundle.client';
import steamBaronsMod from '../mods/steam-barons/bundle.client';
import silkRoadMod from '../mods/silk-road/bundle.client';
import gildedRailsMod from '../mods/gilded-rails/bundle.client';
const MODS = [dominionMod, terraTitansMod, ancientEmpiresMod, steamBaronsMod, silkRoadMod, gildedRailsMod];

// True if a (lat,lng) on the globe faces the camera (cos-distance vs the POV center).
// Overlays on the far hemisphere are hidden. > a small positive epsilon hides points
// right on the limb where they'd clip through the sphere edge.
const _D2R = Math.PI / 180;
function onGlobeNearSide(lat, lng, pov) {
  return Math.sin(pov.lat * _D2R) * Math.sin(lat * _D2R)
    + Math.cos(pov.lat * _D2R) * Math.cos(lat * _D2R) * Math.cos((lng - pov.lng) * _D2R) > 0.04;
}
import { ARCHETYPES } from '../mods/dominion/atlas/archetypes';

const STAT_KEYS = [
  { key: 'capital', label: 'CAP' },
  { key: 'luck', label: 'LCK' },
  { key: 'negotiation', label: 'NEG' },
  { key: 'charisma', label: 'CHA' },
  { key: 'tech', label: 'TEC' },
  { key: 'stamina', label: 'STA' },
];

// ─────────────────────────────────────────────────────────────
// Pixel UI primitives (vanilla DOM → HTML strings)
// ─────────────────────────────────────────────────────────────
function esc(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function money(amount, hidden) {
  if (hidden) return '<span class="money money--hidden">$?,???</span>';
  const n = typeof amount === 'number' ? amount.toLocaleString() : amount;
  return `<span class="money">$${n}</span>`;
}

function tokenHtml(color, label, small) {
  return `<span class="token ${small ? 'token--sm' : ''}" style="--tcol:${color}">${esc(label)}</span>`;
}

function glyphHtml(kind, color) {
  return `<span class="glyph glyph--${kind}"${color ? ` style="--gcol:${color}"` : ''}></span>`;
}

// CSS-drawn pip dice
const DIE_PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
function dieHtml(value, rolling) {
  const layout = DIE_PIPS[value] || [4];
  let cells = '';
  for (let i = 0; i < 9; i++) cells += `<span class="die__cell">${layout.includes(i) ? '<span class="pip"></span>' : ''}</span>`;
  return `<div class="die ${rolling ? 'die--rolling' : ''}">${cells}</div>`;
}

function portraitHtml(char, size, selected) {
  const color = char && char.color ? char.color : 'var(--accent)';
  const inner = char && char.portrait
    ? `<img src="${char.portrait}" alt="" draggable="false" />`
    : `<div class="portrait__empty">${char ? esc(char.name[0]) : '?'}</div>`;
  return `<div class="portrait ${selected ? 'portrait--sel' : ''}" style="width:${size}px;height:${size}px;--pcol:${color}">${inner}</div>`;
}

// Character names are painted in the character's color on the dark card. Very dark colors
// (e.g. Cao Cao #212121) become unreadable. Lighten ONLY genuinely-dark colors (luminance
// < 60) toward white to ~luminance 90, preserving hue so the identity color is kept. Bright
// colors (all Dominion chars; most Terra Titans) are returned unchanged.
function readableNameColor(hex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex || '');
  if (!m) return hex;
  let r = parseInt(m[1].slice(0, 2), 16), g = parseInt(m[1].slice(2, 4), 16), b = parseInt(m[1].slice(4, 6), 16);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (lum >= 60) return hex;
  const f = (90 - lum) / (255 - lum); // blend toward white to reach ~luminance 90
  r = Math.round(r + (255 - r) * f); g = Math.round(g + (255 - g) * f); b = Math.round(b + (255 - b) * f);
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

function statRowsHtml(stats, color) {
  return STAT_KEYS.map(s => {
    const value = stats[s.key];
    let cells = '';
    for (let i = 0; i < 10; i++) {
      cells += `<span class="statcell ${i < value ? 'on' : ''}"${i < value ? ` style="background:${color}"` : ''}></span>`;
    }
    return `<div class="statrow"><span class="statrow__label">${s.label}</span><span class="statrow__cells">${cells}</span><span class="statrow__val">${value}</span></div>`;
  }).join('');
}

// Tile glyph by space type (no emoji)
function tileGlyph(type) {
  switch (type) {
    case 'go': return 'arrow';
    case 'chance': return 'q';
    case 'community': return 'chest';
    case 'tax': return 'coin';
    case 'railroad': return 'rail';
    case 'utility': return 'bolt';
    case 'jail': return 'bars';
    case 'goToJail': return 'cuff';
    case 'parking': return 'park';
    default: return null;
  }
}

// Group key for a space: classic spaces carry a hex color, atlas spaces carry
// a placeId (no color). placeId-first, mirroring Game.js groupKeyOf.
function groupKeyOf(space) {
  return space.placeId || space.color;
}

// Deterministic display color for an atlas place (atlas spaces have no color).
// Hash the placeId to a stable hue so each place reads as one color band.
function placeIdColor(placeId) {
  let h = 0;
  for (let i = 0; i < placeId.length; i++) h = (h * 31 + placeId.charCodeAt(i)) % 360;
  // Step-multiply spreads adjacent hashes apart so neighbouring cities differ more.
  const hue = (h * 47) % 360;
  return `hsl(${hue}, 60%, 45%)`;
}

// Event card kind from action
function cardKind(action) {
  if (['gain', 'gainAll', 'gainPerProperty', 'freeUpgrade'].includes(action)) return 'good';
  if (['pay', 'payPercent', 'forceBuy', 'downgrade', 'goToJail'].includes(action)) return 'bad';
  return 'neutral';
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

class MonopolyBoard {
  constructor(rootElement) {
    this.rootElement = rootElement;
    this.mode = null; // 'local' or 'online'
    this.onlinePlayerID = null;
    this._pendingCharId = null; // local character-select preview
    // Active mod (default Dominion). All mod CONTENT reads route through this.activeMod;
    // selectMod() swaps it + the engine RULES singleton. availableMaps = the active mod's
    // boards (maps + atlas worlds), the same set the old module-level AVAILABLE_MAPS held.
    this.activeMod = MODS[0];
    this.availableMaps = this.activeMod.maps.concat(this.activeMod.worlds);
    this.setMap(this.availableMaps[0]); // classic map.json is the mod's first board

    // AI system
    const savedKey = localStorage.getItem('meinopoly_ai_key') || '';
    const savedVerbosity = localStorage.getItem('meinopoly_ai_verbosity') || VERBOSITY.MAJOR;
    this.characterAI = new CharacterAI(savedKey, { verbosity: savedVerbosity });
    this.aiResponses = [];
    this.chatHistories = {};
    this.activeChatCharId = null;
    this._lastEventSeq = undefined;

    // Audio + animator: constructed exactly ONCE, here at app-boot — not per-game-start.
    // this.mapData already exists (setMap() ran above); this.boardEl/tokenLayer don't exist
    // yet, but the stage's DOM lookups are all lazy closures evaluated at animation-trigger
    // time, well after createLayout() runs. Booting it here (before createLayout) also means
    // the mute button's initial paint reflects the REAL localStorage-backed mute state
    // immediately, instead of defaulting to "SND" until a game is first started.
    this._ensureAnimator();
    this.createLayout();
    this.showModeSelect();
  }

  setMap(mapJson) {
    // Atlas worlds (movementMode:'atlas') expand through loadWorld; classic
    // map.json goes through loadMap. Both yield a mapData-compatible object.
    this.mapData = (mapJson && mapJson.movementMode === 'atlas')
      ? loadWorld(mapJson, ARCHETYPES)
      : loadMap(mapJson);
    this.boardSpaces = this.mapData.spaces;
    this.colorGroups = this.mapData.colorGroupsFlat;
    // Attach client-only real-city imagery (world bg + per-place photos) if this atlas
    // world has a bundled asset set. Null for classic / asset-less maps → color fallback.
    this.mapData.atlasAssets = (mapJson && this.activeMod.atlasAssets[mapJson.id]) || null;
    // Globe renderer: carry the render mode + the raw places (geo lat/lng + connectors)
    // so the globe can plot city points and great-circle route arcs. Display-only.
    this.mapData.renderMode = (mapJson && mapJson.renderMode) || null;
    this.mapData.atlasPlaces = (mapJson && mapJson.places) || null;
    this.mapData.globePixelRatio = (mapJson && mapJson.atlasConfig && mapJson.atlasConfig.globe
      && mapJson.atlasConfig.globe.pixelRatio) || 0.35;
    // Pre-warm the (async) globe library the moment a globe map is picked — by the time
    // the player rolls, window.Globe is ready, so the first fork can't freeze waiting on
    // the fetch. Errors are handled later in _renderGlobeBoard's load path.
    if (this.mapData.renderMode === 'globe') this.activeMod.getGlobe().catch(() => {});
    setActiveMap(this.mapData);
  }

  // ─────────────────────────────────────────────────────────
  // Animation + SFX pipeline (experience wave)
  // ─────────────────────────────────────────────────────────
  // Construct the shared audio + animator pipeline exactly once. Called from the
  // constructor (not per client-start) so it survives exitToMenu()/loadGame() cycles
  // without leaking duplicate `pointerdown` listeners or animator instances.
  _ensureAnimator() {
    if (this.animator) return;
    this.audio = createAudio();
    const stage = this._makeAnimStage();
    this.animator = createAnimator({
      stage,
      // anim.js calls sink.event(e)/sink.dice()/sink.hop(i) — the audio object exposes
      // playForEvent/dice/hop, NOT an `.event` method, so this adapter shim is required.
      sink: {
        dice: () => this.audio.dice(),
        hop: (i) => this.audio.hop(i),
        event: (e) => this.audio.playForEvent(e),
      },
      boardSize: () => (this.mapData && this.mapData.spaceCount) || 0,
      isDisabled: () => window.__MEINO_NO_ANIM === true
        || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches),
    });
    // First gesture anywhere: resume the (possibly-suspended) AudioContext. Any input also
    // fast-forwards in-flight animations — intentional: a click mid-animation snaps it to done
    // rather than making the player wait it out.
    document.addEventListener('pointerdown', () => {
      this.audio.onFirstGesture();
      if (this.animator) this.animator.fastForward();
    }, { capture: true });
  }

  // Real-DOM stage consumed by anim.js's createAnimator. Owns dice-overlay + token
  // placement during an in-flight animation; renderTokens/_updateGlobeOverlay skip
  // position writes for animating players (this.animator.isAnimating(id)) so this stage
  // is the sole writer while a job is running.
  _makeAnimStage() {
    const overlay = () => document.getElementById('dice-overlay');
    // Remember current animated placement per player so reapply() can re-assert it after
    // a full re-render recreates/repositions token nodes (e.g. a brand-new token element).
    this._animPlacement = {}; // playerId -> posId
    const place = (pid, posId) => {
      if (this.mapData.renderMode === 'globe') {
        const ov = this.boardEl && this.boardEl.querySelector('.globe-overlay');
        const el = ov && ov.querySelector(`.gtoken[data-player="${pid}"]`);
        const sp = this.boardSpaces && this.boardSpaces[posId];
        const geo = sp && this._globeGeoOf && this._globeGeoOf[sp.placeId];
        if (el && geo) { el.dataset.lat = geo.lat; el.dataset.lng = geo.lng; }
        return;
      }
      const el = this._tokenLayer && this._tokenLayer.querySelector(`.token[data-player="${pid}"]`);
      if (!el) return;
      const c = this.getSpaceCenter(posId);
      el.classList.add('token--hop');
      el.style.left = c.x + '%';
      el.style.top = c.y + '%';
    };
    return {
      diceStart: (d1, d2) => {
        const ov = overlay(); if (!ov) return;
        ov.style.display = 'flex';
        ov.classList.add('dice-overlay--tumbling');
        this._diceTumbleTimer && clearInterval(this._diceTumbleTimer);
        const rnd = () => 1 + Math.floor(Math.random() * 6);
        // Rapid face flips for the tumble window; settle on the real values. Reuses
        // dieHtml() — the SAME CSS pip-die glyph the sidebar/centerslot dice already
        // render — instead of inventing a new (unicode-glyph) dice visual language.
        const tick = () => { ov.querySelectorAll('.bigdie').forEach(el => { el.innerHTML = dieHtml(rnd(), true); }); };
        tick(); // populate synchronously — a setInterval-only tick would leave the overlay
        // empty (or showing the PREVIOUS roll's stale faces) for the first 80ms it's visible.
        this._diceTumbleTimer = setInterval(tick, 80);
        this._diceSettleTimer && clearTimeout(this._diceSettleTimer);
        this._diceSettleTimer = setTimeout(() => {
          clearInterval(this._diceTumbleTimer);
          ov.classList.remove('dice-overlay--tumbling');
          const dies = ov.querySelectorAll('.bigdie');
          if (dies[0]) dies[0].innerHTML = dieHtml(d1);
          if (dies[1]) dies[1].innerHTML = dieHtml(d2);
        }, DICE_TUMBLE_MS);
      },
      diceEnd: () => {
        const ov = overlay(); if (!ov) return;
        clearInterval(this._diceTumbleTimer);
        clearTimeout(this._diceSettleTimer);
        ov.style.display = 'none';
      },
      // Fix 2 (enqueue-claim ownership): fires the moment anim.js QUEUES a hop
      // job (before the dice window even starts playing), carrying the actor's
      // ORIGIN position. Places the token there immediately and holds it — this
      // is what keeps renderTokens (guarded by animator.isAnimating) from
      // painting the token at its G-state DESTINATION for the whole ~1.1s dice
      // window in front of this job. Same place() helper hopTo uses below, so
      // reapply() re-asserts whichever placement (queued-origin or in-flight
      // tile) is current if a full re-render recreates the token node.
      hopQueued: (pid, fromPosId) => { this._animPlacement[pid] = fromPosId; place(pid, fromPosId); },
      hopTo: (pid, posId, i, n) => { this._animPlacement[pid] = posId; place(pid, posId); },
      hopDone: (pid) => {
        delete this._animPlacement[pid];
        const el = this._tokenLayer && this._tokenLayer.querySelector(`.token[data-player="${pid}"]`);
        if (el) el.classList.remove('token--hop');
        // Final authoritative placement comes from the next renderTokens; force one now.
        if (this._lastG) this.renderTokens(this._lastG, this._lastCtx);
      },
      reapply: () => {
        Object.entries(this._animPlacement || {}).forEach(([pid, posId]) => place(pid, posId));
      },
      // Bulk-release hook for anim.js reset(): queued-never-played hop jobs (see
      // hopQueued above) leave an entry in _animPlacement that no hopDone will ever
      // clean up, since they're cleared out of the queue directly rather than played.
      // Without this, a stale entry survives exit-to-menu/new-game and reapply()
      // force-places that player's token at the old (possibly other-map) position on
      // every render until their first hop of the new game completes.
      resetAll: () => { this._animPlacement = {}; },
    };
  }

  // ─────────────────────────────────────────────────────────
  // Layout shell
  // ─────────────────────────────────────────────────────────
  createLayout() {
    this.rootElement.innerHTML = `
      <div class="app app--scan app--crt" id="app-root">
        <div class="topbar">
          <span class="topbar__label">THEME</span>
          <select id="theme-select">
            <option value="council">COUNCIL</option>
            <option value="verdant">VERDANT</option>
            <option value="arcade">ARCADE</option>
          </select>
          <button id="btn-crt" class="pix-btn pix-btn--default">CRT</button>
          <button id="btn-save" class="pix-btn pix-btn--default" style="display:none;">SAVE</button>
          <button id="btn-load-menu" class="pix-btn pix-btn--default">LOAD</button>
          <button id="btn-ai-settings" class="pix-btn pix-btn--default">AI</button>
          <button id="btn-mute" class="pix-btn pix-btn--default">SND</button>
          <button id="btn-exit-game" class="pix-btn pix-btn--danger" style="display:none;">EXIT</button>
          <button id="btn-fs-top" class="pix-btn pix-btn--default">FULL</button>
        </div>
        <div id="topbar-hotzone"></div>

        <div class="app__frame">
          <div style="width:100%;">
            <div id="menu-screen" style="display:none;"></div>
            <div id="online-lobby" style="display:none;"></div>
            <div id="character-select" style="display:none;"></div>
            <div id="results-area" style="display:none;"></div>
            <div id="game-area" class="screen screen--game" style="display:none;">
              <div class="game__chips"><div id="player-info"></div></div>
              <div class="game__center">
                <div id="board" class="board"></div>
                <div id="dice-overlay" style="display:none;"><span class="bigdie" data-die="1"></span><span class="bigdie" data-die="2"></span></div>
                <div id="drawer-tabs"></div>
              </div>
              <div class="game__actionbar"><div id="turnbox"></div><button id="btn-fs" class="pix-btn pix-btn--default">FULL</button></div>
            </div>
            <div id="drawer" class="drawer" hidden></div>
          </div>
        </div>

        <div class="modal__scrim" id="state-modal"><div class="modal" id="state-modal-box"></div></div>
        <div class="modal__scrim" id="ui-modal"><div class="modal" id="ui-modal-box"></div></div>
      </div>
    `;

    // Right drawer shell (Task 1 builder, game-chrome.js): ONE builder returns
    // two top-level siblings — `.drawer-tabs` rail + `#drawer` panel (see
    // task-1-report.md "Option A"). Build in a DETACHED container (so the
    // builder's own #drawer id never collides with the live one above) and
    // copy each half's inner content into its template slot. #manage/
    // #ai-responses/#chat-panel/#log/#btn-exit-foot must exist in the live DOM
    // from this point on — every update() writes into them whether the
    // drawer is open or not.
    const _drawerBuild = document.createElement('div');
    _drawerBuild.innerHTML = drawerShellHtml();
    document.getElementById('drawer-tabs').innerHTML = _drawerBuild.querySelector('.drawer-tabs').innerHTML;
    document.getElementById('drawer').innerHTML = _drawerBuild.querySelector('#drawer').innerHTML;

    this.appRootEl = document.getElementById('app-root');
    this.menuEl = document.getElementById('menu-screen');
    this.lobbyEl = document.getElementById('online-lobby');
    this.charSelectEl = document.getElementById('character-select');
    this.resultsEl = document.getElementById('results-area');
    this.gameAreaEl = document.getElementById('game-area');
    this.playerInfoEl = document.getElementById('player-info');
    // Chip click -> detail popover. Delegated on the persistent #player-info
    // (its children are fully rebuilt every renderPlayerInfo call). Reads
    // this._chipDetail[idx], rebuilt every renderPlayerInfo alongside the
    // chip strip itself — same one-render-stale freshness contract as
    // this._lastG/renderTokens.
    this.playerInfoEl.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-chip]');
      if (!chip) return;
      const d = this._chipDetail && this._chipDetail[parseInt(chip.dataset.chip, 10)];
      if (d) this.openUiModal(chipDetailHtml(d));
    });
    this.boardEl = document.getElementById('board');
    // Atlas route-picker: one delegated listener on the persistent boardEl
    // (survives grid rebuilds). Reads this._routeTargets {nodeId:route} at click
    // time — set by _resolveAtlasRoute when a fork is awaiting a choice.
    this.boardEl.addEventListener('click', (e) => {
      if (!this._routeTargets) return;
      const tile = e.target.closest('.tile[data-space]');
      if (!tile) return;
      const route = this._routeTargets[tile.dataset.space];
      if (route) { this._routeTargets = null; this._syncRoutePickChrome(); this.client.moves.commitRoute(route); }
    });
    this.turnboxEl = document.getElementById('turnbox');
    // Chrome-band sizing (Task 2 review fix — see _syncChromeBands below and
    // the CSS comment above `.app--game .board` in index.html): live refs to
    // the two floating bars whose ACTUAL rendered height gets reserved so the
    // full-bleed board never renders underneath either of them.
    this.chipsBarEl = document.querySelector('.game__chips');
    this.actionBarEl = document.querySelector('.game__actionbar');
    this.manageEl = document.getElementById('manage');
    this.messagesEl = document.getElementById('log');
    this.aiResponsesEl = document.getElementById('ai-responses');
    this.chatPanelEl = document.getElementById('chat-panel');
    this.stateModalEl = document.getElementById('state-modal');
    this.stateModalBoxEl = document.getElementById('state-modal-box');
    this.uiModalEl = document.getElementById('ui-modal');
    this.uiModalBoxEl = document.getElementById('ui-modal-box');

    // Right drawer (log/chat/manage) + its tab rail.
    this.drawerEl = document.getElementById('drawer');
    this.drawerTabsEl = document.getElementById('drawer-tabs');
    this._drawerOpen = false;
    this._drawerTab = null;
    this._logSeenCount = 0; // q2: G.messages.length last seen while the LOG tab was open/visible
    this.drawerTabsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.drawer-tabs__btn');
      if (!btn) return;
      const tab = btn.dataset.tab;
      if (this._drawerOpen && this._drawerTab === tab) { this._closeDrawer(); return; }
      this._openDrawer(tab);
    });
    // Escape, and a pointerdown on the board area, close the drawer. A
    // SEPARATE listener from _ensureAnimator's document-level capture
    // pointerdown (animation fastForward) — intentionally not overloaded.
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this._drawerOpen) this._closeDrawer(); });
    this.boardEl.addEventListener('pointerdown', () => { if (this._drawerOpen) this._closeDrawer(); });

    // Topbar buttons
    this.exitBtnEl = document.getElementById('btn-exit-game');
    this.saveBtnEl = document.getElementById('btn-save');
    this.exitBtnEl.onclick = () => this.exitToMenu();
    document.getElementById('btn-exit-foot').onclick = () => this.exitToMenu();
    document.getElementById('btn-load-menu').onclick = () => this.showSavesModal();
    document.getElementById('btn-ai-settings').onclick = () => this.showAISettings();

    // Mute toggle (this.audio is constructed in the constructor, before createLayout runs).
    const muteBtn = document.getElementById('btn-mute');
    const paintMute = () => { muteBtn.textContent = this.audio && this.audio.isMuted() ? 'MUTED' : 'SND'; };
    muteBtn.onclick = () => { this.audio.setMuted(!this.audio.isMuted()); paintMute(); };
    paintMute();

    // Theme switcher
    const savedTheme = localStorage.getItem('meinopoly_theme') || 'council';
    document.body.setAttribute('data-theme', savedTheme);
    const themeSel = document.getElementById('theme-select');
    themeSel.value = savedTheme;
    themeSel.onchange = () => {
      document.body.setAttribute('data-theme', themeSel.value);
      localStorage.setItem('meinopoly_theme', themeSel.value);
    };

    // CRT toggle
    const crtOn = (localStorage.getItem('meinopoly_crt') || 'on') === 'on';
    this._setCrt(crtOn);
    document.getElementById('btn-crt').onclick = () => {
      const next = !this.appRootEl.classList.contains('app--crt');
      this._setCrt(next);
      localStorage.setItem('meinopoly_crt', next ? 'on' : 'off');
    };

    // Fullscreen-stage wave (Task 2): auto-hide topbar. A thin fixed hotzone at the
    // very top edge reveals the topbar on hover; :focus-within (index.html) covers
    // keyboard-tab reveal without JS. Wired once here — createLayout only ever runs
    // once per app lifetime (constructor, before the first showModeSelect()) — so
    // this survives every screen transition; only relevant under .app--game (the
    // hotzone is CSS-gated, hidden otherwise, and the class check below short-
    // circuits on every other screen).
    //
    // A plain mouseenter(hotzone)/mouseleave(topbar) pair (the naive version) gets
    // STUCK OPEN in practice: revealing the topbar slides it down to fully occlude
    // the (much shorter) hotzone underneath a STATIONARY cursor, and occluding an
    // element that way — without the pointer actually moving — never fires a
    // synthetic mouseenter/mouseleave (those only fire when the pointer crosses an
    // element boundary via real movement). So the topbar's own mouseleave never
    // arrives once the hotzone that opened it disappears under it, and it never
    // closes again — measured live (real Chromium, 1400x900): hover the hotzone,
    // move to the board, topbar stays revealed indefinitely. A single delegated
    // `mousemove` recomputing "is the cursor over the hotzone OR the topbar's own
    // (live, possibly-still-hidden) rect right now" sidesteps the whole enter/leave
    // ordering question — it's a live poll, not an event-history dependency.
    this.topbarEl = document.querySelector('.topbar');
    this.topbarHotzoneEl = document.getElementById('topbar-hotzone');
    document.addEventListener('mousemove', (e) => {
      if (!this.appRootEl.classList.contains('app--game')) return;
      const hz = this.topbarHotzoneEl.getBoundingClientRect();
      const tb = this.topbarEl.getBoundingClientRect();
      const inZone = (e.clientY >= hz.top && e.clientY <= hz.bottom)
        || (e.clientX >= tb.left && e.clientX <= tb.right && e.clientY >= tb.top && e.clientY <= tb.bottom);
      this.topbarEl.classList.toggle('topbar--show', inZone);
    });

    // Fullscreen API button (Task 2): a twin in the action bar (#btn-fs) and the
    // topbar (#btn-fs-top) — one toggle, one `fullscreenchange` listener syncing both
    // labels. Wired once (createLayout runs once). #btn-fs is a SIBLING of #turnbox
    // in the DOM (see the .game__actionbar template above), not a child of it, so
    // renderTurnbox's innerHTML rewrite every render never wipes it out. Hidden
    // entirely when the API is unavailable rather than left as a dead click.
    this.fsBtnEl = document.getElementById('btn-fs');
    this.fsBtnTopEl = document.getElementById('btn-fs-top');
    if (!document.documentElement.requestFullscreen) {
      this.fsBtnEl.style.display = 'none';
      this.fsBtnTopEl.style.display = 'none';
    } else {
      const paintFs = () => {
        const label = document.fullscreenElement ? 'EXIT FS' : 'FULL';
        this.fsBtnEl.textContent = label;
        this.fsBtnTopEl.textContent = label;
      };
      const toggleFs = () => {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen();
      };
      this.fsBtnEl.onclick = toggleFs;
      this.fsBtnTopEl.onclick = toggleFs;
      document.addEventListener('fullscreenchange', paintFs);
      paintFs();
    }

    // Modal close on scrim click
    this.stateModalEl.addEventListener('click', (e) => { if (e.target === this.stateModalEl) { /* state-driven; ignore */ } });
    this.uiModalEl.addEventListener('click', (e) => { if (e.target === this.uiModalEl) this.closeUiModal(); });
  }

  // ─────────────────────────────────────────────────────────
  // Right drawer (log / chat / manage) — always in the DOM (see createLayout);
  // this only toggles [hidden] + which tab looks active + scrolls the target
  // section into view.
  // ─────────────────────────────────────────────────────────
  _openDrawer(tab) {
    if (!this.drawerEl) return;
    this.drawerEl.hidden = false;
    this._drawerOpen = true;
    this._drawerTab = tab;
    if (this.drawerTabsEl) {
      this.drawerTabsEl.querySelectorAll('.drawer-tabs__btn').forEach(b => {
        b.classList.toggle('drawer-tabs__btn--active', b.dataset.tab === tab);
      });
    }
    // q2: opening the LOG tab marks everything logged so far as "seen" —
    // this._lastG is the freshest G (renderTokens caches it every update(),
    // ahead of renderPlayerInfo/renderMessages); fall back to 0 pre-first-render.
    if (tab === 'log') this._logSeenCount = this._lastG ? this._lastG.messages.length : 0;
    this._updateLogUnread(); // clear the dot immediately, don't wait for the next state push
    const target = tab === 'log' ? this.messagesEl : tab === 'chat' ? this.chatPanelEl : this.manageEl;
    if (target && target.scrollIntoView) target.scrollIntoView({ block: 'nearest' });
  }

  _closeDrawer() {
    if (!this.drawerEl) return;
    this.drawerEl.hidden = true;
    this._drawerOpen = false;
    if (this.drawerTabsEl) this.drawerTabsEl.querySelectorAll('.drawer-tabs__btn').forEach(b => b.classList.remove('drawer-tabs__btn--active'));
  }

  // q2: LOG tab unread dot. Compares G.messages.length against the count last
  // seen while the LOG tab was open/visible (this._logSeenCount). While the
  // tab is actively open (viewingLog), the seen-count is kept in sync on every
  // render so new lines arriving while the user is looking never flag unread;
  // the moment the drawer closes or the tab switches away, that count freezes
  // and anything appended after it lights the dot on the next render.
  _updateLogUnread(G) {
    if (!this.drawerTabsEl) return;
    const btn = this.drawerTabsEl.querySelector('.drawer-tabs__btn[data-tab="log"]');
    if (!btn) return;
    const g = G || this._lastG;
    const count = g && g.messages ? g.messages.length : 0;
    const viewingLog = this._drawerOpen && this._drawerTab === 'log';
    if (viewingLog) this._logSeenCount = count;
    const unread = !viewingLog && count > this._logSeenCount;
    btn.classList.toggle('drawer-tabs__btn--unread', unread);
    const dot = btn.querySelector('.drawer-tabs__dot');
    if (dot) dot.hidden = !unread;
  }

  _setCrt(on) {
    this.appRootEl.classList.toggle('app--crt', on);
    this.appRootEl.classList.toggle('app--scan', on);
  }

  _showScreen(name) {
    // 'flex' (not 'block') so the .screen--menu flex centering actually applies — an inline
    // 'block' overrides the class's display:flex. Lobby reuses .screen--menu, so it needs it too.
    // (The hero also routes through 'menu' and now gets flex; harmless — its children are absolute.)
    this.menuEl.style.display = name === 'menu' ? 'flex' : 'none';
    this.lobbyEl.style.display = name === 'lobby' ? 'flex' : 'none';
    this.charSelectEl.style.display = name === 'select' ? 'block' : 'none';
    this.gameAreaEl.style.display = name === 'game' ? 'grid' : 'none';
    this.resultsEl.style.display = name === 'results' ? 'block' : 'none';
    const inGame = name === 'game' || name === 'results';
    this.exitBtnEl.style.display = inGame ? '' : 'none';
    this.saveBtnEl.style.display = name === 'game' ? '' : 'none';
    // Fullscreen-stage wave (Task 2): the full-bleed game stage + auto-hide topbar +
    // floating chrome are all scoped under this one mode class — centralized here
    // beside the #drawer close below, same "one seam, every path covered" reasoning
    // (menu/lobby/select/results/exitToMenu/loadGame all route through _showScreen).
    this.appRootEl.classList.toggle('app--game', name === 'game');
    // Task-2 fix-wave: #drawer is position:fixed, outside #game-area, so it doesn't get
    // hidden by the gameAreaEl.style.display flip above — it must be closed explicitly
    // whenever we're leaving the 'game' screen (gameover -> 'results', loadGame -> 'select',
    // exitToMenu -> 'menu', etc.), not just on the one path exitToMenu happened to cover.
    if (name !== 'game' && this._closeDrawer) this._closeDrawer();
  }

  // ─────────────────────────────────────────────────────────
  // Menu screens
  // ─────────────────────────────────────────────────────────
  showModeSelect() {
    this._showScreen('menu');
    this.menuEl.className = 'screen screen--hero';
    const totalMaps = MODS.reduce((n, m) => n + m.maps.length + m.worlds.length, 0);
    this.menuEl.innerHTML = `
      <img class="hero-art" src="${this.activeMod.keyArt}" alt="Meinopoly: Dominion" draggable="false" />
      <div class="hero-overlay">
        <div class="mode-grid">
          <button class="pix-btn pix-btn--primary pix-btn--lg mode-btn" id="btn-mode-local">LOCAL GAME</button>
          <button class="pix-btn pix-btn--default pix-btn--lg mode-btn" id="btn-mode-online">ONLINE GAME</button>
        </div>
        <div class="title__press"><span class="glyph glyph--arrow"></span> PRESS START</div>
        <div class="title__foot">v0.4 · ${MODS.length} MODS · ${pluralize(totalMaps, 'MAP')} · TRADE &amp; AUCTION</div>
      </div>
    `;
    document.getElementById('btn-mode-local').onclick = () => { this.mode = 'local'; this.showModSelect(); };
    document.getElementById('btn-mode-online').onclick = () => { this.mode = 'online'; this.showOnlineLobby(); };
  }

  // Mod-pick step (LOCAL only) — sits BEFORE map-select, mirroring the map-card UI.
  // With only one mod registered it AUTO-ADVANCES: selectMod() + straight to map-select, so
  // the step is invisible and the existing E2E flow (hero → map → players → …) is unchanged.
  // When >1 mod exists (Stage 3), the cards render and the player picks.
  showModSelect() {
    if (MODS.length <= 1) {
      this.selectMod(MODS[0]); // installs the engine RULES + rebuilds availableMaps
      this.showMapSelect();
      return;
    }
    this._showScreen('menu');
    this.menuEl.className = 'screen screen--menu';
    let cards = '';
    MODS.forEach((mod, idx) => {
      const sel = this.activeMod && this.activeMod.id === mod.id;
      const defMap = mod.maps.concat(mod.worlds)[0];
      const preview = defMap ? miniMapSvg(defMap) : '';
      cards += `
        <div class="pix-panel map-card mod-card ${sel ? 'map-card--sel' : ''}" data-mod-idx="${idx}">
          <div class="pix-panel__accent" style="background:var(--accent)"></div>
          <div class="pix-panel__body">
            ${preview}
            <div class="map-card__title">${esc(mod.name)}</div>
            <div class="map-card__desc">${esc(mod.tagline || '')}</div>
            <div class="map-card__meta">
              <span class="map-tag">${esc(pluralize((mod.characters || []).length, 'CHARACTER'))}</span>
              <span class="map-tag">${esc(pluralize(mod.maps.length + mod.worlds.length, 'MAP'))}</span>
            </div>
          </div>
        </div>`;
    });
    this.menuEl.innerHTML = `
      ${this._breadcrumb('mod')}
      <div><div class="menu__heading">SELECT MOD</div><div class="menu__sub">Choose the game world to play</div></div>
      <div class="map-grid">${cards}</div>
      <button class="pix-btn pix-btn--ghost" id="btn-back-mode-mods"><span class="glyph glyph--arrow-back"></span> BACK</button>
    `;
    this.menuEl.querySelectorAll('.map-card').forEach(card => {
      card.onclick = () => {
        const idx = parseInt(card.dataset.modIdx);
        this.selectMod(MODS[idx]);
        this.showMapSelect();
      };
    });
    document.getElementById('btn-back-mode-mods').onclick = () => this.showModeSelect();
    this._wireBreadcrumb(this.menuEl);
  }

  // Install a mod: set activeMod, point the engine RULES singleton + board defaults at it
  // (setActiveMod, from Game.js), then rebuild availableMaps from this mod's boards. Char
  // cards / keyArt / atlas assets all read from this.activeMod afterward. LOCAL only — the
  // online path pins Dominion (never calls setActiveMod over the wire).
  selectMod(mod) {
    this.activeMod = mod;
    setActiveMod(mod.id);
    this.availableMaps = mod.maps.concat(mod.worlds);
    // Land on this mod's default board so a subsequent victory-select / quick-start reads
    // a board that belongs to the chosen mod (map-select overrides this on pick).
    this.setMap(this.availableMaps[0]);
  }

  showMapSelect() {
    this._showScreen('menu');
    this.menuEl.className = 'screen screen--menu';
    let cards = '';
    this.availableMaps.forEach((mapJson, idx) => {
      const isWorld = mapJson.movementMode === 'atlas';
      const layoutLabel = isWorld ? 'ATLAS' : mapJson.layout.type;
      const spaceLabel = isWorld ? (mapJson.places.length + ' PLACES') : (mapJson.spaceCount + ' SPACES');
      const catLabel = isWorld
        ? (mapJson.winPaths || []).join(' / ').toUpperCase()
        : ((mapJson.world && mapJson.world.category) || '');
      const accent = isWorld ? 'var(--accent)' : (mapJson.theme.logoColor || 'var(--accent)');
      const title = mapJson.name;
      const desc = isWorld ? (mapJson.story || '') : (mapJson.description || '');
      const preview = miniMapSvg(mapJson);
      cards += `
        <div class="pix-panel map-card" data-map-idx="${idx}">
          <div class="pix-panel__accent" style="background:${accent}"></div>
          <div class="pix-panel__body">
            ${preview}
            <div class="map-card__title">${esc(title)}</div>
            <div class="map-card__desc">${esc(desc)}</div>
            <div class="map-card__meta">
              <span class="map-tag">${esc(layoutLabel)}</span>
              <span class="map-tag">${esc(spaceLabel)}</span>
              ${catLabel ? `<span class="map-tag">${esc(catLabel)}</span>` : ''}
            </div>
          </div>
        </div>`;
    });
    this.menuEl.innerHTML = `
      ${this._breadcrumb('map')}
      <div><div class="menu__heading">SELECT MAP</div><div class="menu__sub">Choose the board you want to play on</div></div>
      <div class="map-grid">${cards}</div>
      <button class="pix-btn pix-btn--ghost" id="btn-back-mode"><span class="glyph glyph--arrow-back"></span> BACK</button>
    `;
    this.menuEl.querySelectorAll('.map-card').forEach(card => {
      card.onclick = () => {
        const idx = parseInt(card.dataset.mapIdx);
        this.setMap(this.availableMaps[idx]);
        this.showSetup();
      };
    });
    // BACK from map-select returns to mod-select (which auto-advances back to the hero when
    // only one mod exists, so the single-mod flow still goes map → hero).
    document.getElementById('btn-back-mode').onclick = () =>
      MODS.length > 1 ? this.showModSelect() : this.showModeSelect();
    this._wireBreadcrumb(this.menuEl);
  }

  // Progress breadcrumb (LOCAL mode only). renderCharacterSelect is shared with the online flow,
  // so the breadcrumb must never render/wire online (its clicks call local-only show* methods that
  // mutate the RULES singleton + activeMod and would abandon a live online client).
  _breadcrumb(current) {
    if (this.mode !== 'local') return '';
    const picks = {
      mod: this.activeMod ? this.activeMod.name : '',
      map: this.mapData ? (this.mapData.name || '') : '',
    };
    const steps = breadcrumbSteps({ current, picks, modCount: MODS.length });
    const items = steps.map(s => {
      const cls = 'breadcrumb__step breadcrumb__step--' + s.state + (s.interactive ? ' breadcrumb__step--clickable' : '');
      const val = s.value ? `<span class="breadcrumb__val">${esc(s.value)}</span>` : '';
      const attr = s.interactive ? ` data-step="${s.key}"` : '';
      return `<span class="${cls}"${attr}>${s.label}${val}</span>`;
    }).join('<span class="breadcrumb__sep">›</span>');
    return `<div class="breadcrumb">${items}</div>`;
  }

  // rootEl scopes the wiring to the screen just rendered (menuEl / charSelectEl). The non-active
  // screen keeps its last-rendered breadcrumb at display:none, so an UNscoped document query would
  // also attach handlers to those hidden, stale nodes.
  _wireBreadcrumb(rootEl) {
    if (this.mode !== 'local') return;
    const routes = {
      mode: () => this.showModeSelect(),
      mod: () => (MODS.length > 1 ? this.showModSelect() : this.showModeSelect()),
      map: () => this.showMapSelect(),
      setup: () => this.showSetup(),
    };
    (rootEl || document).querySelectorAll('.breadcrumb__step--clickable').forEach(el => {
      const key = el.dataset.step;
      if (routes[key]) el.onclick = () => this._softExitTo(routes[key]);
    });
  }

  // Soft exit: if a game client is already running (we're on CHARACTER, post-START), stop it +
  // tear down the globe BUT preserve activeMod / mapData / _setupSel so the target menu step keeps
  // the user's picks. Distinct from exitToMenu(), which also resets victory + map to defaults.
  _softExitTo(fn) {
    if (this.client) {
      this._cancelRoll();
      this._teardownGlobe();
      this._stopClient();
      this._pendingCharId = null;
      this._lastG = null;
      this._lastCtx = null;
    }
    fn();
  }

  // Merged player-count + victory screen. _setupSel persists across re-entries and is keyed to
  // the map it was built for: a same-map re-entry (e.g. a breadcrumb jump-back) keeps the user's
  // picks; a different map re-derives victory defaults (groups/turns are map-specific).
  showSetup(playerCount) {
    this._showScreen('menu');
    const mapId = this.mapData.id;
    const prev = this._setupSel;
    if (!prev || prev.mapId !== mapId) {
      // pre-fill victory from the active map (treat bare wealth/no-cap as Last Standing so the
      // UI default matches the game's feel — same rule the old showVictorySelect used).
      const mv = this.mapData.victory || {};
      let defPrimary = mv.primary || 'survival';
      if (defPrimary === 'wealth' && !mv.maxTurns) defPrimary = 'survival';
      this._setupSel = {
        playerCount: playerCount || (prev && prev.playerCount) || 2,
        primary: defPrimary,
        maxTurns: mv.maxTurns || 30,
        groupsToWin: (mv.params && mv.params.groupsToWin) || RULES.victory.groupsToWin || 3,
        mapId: mapId,
      };
    } else if (playerCount) {
      this._setupSel.playerCount = playerCount;
    }
    this._renderSetup();
  }

  _renderSetup() {
    const s = this._setupSel;
    this.menuEl.className = 'screen screen--menu';
    let counts = '';
    for (let n = 2; n <= 10; n++) {
      counts += `<button class="pix-btn ${s.playerCount === n ? 'pix-btn--primary' : 'pix-btn--default'} count-btn" data-count="${n}">${n}</button>`;
    }
    const MODES = [
      { id: 'survival', label: 'LAST STANDING', desc: 'Last player not bankrupt wins. Classic elimination.' },
      { id: 'wealth', label: 'TIMED · RICHEST', desc: 'After a set number of turns, the highest net worth wins.' },
      { id: 'monopoly', label: 'DOMINION', desc: 'First to control a set number of full color groups wins instantly.' },
    ];
    const cards = MODES.map(m => `
      <div class="pix-panel map-card vic-card ${s.primary === m.id ? 'vic-card--sel' : ''}" data-mode="${m.id}">
        <div class="pix-panel__body">
          <div class="map-card__title">${m.label}</div>
          <div class="map-card__desc">${m.desc}</div>
          ${s.primary === m.id ? '<div class="charcard__seltag">SELECTED</div>' : ''}
        </div>
      </div>`).join('');

    let param = '';
    if (s.primary === 'wealth') {
      param = `<div class="vic-param"><span class="aiset__label">TURN LIMIT</span>
        <div class="trade__cashctl"><button id="vic-mt-dec">−</button><span class="trade__cashval">${s.maxTurns}</span><button id="vic-mt-inc">+</button></div></div>`;
    } else if (s.primary === 'monopoly') {
      param = `<div class="vic-param"><span class="aiset__label">GROUPS TO WIN</span>
        <div class="trade__cashctl"><button id="vic-gw-dec">−</button><span class="trade__cashval">${s.groupsToWin}</span><button id="vic-gw-inc">+</button></div></div>`;
    }

    this.menuEl.innerHTML = `
      ${this._breadcrumb('setup')}
      <div><div class="menu__heading">GAME SETUP</div><div class="menu__sub">Players &amp; victory condition</div></div>
      <div class="setup__count"><span class="aiset__label">PLAYERS</span><div class="count-grid">${counts}</div></div>
      <div class="vic-grid">${cards}</div>
      <div class="vic-paramrow">${param}</div>
      <div class="vic-actions">
        <button class="pix-btn pix-btn--ghost" id="btn-vic-back"><span class="glyph glyph--arrow-back"></span> BACK</button>
        <button class="pix-btn pix-btn--primary pix-btn--lg" id="btn-vic-start">START GAME <span class="glyph glyph--arrow"></span></button>
      </div>
    `;

    this.menuEl.querySelectorAll('.count-btn').forEach(btn => {
      btn.onclick = () => { this._setupSel.playerCount = parseInt(btn.dataset.count); this._renderSetup(); };
    });
    this.menuEl.querySelectorAll('.vic-card').forEach(card => {
      card.onclick = () => { this._setupSel.primary = card.dataset.mode; this._renderSetup(); };
    });
    const dec = (id, key, min) => { const el = document.getElementById(id); if (el) el.onclick = () => { this._setupSel[key] = Math.max(min, this._setupSel[key] - (key === 'maxTurns' ? 5 : 1)); this._renderSetup(); }; };
    const inc = (id, key, max) => { const el = document.getElementById(id); if (el) el.onclick = () => { this._setupSel[key] = Math.min(max, this._setupSel[key] + (key === 'maxTurns' ? 5 : 1)); this._renderSetup(); }; };
    dec('vic-mt-dec', 'maxTurns', 5); inc('vic-mt-inc', 'maxTurns', 200);
    dec('vic-gw-dec', 'groupsToWin', 1); inc('vic-gw-inc', 'groupsToWin', 8);

    document.getElementById('btn-vic-back').onclick = () => this.showMapSelect();
    document.getElementById('btn-vic-start').onclick = () => {
      const sel = this._setupSel;
      // A map's own victory.maxTurns is a FALLBACK terminator even for non-wealth modes —
      // otherwise a survival/dominion game on a no-natural-end map (e.g. Terra) could run
      // forever. Wealth mode uses the player-chosen turn limit; classic maps define no maxTurns.
      const mapMaxTurns = (this.mapData.victory && this.mapData.victory.maxTurns) || 0;
      setVictoryConfig({
        primary: sel.primary,
        maxTurns: sel.primary === 'wealth' ? sel.maxTurns : mapMaxTurns,
        groupsToWin: sel.groupsToWin,
      });
      this.startGameWithPlayers(sel.playerCount);
    };
    this._wireBreadcrumb(this.menuEl);
  }

  showOnlineLobby() {
    // Online pins Dominion: mod-select is LOCAL-only (we never setActiveMod over the wire,
    // and the server runs the default mod). If a prior local game switched mods, reset the
    // engine RULES singleton + activeMod back to Dominion before joining an online match.
    if (this.activeMod !== MODS[0]) this.selectMod(MODS[0]);
    this._showScreen('lobby');
    this.lobbyEl.className = 'screen screen--menu';
    const serverUrl = window.location.protocol + '//' + window.location.hostname + ':8088';
    const lobby = new Lobby(this.lobbyEl, serverUrl, (matchID, playerID, credentials, numPlayers) => {
      this.startOnlineGame(serverUrl, matchID, playerID, credentials, numPlayers);
    });
    lobby.onBack = () => this.showModeSelect();
  }

  startOnlineGame(serverUrl, matchID, playerID, credentials, numPlayers) {
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
    this._bumpClients(1);
  }

  startGameWithPlayers(numPlayers) {
    this.client = Client({ game: Monopoly, numPlayers: numPlayers, debug: false });
    this.client.start();
    this.client.subscribe(state => this.update(state));
    this._bumpClients(1);
  }

  // ─────────────────────────────────────────────────────────
  // Main render dispatch
  // ─────────────────────────────────────────────────────────
  update(state) {
    if (state === null) return;
    // Online mod/map alignment (MT2-SP3, spec §0b): the server stamps its
    // active mod/map into G (setup()); a mismatched local selection (online
    // pins dominion pre-sync) would render the wrong board — atlas positions
    // index past a 40-space local array and crash — and the wrong roster in
    // character select. Copy-adapts loadGame()'s align-by-id pattern incl.
    // its undefined-safe fallbacks. Runs BEFORE the characterSelect branch.
    // Only ever fires for online clients: local flows install the mod/map
    // BEFORE the client exists, so ids already match and this no-ops.
    if (state.G && state.G.activeModId) {
      const wantMod = state.G.activeModId;
      const wantMap = state.G.activeMapId;
      const curMap = this.mapData && this.mapData.id;
      if (this.activeMod.id !== wantMod || (wantMap || null) !== (curMap || null)) {
        const mod = MODS.find(m => m.id === wantMod) || MODS[0];
        if (mod !== this.activeMod) this.selectMod(mod);
        const targetMap = this.availableMaps.find(m => m.id === wantMap) || this.availableMaps[0];
        this.setMap(targetMap);
      }
    }
    // Release the dice-roll lock once the post-roll state has actually arrived (held
    // across the animation AND the move round-trip, so a high-latency roll can't be
    // double-submitted while #btn-roll lingers).
    this._rolling = false;
    const G = state.G;
    const ctx = state.ctx;

    if (G.phase === 'characterSelect') {
      this._showScreen('select');
      this.renderCharacterSelect(G, ctx);
      return;
    }

    if (ctx.gameover) {
      this._teardownGlobe(); // results screen doesn't call renderBoard — stop the globe RAF/WebGL
      if (this.animator) this.animator.reset(); // clear any in-flight dice/hop before results paint
      this._showScreen('results');
      this.renderResults(G, ctx);
      return;
    }

    this._showScreen('game');
    this.detectAndTriggerAI(G, ctx);
    this.renderBoard(G, ctx);
    this.renderTokens(G, ctx);
    this.renderPlayerInfo(G, ctx);
    this.renderTurnbox(G, ctx);
    this.renderManage(G, ctx);
    this.renderMessages(G);
    this._updateLogUnread(G);
    this._renderAIResponses();
    this.renderChatPanel(G, ctx);
    this.renderStateModal(G, ctx);
    this.wireActions(G, ctx);
    this._resolveAtlasRoute(G, ctx);
    // After BOTH route resolvers have run for this render (flat: the line above;
    // globe: _updateGlobeOverlay inside renderBoard, earlier in this update) — sync
    // the route-pick chrome modality. See _syncRoutePickChrome.
    this._syncRoutePickChrome();
    // Chrome-band sizing runs last, after renderPlayerInfo/renderTurnbox have
    // written this render's real chip-strip/action-bar markup — see doc
    // comment on the method for why this is JS-measured instead of a static
    // CSS worst-case default.
    this._syncChromeBands();
    if (this.animator) { this.animator.onState(G); this.animator.afterRender(); }
  }

  // Chrome-band sizing (Task 2 review fix). `.app--game .board` (index.html)
  // sizes off `calc(100dvh - var(--chrome-top) - var(--chrome-bottom))`
  // instead of the raw viewport, so the full-bleed board never renders
  // underneath the floating chip strip (top) or action bar (bottom) — at
  // rest those two bars measured 64px and 96px tall respectively at
  // 1400x900, and a plain `min(100dvw,100dvh,1100px)` board (the pre-fix
  // rule) is exactly 100dvh on any landscape viewport, i.e. zero letterbox
  // to absorb them.
  // A STATIC CSS default sized for the worst case would have to cover the
  // jail turnbox state (ROLL FOR DOUBLES + PAY FINE + disabled END TURN) —
  // measured 152px tall, 58% taller than the 96px rest state — and pinning
  // the reserved band there permanently shrinks the board (658px vs the
  // achievable ~900px at 1400x900) even during the ~95% of turns when the
  // bar is only 84-96px. Measuring the REAL heights here instead keeps the
  // board as large as the chrome actually on screen allows, and only
  // shrinks it while a genuinely taller state (e.g. jail) is really
  // rendered. this._lastChromeTop/_lastChromeBottom throttle the
  // `style.setProperty` writes (and the reflow each one triggers) to only
  // fire when a height genuinely changed — most renders don't change either
  // bar's content.
  _syncChromeBands() {
    if (!this.gameAreaEl || !this.chipsBarEl || !this.actionBarEl) return;
    // +8 = the bar's own fixed top/bottom offset (index.html: top:8px /
    // bottom:8px); +4 = a small breathing-room gap so the board's edge
    // never sits pixel-adjacent to the bar. Same formula for both bars.
    const top = Math.ceil(this.chipsBarEl.getBoundingClientRect().height) + 8 + 4;
    const bottom = Math.ceil(this.actionBarEl.getBoundingClientRect().height) + 8 + 4;
    if (top !== this._lastChromeTop) {
      this._lastChromeTop = top;
      this.gameAreaEl.style.setProperty('--chrome-top', `${top}px`);
    }
    if (bottom !== this._lastChromeBottom) {
      this._lastChromeBottom = bottom;
      this.gameAreaEl.style.setProperty('--chrome-bottom', `${bottom}px`);
    }
  }

  // Fullscreen-stage wave (Task 2 regression fix, caught by gameplay.spec's Terra
  // Circuit case): under .app--game the chip strip and action bar are fixed overlays
  // ON TOP of the full-bleed board, so a route-target tile (flat atlas) or .gcity
  // route label (globe) that happens to sit under them is unclickable — Playwright's
  // actionability log showed `.game__actionbar intercepts pointer events` on a
  // bottom-row tile, and the same applies to the top-center chip strip. While a
  // route fork is awaiting a pick, the ONLY meaningful input is picking a route, so
  // `game--routepick` (on #game-area) makes both chrome bars click-transparent and
  // dims them (CSS, .app--game-scoped) — the pending "CHOOSE YOUR ROUTE" hint in the
  // turnbox stays readable through the dim. Called every update() after both route
  // resolvers, plus immediately from the two commit click-handlers so online play
  // (where the post-commit render is a network round-trip away) re-enables chrome
  // without waiting.
  _syncRoutePickChrome() {
    if (!this.gameAreaEl) return;
    const on = !!(this._routeTargets || this._globeRouteTargets);
    this.gameAreaEl.classList.toggle('game--routepick', on);
  }

  // Atlas route-picker: after rollOnly pauses the turn (G.awaitingRoute), either
  // auto-commit when there is no genuine fork (≤1 reachable route), or highlight
  // each distinct destination city so the delegated board listener can commit on
  // click. Resets the highlight bookkeeping on every non-awaiting render so a
  // resolved turn never leaves a dangling target.
  _resolveAtlasRoute(G, ctx) {
    // On the globe board, route resolution (incl. auto-commit on non-fork turns) is
    // handled by _globeComputeRouteTargets inside _updateGlobeOverlay. Running this
    // flat-board resolver too would auto-commit the SAME route a second time → duplicate
    // commitRoute / INVALID_MOVE noise. Skip it on globe maps.
    if (this.mapData.renderMode === 'globe') { this._routeTargets = null; return; }
    const isMyTurn = !this.onlinePlayerID || ctx.currentPlayer === this.onlinePlayerID;
    if (!G.awaitingRoute || !isMyTurn) { this._routeTargets = null; return; }
    const player = G.players[ctx.currentPlayer];
    const choices = routeChoices(G.board.edges, player.position, G.lastDice.total);
    if (choices.length <= 1) {
      // No genuine fork — commit immediately (keeps non-fork turns one-click).
      this._routeTargets = null;
      this.client.moves.commitRoute(choices.length ? choices[0].route : []);
      return;
    }
    // Highlight each branch tile, keyed by the divergence node so routes that
    // reconverge on the same destination stay separately choosable; the delegated
    // listener commits the chosen branch's route on click.
    const targets = {};
    choices.forEach(c => { targets[c.node] = c.route; });
    this._routeTargets = targets;
    Object.keys(targets).forEach(id => {
      const tile = this.boardEl.querySelector(`.tile[data-space="${id}"]`);
      if (tile) tile.classList.add('tile--route-target');
    });
  }

  // ─────────────────────────────────────────────────────────
  // Character select
  // ─────────────────────────────────────────────────────────
  renderCharacterSelect(G, ctx) {
    this.charSelectEl.className = 'screen screen--select';
    const playerNo = parseInt(ctx.currentPlayer) + 1;
    const takenIds = G.players.filter(p => p.character).map(p => p.character.id);
    const remaining = G.players.filter(p => !p.character).length;
    const isLast = remaining <= 1;

    let cards = '';
    this.activeMod.characters.forEach(char => {
      const taken = takenIds.includes(char.id);
      const selected = this._pendingCharId === char.id;
      const startMoney = RULES.core.baseStartingMoney + char.stats.capital * RULES.stats.capital.startingMoneyBonus;
      cards += `
        <div class="charcard ${selected ? 'charcard--sel' : ''} ${taken ? 'charcard--taken' : ''}" data-char-id="${char.id}">
          <div class="charcard__top">
            ${portraitHtml(char, 72, selected)}
            <div class="charcard__id">
              <span class="charcard__name" style="color:${readableNameColor(char.color)}">${esc(char.name)}</span>
              <span class="charcard__title">${esc(char.title)}</span>
              <span class="charcard__money">START ${money(startMoney)}</span>
            </div>
          </div>
          <div class="charcard__stats">${statRowsHtml(char.stats, char.color)}</div>
          <div class="charcard__passive">
            <span class="charcard__passive-name">${esc(char.passive.name)}</span>
            <span class="charcard__passive-desc">${esc(char.passive.description)}</span>
          </div>
          <div class="charcard__foot">
            <button class="charcard__lore" data-char-id="${char.id}">VIEW LORE</button>
            ${this.characterAI.apiKey ? `<button class="charcard__ai" data-char-id="${char.id}">ASK AI</button>` : ''}
            ${taken ? '<span class="charcard__takentag">TAKEN</span>' : (selected ? '<span class="charcard__seltag">SELECTED</span>' : '')}
          </div>
          <div id="char-chat-${char.id}" style="display:none;"></div>
        </div>`;
    });

    const picked = this._pendingCharId ? this.activeMod.characters.find(c => c.id === this._pendingCharId) : null;
    const chosenHtml = picked
      ? `${portraitHtml(picked, 40, false)}<span style="color:${readableNameColor(picked.color)}">${esc(picked.name)}</span><span class="select__chosen-title">${esc(picked.title)}</span>`
      : '<span class="select__chosen-empty">Select a councillor to continue</span>';

    this.charSelectEl.innerHTML = `
      ${this._breadcrumb('character')}
      <div class="select__head">
        <div class="select__heading">
          <span class="select__p">PLAYER ${playerNo}</span>
          <span class="select__h">CHOOSE YOUR CHARACTER</span>
        </div>
        <div class="select__sub">Each councillor carries unique stats and a passive edge.</div>
      </div>
      <div class="select__grid">${cards}</div>
      <div class="select__bar">
        <button class="pix-btn pix-btn--ghost" id="btn-select-back"><span class="glyph glyph--arrow-back"></span> BACK</button>
        <div class="select__chosen">${chosenHtml}</div>
        <button class="pix-btn pix-btn--primary" id="btn-select-confirm" ${picked ? '' : 'disabled'}>${isLast ? 'BEGIN GAME <span class="glyph glyph--arrow"></span>' : 'NEXT PLAYER <span class="glyph glyph--arrow"></span>'}</button>
      </div>
    `;

    this.charSelectEl.querySelectorAll('.charcard:not(.charcard--taken)').forEach(card => {
      card.onclick = () => {
        this._pendingCharId = card.dataset.charId;
        this.renderCharacterSelect(G, ctx);
      };
    });
    this.charSelectEl.querySelectorAll('.charcard__lore').forEach(btn => {
      btn.onclick = (e) => { e.stopPropagation(); this.showLoreModal(btn.dataset.charId); };
    });
    this.charSelectEl.querySelectorAll('.charcard__ai').forEach(btn => {
      btn.onclick = (e) => { e.stopPropagation(); this._charSelectIntro(btn.dataset.charId); };
    });
    document.getElementById('btn-select-back').onclick = () => { this._pendingCharId = null; this.exitToMenu(); };
    const confirmBtn = document.getElementById('btn-select-confirm');
    confirmBtn.onclick = () => {
      if (!this._pendingCharId) return;
      const id = this._pendingCharId;
      this._pendingCharId = null;
      this.client.moves.selectCharacter(id);
    };
    this._wireBreadcrumb(this.charSelectEl);
  }

  // ─────────────────────────────────────────────────────────
  // Board
  // ─────────────────────────────────────────────────────────
  _centerHtml(G, ctx) {
    const season = SEASONS[G.seasonIndex];
    const interval = RULES.seasons.changeInterval;
    const cycle = (G.totalTurns % interval) + 1;
    let fx = '';
    if (season.priceMod !== 1.0) fx += `<span>PRICE ${season.priceMod > 1 ? '+' : ''}${Math.round((season.priceMod - 1) * 100)}%</span>`;
    if (season.rentMod !== 1.0) fx += `<span>RENT +${Math.round((season.rentMod - 1) * 100)}%</span>`;
    if (season.taxMod !== 1.0) fx += `<span>TAX x${season.taxMod}</span>`;
    if (RULES.core.freeParkingPot && G.freeParkingPot > 0) fx += `<span>POT $${G.freeParkingPot}</span>`;

    return `
      <div class="board__logo">
        <span class="board__logo-main">${esc(this.mapData.theme.logoText || 'MEINOPOLY')}</span>
        <span class="board__logo-sub">${esc(this.mapData.theme.logoSubtitle || 'DOMINION · COUNCIL OF WORLDS')}</span>
      </div>
      <div class="board__season">
        <span class="board__season-label">SEASON</span>
        <span class="board__season-val">${esc(season.name)}</span>
        <span class="board__season-turns">Cycle ${cycle}/${interval}${RULES.core.maxTurns > 0 ? ' · T' + G.totalTurns + '/' + RULES.core.maxTurns : ' · Turn ' + G.totalTurns}</span>
        ${fx ? `<div class="board__season-fx">${fx}</div>` : ''}
      </div>
      <div class="board__centerslot">${this._centerSlotHtml(G, ctx)}</div>
    `;
  }

  _centerSlotHtml(G, ctx) {
    const player = G.players[ctx.currentPlayer];
    const isMyTurn = !this.onlinePlayerID || ctx.currentPlayer === this.onlinePlayerID;
    const d = G.lastDice;
    const diceHtml = d
      ? `${dieHtml(d.d1)}${dieHtml(d.d2)}`
      : `${dieHtml(0)}${dieHtml(0)}`;
    const total = d ? `<div class="centerslot__total">TOTAL ${d.total}${d.isDoubles ? ` · DOUBLES x${G.doublesCount}` : ''}</div>` : '';

    let body = '';
    if (G.turnPhase === 'duel' && G.duel) {
      body = this._duelPromptHtml(G, ctx, isMyTurn);
    } else if (G.canBuy && isMyTurn) {
      const space = this.boardSpaces[player.position];
      const price = G.effectivePrice || space.price;
      body = `
        <div class="centerslot__prompt">
          <div class="cp__name">${esc(space.name)}</div>
          <div class="cp__price">${money(price)}</div>
          <div class="cp__btns">
            <button class="pix-btn pix-btn--success pix-btn--sm" id="btn-buy">BUY</button>
            <button class="pix-btn pix-btn--ghost pix-btn--sm" id="btn-pass">${RULES.auction.enabled && RULES.auction.auctionOnPass ? 'AUCTION' : 'PASS'}</button>
          </div>
        </div>`;
    } else {
      let hint = '';
      if (!isMyTurn) hint = 'WAITING…';
      else if (G.awaitingRoute) hint = 'CHOOSE YOUR ROUTE — CLICK A HIGHLIGHTED CITY';
      else if (player.inJail && !G.hasRolled) hint = 'PAY FINE OR ROLL FOR DOUBLES';
      else if (!G.hasRolled) hint = 'ROLL TO MOVE';
      else if (G.pendingCard) hint = 'RESOLVE YOUR CARD';
      else if (G.auction) hint = 'AUCTION IN PROGRESS';
      else if (G.trade) hint = 'TRADE PENDING';
      else hint = 'END TURN WHEN READY';
      body = `<div class="centerslot__hint">${hint}</div>`;
    }

    return `<div class="centerslot"><div class="centerslot__dice">${diceHtml}</div>${total}${body}</div>`;
  }

  // Rent-duel turnbox prompt (Task 9). Mirrors the buy/pass centerslot__prompt
  // pattern above exactly (same markup shape, same pix-btn sizing).
  //
  // 'offer' phase — the actor is the CHALLENGER (ctx.currentPlayer), so it
  // reuses the same `isMyTurn` the buy/pass prompt uses. DUEL! is disabled with
  // a cooldown tooltip per RULES.duel.cooldownTurns vs the challenger's
  // lastDuelTurn (engine formula in Game.js initiateDuel, mirrored read-only here).
  //
  // 'response' phase — the actor is the OWNER, who is NOT ctx.currentPlayer, so
  // `isMyTurn` (keyed off ctx.currentPlayer) can't gate this. Online
  // (G.enforceSeats), only the owner's client renders FIGHT/DECLINE; every other
  // client (including the challenger's) sees a waiting line naming the owner.
  // Hot-seat (enforceSeats false) always renders the buttons — same shared-screen
  // convention the trade/auction modals already use.
  _duelPromptHtml(G, ctx, isChallengerTurn) {
    const duel = G.duel;
    const space = this.boardSpaces[duel.propertyId];
    const challenger = G.players[duel.challengerId];
    const owner = G.players[duel.ownerId];
    const challengerName = challenger.character ? challenger.character.name : `Player ${parseInt(duel.challengerId) + 1}`;
    const ownerName = owner.character ? owner.character.name : `Player ${parseInt(duel.ownerId) + 1}`;

    if (duel.phase === 'offer') {
      if (!isChallengerTurn) return `<div class="centerslot__hint">WAITING…</div>`;
      // blocked via the shared helper (final-review Fix 3 — de-triplication);
      // `cd`/`last` stay local, only needed here for the "N turn(s)" tooltip
      // countdown, which isDuelCooldownBlocked doesn't compute.
      const cd = RULES.duel.cooldownTurns;
      const last = challenger.lastDuelTurn;
      const blocked = isDuelCooldownBlocked(challenger, G.totalTurns);
      const remaining = blocked ? cd - (G.totalTurns - last) : 0;
      return `
        <div class="centerslot__prompt">
          <div class="cp__name">${esc(space.name)} — rent ${money(duel.rent)}</div>
          <div class="cp__btns">
            <button class="pix-btn pix-btn--success pix-btn--sm" id="btn-payrent">PAY RENT</button>
            <button class="pix-btn pix-btn--danger pix-btn--sm" id="btn-duel" ${blocked ? `disabled title="Duel available in ${remaining} turn(s)"` : ''}>DUEL!</button>
          </div>
        </div>`;
    }

    // phase === 'response'
    const isOwnerSeat = !G.enforceSeats || !this.onlinePlayerID || String(this.onlinePlayerID) === String(duel.ownerId);
    if (!isOwnerSeat) {
      return `<div class="centerslot__hint">WAITING FOR ${esc(ownerName)} TO RESPOND…</div>`;
    }
    const loseAmount = Math.round(RULES.duel.loseMultiplier * duel.rent);
    return `
      <div class="centerslot__prompt">
        <div class="cp__name">${esc(ownerName)}, you are challenged for ${esc(space.name)}!</div>
        <div class="cp__info">Win: rent waived for ${esc(challengerName)}. Lose: pay ${RULES.duel.loseMultiplier}&times; rent (${money(loseAmount)}).</div>
        <div class="cp__btns">
          <button class="pix-btn pix-btn--danger pix-btn--sm" id="btn-fight">FIGHT</button>
          <button class="pix-btn pix-btn--ghost pix-btn--sm" id="btn-decline">DECLINE</button>
        </div>
      </div>`;
  }

  // Static two-roll duel-resolution result strip (Task 9 review fix). Spec §5
  // requires duel-resolution VISIBILITY of both sides' 2d6 — "requirement is
  // visibility, not instant text" — but the duel_resolved log line (events.js)
  // only surfaces TOTALS ("Duel! X 18 vs Y 11 — X wins!"), and task-9-report.md
  // §3 documented that both the dice-animation reuse AND this static-panel
  // fallback were skipped at ship time. This closes that gap: individual die
  // faces for both rolls, rendered in the turnbox (accepted fallback, no
  // animation — see brief).
  //
  // Scoped to THIS turn only: finds the most recent duel_resolved event with
  // `turn === G.totalTurns` so a stale result from a prior turn never lingers
  // into the next turn's turnbox once G.duel is cleared and a new turn begins.
  _duelResultStripHtml(G) {
    const ev = G.events.slice().reverse().find(e => e.type === 'duel_resolved' && e.turn === G.totalTurns);
    if (!ev) return '';
    const { ownerId, challengerRoll: cr, defenderRoll: dr, winnerId, outcome } = ev.data;
    const challengerId = ev.actor;
    const challenger = G.players[challengerId];
    const owner = G.players[ownerId];
    const winner = G.players[winnerId];
    const challengerName = challenger.character ? challenger.character.name : `Player ${parseInt(challengerId) + 1}`;
    const ownerName = owner.character ? owner.character.name : `Player ${parseInt(ownerId) + 1}`;
    const winnerName = winner.character ? winner.character.name : `Player ${parseInt(winnerId) + 1}`;
    const cBonus = cr.stamina + cr.luckBonus;
    const dBonus = dr.stamina + dr.luckBonus;
    const outcomeText = outcome === 'waived' ? 'rent waived' : `${RULES.duel.loseMultiplier}&times; rent paid`;
    return `
      <div class="turnbox__slot">
        <div class="cp__info">${esc(challengerName)} [${cr.dice[0]}][${cr.dice[1]}]+${cBonus} = ${cr.total} &nbsp;vs&nbsp; ${esc(ownerName)} [${dr.dice[0]}][${dr.dice[1]}]+${dBonus} = ${dr.total}</div>
        <div class="cp__info">${esc(winnerName)} WINS (${outcomeText})</div>
      </div>`;
  }

  _tileHtml(spaceId, G, opts) {
    const space = this.boardSpaces[spaceId];
    const isCorner = (this.mapData.cornerIds || []).includes(spaceId);
    const edge = opts.edge || (isCorner ? 'corner' : 'top');
    const owner = G.ownership[spaceId];
    const hasOwner = owner !== null && owner !== undefined;
    const ownerColor = hasOwner ? this._playerColor(G, owner) : '';
    const level = G.buildings[spaceId] || 0;
    const mortgaged = G.mortgaged[spaceId] || false;

    const barColor = space.color || (space.placeId ? placeIdColor(space.placeId) : '');
    const bar = barColor ? `<div class="tile__bar tile__bar--${edge}" style="background:${barColor}"></div>` : '';
    const g = space.isHub ? 'arrow' : tileGlyph(space.type);
    const glyph = g ? `<span class="glyph glyph--${g}"></span>` : '';
    const price = space.price > 0 ? `<span class="tile__price">$${space.price}</span>` : '';

    let owned = '';
    let flag = '';
    if (hasOwner) {
      let pips = '';
      const count = Math.max(1, level);
      for (let i = 0; i < count; i++) pips += '<span class="tile__house"></span>';
      owned = `<div class="tile__owner" style="--ocol:${ownerColor}">${pips}</div>`;
      // Ownership flag (spec 2026-07-12 §3): WHO owns, at a glance. Portraits
      // resolve via the client bundle (G characters never carry .portrait).
      const ownerPlayer = G.players[Number(owner)];
      const cchar = ownerPlayer && ownerPlayer.character && this._clientChar(ownerPlayer.character);
      flag = cchar && cchar.portrait
        ? `<img class="tile__flag" src="${esc(cchar.portrait)}" alt="">`
        : `<span class="tile__flag tile__flag--letter">${esc(ownerPlayer && ownerPlayer.character ? ownerPlayer.character.name[0] : String(Number(owner) + 1))}</span>`;
    }
    const mort = mortgaged ? '<div class="tile__mort">M</div>' : '';

    // Tokens are NOT rendered into tiles — they live in the persistent
    // #token-layer overlay (see renderTokens), so they survive grid rebuilds.

    const pot = (space.type === 'parking' && RULES.core.freeParkingPot && G.freeParkingPot > 0)
      ? `<div class="tile__pot">$${G.freeParkingPot}</div>` : '';

    // Real-city photo behind the tile (atlas place tiles with a bundled image). The
    // place-group color bar + name/price/glyph render ON TOP via a dark scrim for
    // legibility; tiles without an image keep the plain color tile (fallback).
    const assets = this.mapData.atlasAssets;
    const cityImg = (assets && this.mapData.movementMode === 'atlas' && space.placeId)
      ? assets.cityImages[space.placeId] : null;
    const photo = cityImg
      ? `<div class="tile__photo" style="background-image:url('${cityImg}')"></div><div class="tile__scrim"></div>`
      : '';

    const cls = `tile tile--${edge} ${isCorner ? 'tile--corner' : ''} ${mortgaged ? 'tile--mortgaged' : ''} ${opts.abs ? 'tile--abs' : ''} ${space.isHub ? 'tile--hub' : ''} ${cityImg ? 'tile--photo' : ''} ${hasOwner ? 'tile--owned' : ''} tile--click`;
    // --ocol lives on the TILE itself (not just the .tile__owner pip strip) so both
    // the tile--owned border AND the .tile__flag (child, inherits the custom prop)
    // can read it. Appended onto opts.style rather than replacing it — opts.style
    // already carries the tile's grid/absolute positioning.
    const styleAttr = (opts.style || '') + (hasOwner ? `--ocol:${ownerColor};` : '');
    const style = styleAttr ? ` style="${styleAttr}"` : '';
    return `<div class="${cls}" data-space="${spaceId}"${style}>${photo}${bar}<div class="tile__inner">${glyph}<span class="tile__name">${esc(space.name)}</span>${price}</div>${owned}${flag}${mort}${pot}</div>`;
  }

  _playerColor(G, id) {
    const p = G.players[parseInt(id)];
    return p && p.character ? p.character.color : PLAYER_COLORS[parseInt(id)];
  }

  // Ownership color for a globe point (city). A "place" (atlas city) spans one or
  // more board spaces (space.placeId) — e.g. terra-titans is 3 slots/city — so this
  // rolls all of a city's slots up into one dot color: everything owned by the same
  // player -> that player's color; owned by more than one player -> contested warm
  // gray; nothing owned yet -> the neutral default (matches the pre-ownership red).
  _placeOwnerColor(G, placeId) {
    const owners = new Set();
    for (let i = 0; i < this.boardSpaces.length; i++) {
      const sp = this.boardSpaces[i];
      if (!sp || sp.placeId !== placeId) continue;
      const o = G.ownership[i];
      if (o !== null && o !== undefined) owners.add(o);
    }
    if (owners.size === 0) return '#ff5c5c';
    if (owners.size === 1) return this._playerColor(G, owners.values().next().value);
    return '#9a8f7f'; // contested — this city's slots are split across owners
  }

  // Resolve the CLIENT (portrait-bearing) character for a G-sourced Tier-A character.
  // mods/index.js is explicitly server/test-safe ("NO image imports here") — every
  // player.character read straight off G (id/name/stats/passive/color) has no `portrait`
  // field, by design, so both online and offline matches serialize identically. The client
  // resolves the real asset by id against its own roster, the same pattern already used by
  // showLoreModal/_sendChat/_charSelectIntro (this.activeMod.characters.find(c => c.id ===
  // charId)). Task 3 discovery: renderTokens/_updateGlobeOverlay previously read
  // p.character.portrait directly (always undefined) — this is why tokens never actually
  // showed a portrait; see task-3-report.md.
  _clientChar(gChar) {
    if (!gChar || !this.activeMod || !this.activeMod.characters) return gChar || null;
    return this.activeMod.characters.find(c => c.id === gChar.id) || gChar;
  }

  renderBoard(G, ctx) {
    const mode = this.mapData.renderMode;
    // Tear down the globe when we leave globe mode (frees the WebGL context + RAF loop).
    if (mode !== 'globe') this._teardownGlobe();
    if (mode === 'globe') this._renderGlobeBoard(G, ctx);
    else if (this.mapData.layoutType === 'square') this._renderSquareBoard(G, ctx);
    else this._renderAbsoluteBoard(G, ctx);
  }

  // Stop the globe RAF loop, resize observer, and WebGL context, and drop overlay
  // refs. Safe to call when no globe is up (no-op). Must run on EVERY path that leaves
  // the globe board — not just renderBoard's non-globe branch, but also game-over and
  // exitToMenu, which return from update() before renderBoard runs (else the RAF loop
  // and WebGL canvas leak for the rest of the session).
  _teardownGlobe() {
    // Bump the epoch so any in-flight getGlobe() load resolves into a no-op.
    this._globeEpoch = (this._globeEpoch || 0) + 1;
    // Drop the ownership-recolor cache so a freshly (re)created globe always gets
    // its first pointColor assignment from _updateGlobeOverlay's delta-check,
    // instead of comparing against a stale key from the torn-down instance.
    this._lastOwnershipKey = null;
    if (!this._globe && !this._globeRaf && !this._globeResizeObs) return;
    if (this._globeRaf) { cancelAnimationFrame(this._globeRaf); this._globeRaf = null; }
    if (this._globeResizeObs) { this._globeResizeObs.disconnect(); this._globeResizeObs = null; }
    this._globeOverlay = null; this._globePovKey = null; this._globeRouteTargets = null;
    if (this._globe) {
      try { this._globe._destructor && this._globe._destructor(); } catch (e) { /* ignore */ }
      this._globe = null;
    }
    this._globeLoading = false;
  }

  // Resize the WebGL canvas when the board element changes size, so getScreenCoords
  // and the HTML overlays stay aligned (mirrors the token layer's resize handling).
  _ensureGlobeResizeObserver() {
    if (this._globeResizeObs || typeof ResizeObserver === 'undefined' || !this.boardEl) return;
    this._globeResizeObs = new ResizeObserver(() => {
      if (this._globe) this._globe.width(this.boardEl.clientWidth || 600).height(this.boardEl.clientHeight || 600);
    });
    this._globeResizeObs.observe(this.boardEl);
  }

  // Stage 2 — pixel-globe substrate: the world map on a low-res (pixelated) globe with
  // city points + great-circle route arcs. Created ONCE (renderBoard runs every state
  // change) then updated. Interactive tiles/tokens/camera/mini-map are Stage 3.
  _renderGlobeBoard(G, ctx) {
    this.boardEl.className = 'board board--globe';
    this._ensureBoardChildren();

    const places = (this.mapData.atlasPlaces || []).filter(p => p.geo);
    const byId = {};
    places.forEach(p => { byId[p.id] = p; });
    const points = places.map(p => ({ lat: p.geo.lat, lng: p.geo.lng, name: (p.realName || p.id).toUpperCase(), id: p.id }));
    const arcs = [];
    places.forEach(p => {
      if (!p.connectors) return;
      Object.keys(p.connectors).forEach(dir => {
        const t = byId[p.connectors[dir]];
        if (t) arcs.push({ sLat: p.geo.lat, sLng: p.geo.lng, eLat: t.geo.lat, eLng: t.geo.lng, fromId: p.id, toId: t.id, hot: false });
      });
    });
    this._globeData = { points, arcs };

    if (this._globe) {
      this._globe.pointsData(points).arcsData(arcs);
      this._updateGlobeOverlay(G, ctx);
      this._globeCameraFollow(G, ctx, false);
      return;
    }
    if (this._globeLoading) return; // load already in flight
    this._globeLoading = true;
    // Epoch guard: getGlobe() is async (first call injects the vendored UMD). If the
    // player exits / loads / switches maps before it resolves, _teardownGlobe() bumps
    // the epoch and this stale callback bails instead of resurrecting the RAF/WebGL.
    const epoch = (this._globeEpoch || 0);
    const tex = this.mapData.atlasAssets ? this.mapData.atlasAssets.worldBg : null;

    this.activeMod.getGlobe().then(Globe => {
      this._globeLoading = false;
      if (epoch !== (this._globeEpoch || 0) || this.mapData.renderMode !== 'globe' || !this.client) return;
      const host = document.createElement('div');
      host.className = 'globe-host';
      this._gridWrap.innerHTML = '';
      this._gridWrap.appendChild(host);
      const W = this.boardEl.clientWidth || 600, H = this.boardEl.clientHeight || 600;
      const d = this._globeData;
      // Red city dots + gold route arcs are 3D (on the sphere). City NAME labels +
      // tokens + the route picker are crisp pixel-HTML overlays (see _globeTick), not
      // globe.gl's built-in 3D labels — keeps the Press Start 2P type sharp.
      const g = Globe()(host)
        .width(W).height(H)
        .backgroundColor('rgba(0,0,0,0)')
        .globeImageUrl(tex)
        .showAtmosphere(true).atmosphereColor('#6f7cd6').atmosphereAltitude(0.12)
        .pointsData(d.points).pointLat('lat').pointLng('lng')
        .pointColor(() => '#ff5c5c').pointAltitude(0.02).pointRadius(0.9)
        // Arcs are dim by default; the walkable travel route lights up + flows when the
        // player rolls into a fork (see _globeSetRouteArcs). 'hot' is set per-arc.
        .arcsData(d.arcs)
        .arcColor(a => a.hot ? ['#fff3c0', '#ffd24a'] : 'rgba(233,178,60,0.33)')
        .arcStroke(a => a.hot ? 2.3 : 0.8)
        .arcAltitude(a => a.hot ? 0.3 : 0.2)
        .arcDashLength(a => a.hot ? 0.5 : 1)
        .arcDashGap(a => a.hot ? 0.22 : 0)
        .arcDashAnimateTime(a => a.hot ? 1100 : 0)
        .arcStartLat('sLat').arcStartLng('sLng').arcEndLat('eLat').arcEndLng('eLng');
      g.controls().autoRotate = false;
      g.controls().enableZoom = true;       // allow scroll/pinch zoom (was disabled)
      g.controls().minDistance = 140;       // clamp the dolly so you can't fly through / lose the globe
      g.controls().maxDistance = 480;
      g.renderer().setPixelRatio(this.mapData.globePixelRatio); // ← the pixelation (lower = blockier)
      this._globe = g;
      this._setupGlobeOverlay();
      // Use the LATEST state, not the G/ctx captured at first render — state can advance
      // during the async lib load (e.g. a roll enters awaitingRoute). Initializing from
      // the stale closure would leave route targets/camera on the old state until some
      // unrelated update arrives (turn stall).
      const cur = this.client.getState();
      const curG = cur ? cur.G : G, curCtx = cur ? cur.ctx : ctx;
      this._updateGlobeOverlay(curG, curCtx);
      this._globeCameraFollow(curG, curCtx, true); // instant first POV onto the active player
    }).catch(e => {
      this._globeLoading = false;
      // Don't touch a board the player already navigated to while the load was failing.
      if (epoch !== (this._globeEpoch || 0) || this.mapData.renderMode !== 'globe') return;
      // Degrade gracefully: terra-globe carries derived flat pos data, so fall back to
      // the flat atlas renderer (playable) rather than an unplayable error screen.
      console.warn('globe.gl failed to load, falling back to flat atlas board:', e.message);
      this.mapData.renderMode = null;
      // Full re-render via update() (not just _renderAbsoluteBoard) so route resolution
      // runs too — _resolveAtlasRoute was skipped while renderMode was 'globe', and if
      // the failure landed mid-fork there's no further update to surface the choices.
      const cur = this.client && this.client.getState();
      if (cur) this.update(cur);
    });
  }

  // Lat/lng → screen px for ALL globe overlays, every frame (the camera tweens during
  // follow, so positions must track continuously). Far-side overlays are hidden. Cheap:
  // ~12 cities + a few tokens. Cancelled on globe teardown (renderBoard).
  _setupGlobeOverlay() {
    let ov = this._gridWrap.querySelector('.globe-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.className = 'globe-overlay';
      this._gridWrap.appendChild(ov);
      // Delegated click: committing a chosen branch at a fork (route picker on the globe).
      ov.addEventListener('click', (e) => {
        const m = e.target.closest('.gcity[data-route]');
        if (!m || !this._globeRouteTargets) return;
        const route = this._globeRouteTargets[m.dataset.place];
        if (route) { this._globeRouteTargets = null; this._syncRoutePickChrome(); this.client.moves.commitRoute(route); }
      });
    }
    this._globeOverlay = ov;
    this._ensureGlobeResizeObserver();
    if (!this._globeRaf) this._globeTick();
  }

  _globeTick() {
    this._globeRaf = requestAnimationFrame(() => this._globeTick());
    const g = this._globe, ov = this._globeOverlay;
    if (!g || !ov) return;
    const pov = g.pointOfView();
    const els = ov.querySelectorAll('[data-lat]');
    const cities = []; // visible .gcity name labels, for collision declutter below
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      const lat = parseFloat(el.dataset.lat), lng = parseFloat(el.dataset.lng);
      // Route-target cities MUST stay visible + clickable even on the far hemisphere,
      // or a legal branch becomes unselectable (the camera holds on the current city
      // during a fork). Everything else culls on the far side.
      const show = onGlobeNearSide(lat, lng, pov) || !!el.dataset.route;
      el.style.display = show ? '' : 'none';
      if (!show) continue;
      const sc = g.getScreenCoords(lat, lng, parseFloat(el.dataset.alt || '0.01'));
      if (!sc) { el.style.display = 'none'; continue; }
      const ox = parseFloat(el.dataset.offx || '0');
      const x = sc.x + ox;
      el.style.transform = `translate(-50%,-50%) translate(${x}px, ${sc.y}px)`;
      if (el.classList.contains('gcity')) {
        const txt = el.textContent || '';
        const route = !!el.dataset.route;
        cities.push({ el, x, y: sc.y, w: txt.length * 6.5 + (route ? 14 : 2), h: route ? 18 : 11,
          force: route, prio: parseFloat(el.dataset.prio || '0') });
      }
    }
    // Declutter the 49 city labels: keep route targets + then highest-population cities,
    // hiding any whose screen box overlaps an already-kept label. Screen-space, so it's
    // zoom-aware — zooming in spreads cities apart and more labels survive. Cheap (~49²).
    cities.sort((a, b) => (b.force - a.force) || (b.prio - a.prio));
    const kept = [];
    for (let i = 0; i < cities.length; i++) {
      const c = cities[i];
      let hide = false;
      if (!c.force) {
        for (let k = 0; k < kept.length; k++) {
          const r = kept[k];
          if (Math.abs(c.x - r.x) * 2 < (c.w + r.w) && Math.abs(c.y - r.y) * 2 < (c.h + r.h)) { hide = true; break; }
        }
      }
      if (hide) c.el.style.display = 'none'; else kept.push(c);
    }
  }

  // Rebuild/refresh overlay CONTENT (labels, route highlights, tokens) on each state
  // change. Positions are handled by _globeTick. Idempotent — reuses existing nodes.
  _updateGlobeOverlay(G, ctx) {
    // Ownership-driven point recolor (Task 2). Re-assigning pointColor makes globe.gl
    // re-evaluate the accessor for every point WITHOUT rebuilding pointsData/the globe,
    // so gate it on an actual ownership change (cheap JSON key) rather than doing it
    // unconditionally on every render (this runs on every G update). Placed before the
    // `!ov` early-return below since it only needs this._globe, not the label/token
    // overlay DOM — and it must still run on the very first call right after globe
    // creation (see _renderGlobeBoard), which is when the neutral placeholder
    // pointColor set at creation gets corrected to real ownership.
    if (this._globe) {
      const ownKey = JSON.stringify(G.ownership);
      if (ownKey !== this._lastOwnershipKey) {
        this._lastOwnershipKey = ownKey;
        this._globe.pointColor(d => this._placeOwnerColor(G, d.id));
      }
    }
    const ov = this._globeOverlay;
    if (!ov) return;
    const places = (this.mapData.atlasPlaces || []).filter(p => p.geo);
    const geoOf = {};
    places.forEach(p => { geoOf[p.id] = p.geo; });
    this._globeGeoOf = geoOf; // hoisted so _makeAnimStage's globe placement branch can reuse it

    // Route picker (globe): highlight the destination city of each branch, clickable.
    const routeTargets = this._globeComputeRouteTargets(G, ctx);
    this._globeRouteTargets = routeTargets;
    // Light up the walkable travel route(s) along the sphere arcs (dim otherwise).
    this._globeSetRouteArcs(G, ctx);

    places.forEach(p => {
      let el = ov.querySelector(`.gcity[data-place="${p.id}"]`);
      if (!el) {
        el = document.createElement('div');
        el.className = 'gcity';
        el.dataset.place = p.id;
        el.dataset.lat = p.geo.lat; el.dataset.lng = p.geo.lng; el.dataset.alt = '0.06';
        // Declutter priority: bigger cities keep their label when labels collide (hubs are
        // all large, so this also favors them). Static per place → set once at creation.
        el.dataset.prio = String((p.data && p.data.population) || 0);
        ov.appendChild(el);
      }
      el.textContent = (p.realName || p.id).toUpperCase();
      if (routeTargets && routeTargets[p.id]) { el.classList.add('gcity--route'); el.dataset.route = '1'; }
      else { el.classList.remove('gcity--route'); delete el.dataset.route; }
    });

    // Player tokens at their current city (space → placeId → geo), stacked with an x-offset.
    const active = G.players.filter(pl => !pl.bankrupt);
    const live = new Set(active.map(pl => String(pl.id)));
    ov.querySelectorAll('.gtoken[data-player]').forEach(el => { if (!live.has(el.dataset.player)) el.remove(); });
    const byPlace = {};
    active.forEach(pl => {
      const sp = this.boardSpaces[pl.position];
      const pid = sp && sp.placeId;
      (byPlace[pid] = byPlace[pid] || []).push(pl);
    });
    active.forEach(pl => {
      const sp = this.boardSpaces[pl.position];
      const pid = sp && sp.placeId;
      const geo = geoOf[pid];
      if (!geo) return;
      let el = ov.querySelector(`.gtoken[data-player="${pl.id}"]`);
      if (!el) {
        el = document.createElement('span');
        el.className = 'gtoken';
        el.dataset.player = String(pl.id);
        ov.appendChild(el);
      }
      const color = this._playerColor(G, pl.id);
      const label = pl.character ? pl.character.name[0] : (parseInt(pl.id) + 1);
      // Same raw-data contract as renderTokens (game-chrome.js tokenVisual) — applied
      // via DOM property assignments only, no HTML escaping needed.
      const v = tokenVisual(this._clientChar(pl.character), color, label);
      el.style.setProperty('--tcol', v.color);
      el.style.backgroundImage = v.portraitUrl ? `url('${v.portraitUrl}')` : '';
      el.classList.toggle('gtoken--face', !!v.portraitUrl);
      el.textContent = v.text;
      if (this.animator && this.animator.isAnimating(pl.id)) return; // animator owns placement mid-hop
      el.dataset.lat = geo.lat; el.dataset.lng = geo.lng; el.dataset.alt = '0.08';
      const peers = byPlace[pid];
      const idx = peers.indexOf(pl);
      el.dataset.offx = String((idx - (peers.length - 1) / 2) * 16);
    });
  }

  // Globe route picker: same divergence-keyed choices as the flat board, but keyed to
  // the branch's destination CITY (placeId) so the city overlay can be clicked. Returns
  // {placeId: route} or null (and auto-commits when there's no genuine fork).
  _globeComputeRouteTargets(G, ctx) {
    const isMyTurn = !this.onlinePlayerID || ctx.currentPlayer === this.onlinePlayerID;
    if (!G.awaitingRoute || !isMyTurn) return null;
    const player = G.players[ctx.currentPlayer];
    const choices = routeChoices(G.board.edges, player.position, G.lastDice.total);
    if (choices.length <= 1) {
      // PRODUCTION FIX (MT2-SP2 Task 10, instrumented + confirmed via a standalone repro):
      // dispatching commitRoute SYNCHRONOUSLY here re-enters update() — this function runs
      // inside _updateGlobeOverlay, itself inside _renderGlobeBoard/renderBoard, itself
      // inside the CURRENT update(state) call (the client.subscribe callback). boardgame.io's
      // client notifies subscribers synchronously on dispatch, so `this.client.moves.commitRoute`
      // immediately invokes a NESTED update(newState) that renders the post-fork state
      // correctly — but then control returns here, and the OUTER (now-stale) update(state)
      // call resumes and keeps rendering with its stale `G`/`ctx` closures (renderTokens,
      // renderPlayerInfo, renderTurnbox, ...), overwriting the correct nested render with the
      // pre-fork one. The ENGINE state is right (awaitingRoute already false — verified via
      // this.client.getState() at the moment of the bug), but the DOM is permanently stuck
      // showing "CHOOSE YOUR ROUTE" with no fork target to click, because nothing ever
      // triggers another render afterward. Deferring the dispatch past the current
      // synchronous render (microtask) means the nested update() fires with NOTHING left to
      // stomp it afterward.
      const route = choices.length ? choices[0].route : [];
      Promise.resolve().then(() => {
        if (this.client) this.client.moves.commitRoute(route);
      });
      return null;
    }
    const t = {};
    choices.forEach(c => {
      const sp = this.boardSpaces[c.node];
      if (sp && sp.placeId) t[sp.placeId] = c.route;
    });
    return t;
  }

  // Light the WALKABLE travel route on the sphere: when the active player has rolled into
  // a genuine fork (awaitingRoute, >1 choice), mark every arc on each reachable branch's
  // full path as 'hot' so it brightens + flows toward the destination; all other arcs stay
  // dim. A place-transition (placeId changes) maps to one directed arc. Cleared otherwise,
  // so the network is quiet until you can actually move. Pure read of route enumeration.
  _globeSetRouteArcs(G, ctx) {
    if (!this._globe || !this._globeData) return;
    const arcs = this._globeData.arcs;
    const hot = new Set();
    const isMyTurn = !this.onlinePlayerID || ctx.currentPlayer === this.onlinePlayerID;
    if (G.awaitingRoute && isMyTurn && G.lastDice) {
      const player = G.players[ctx.currentPlayer];
      const choices = routeChoices(G.board.edges, player.position, G.lastDice.total);
      if (choices.length > 1) {
        choices.forEach(c => {
          // routeChoices() omits the starting tile, so prepend player.position — otherwise
          // the opening hop (current city → first branch city) never lights, and 1-step
          // forks light nothing at all.
          const path = [player.position].concat(c.route);
          for (let i = 0; i < path.length - 1; i++) {
            const a = this.boardSpaces[path[i]], b = this.boardSpaces[path[i + 1]];
            if (a && b && a.placeId && b.placeId && a.placeId !== b.placeId) hot.add(a.placeId + '>' + b.placeId);
          }
        });
      }
    }
    let changed = false;
    arcs.forEach(a => { const h = hot.has(a.fromId + '>' + a.toId); if (h !== a.hot) { a.hot = h; changed = true; } });
    if (changed) this._globe.arcsData(arcs); // re-eval arc accessors (color/stroke/dash)
  }

  // Tween the camera to the active player's city when it changes, so the hidden far
  // side never blocks play. instant=true snaps (first render).
  _globeCameraFollow(G, ctx, instant) {
    if (!this._globe) return;
    const player = G.players[ctx.currentPlayer];
    const sp = player && this.boardSpaces[player.position];
    const pid = sp && sp.placeId;
    const p = (this.mapData.atlasPlaces || []).find(x => x.id === pid);
    if (!p || !p.geo) return;
    if (this._globePovKey === pid && !instant) return;
    this._globePovKey = pid;
    // Preserve the user's current zoom (altitude) when following between turns — only the
    // first render snaps to the default 2.2. Otherwise camera-follow would undo a manual zoom.
    const alt = instant ? 2.2 : (((this._globe.pointOfView() || {}).altitude) || 2.2);
    this._globe.pointOfView({ lat: p.geo.lat, lng: p.geo.lng, altitude: alt }, instant ? 0 : 900);
  }

  // Ensure boardEl has two persistent children: a grid wrapper (rebuilt each
  // render) and #token-layer (created once, never wiped — tokens survive grid
  // rebuilds so they can be repositioned/animated). The grid-wrap uses
  // display:contents so it's transparent to layout and .board__grid still fills .board.
  _ensureBoardChildren() {
    if (!this._gridWrap || this._gridWrap.parentElement !== this.boardEl
        || !this._tokenLayer || this._tokenLayer.parentElement !== this.boardEl) {
      this.boardEl.innerHTML = '<div class="board__grid-wrap"></div><div id="token-layer"></div>';
      this._gridWrap = this.boardEl.querySelector('.board__grid-wrap');
      this._tokenLayer = this.boardEl.querySelector('#token-layer');
    }
  }

  _renderSquareBoard(G, ctx) {
    const gridDims = getGridDimensions(this.mapData.spaceCount, 'square');
    const gridSize = gridDims.rows;
    const lastIdx = gridSize - 1;
    const innerRepeat = gridSize - 2;
    const gridPositions = positionsToGrid(this.mapData.positions, this.mapData.spaceCount);

    this.boardEl.className = 'board';
    this._ensureBoardChildren();
    let tiles = '';
    for (let id = 0; id < this.mapData.spaceCount; id++) {
      const gp = gridPositions[id];
      if (!gp) continue;
      const row = gp.row, col = gp.col;
      let edge = 'corner';
      if (!(this.mapData.cornerIds || []).includes(id)) {
        if (row === lastIdx) edge = 'bottom';
        else if (row === 0) edge = 'top';
        else if (col === 0) edge = 'left';
        else if (col === lastIdx) edge = 'right';
      }
      tiles += this._tileHtml(id, G, { edge, style: `grid-row:${row + 1};grid-column:${col + 1};` });
    }
    const center = `<div class="board__center" style="grid-row:2 / ${gridSize};grid-column:2 / ${gridSize};">${this._centerHtml(G, ctx)}</div>`;
    this._gridWrap.innerHTML = `<div class="board__grid" style="grid-template-columns:1.4fr repeat(${innerRepeat},1fr) 1.4fr;grid-template-rows:1.4fr repeat(${innerRepeat},1fr) 1.4fr;">${tiles}${center}</div>`;
  }

  _renderAbsoluteBoard(G, ctx) {
    const isAtlas = this.mapData.movementMode === 'atlas';
    // board--atlas scopes any atlas-only CSS (e.g. font-size bumps for the bigger
    // tiles below) without touching .tile--abs, which classic-absolute shares.
    this.boardEl.className = isAtlas ? 'board board--atlas' : 'board';
    this._ensureBoardChildren();
    let tiles = '';
    for (let i = 0; i < this.mapData.spaceCount; i++) {
      const pos = this.mapData.positions[i];
      if (!pos) continue;
      // Determine inward-facing edge from position relative to center
      const dx = pos.x - 50, dy = pos.y - 50;
      let edge;
      if ((this.mapData.cornerIds || []).includes(i)) edge = 'corner';
      else if (Math.abs(dy) >= Math.abs(dx)) edge = dy > 0 ? 'bottom' : 'top';
      else edge = dx > 0 ? 'right' : 'left';
      // Atlas boards (fewer, fuller-spread tiles) get bigger tiles than classic
      // absolute layouts (circle/hex/custom, which are denser).
      const size = (this.mapData.cornerIds || []).includes(i)
        ? (isAtlas ? 11 : 9)
        : (isAtlas ? 9.5 : 7.5);
      const style = `left:${pos.x}%;top:${pos.y}%;width:${size}%;height:${size}%;`;
      tiles += this._tileHtml(i, G, { edge, abs: true, style });
    }
    // Atlas frees the center (the dice/buy/pass HUD moves to the side panel —
    // see renderTurnbox), so the board renders only a small logo badge top-center.
    // Classic-absolute (circle/hex/custom) keeps the full inset center box.
    const center = isAtlas
      ? `<div class="board__logo board__logo--badge">
           <span class="board__logo-main">${esc(this.mapData.theme.logoText || 'MEINOPOLY')}</span>
           <span class="board__logo-sub">${esc(this.mapData.theme.logoSubtitle || '')}</span>
         </div>`
      : `<div class="board__center board__center--abs">${this._centerHtml(G, ctx)}</div>`;
    // Atlas: one city label per place, centered on the place's tile cluster and
    // positioned just above its topmost tile (classic-absolute has no placeId).
    let labels = '';
    if (isAtlas) {
      const byPlace = {};
      for (let i = 0; i < this.mapData.spaceCount; i++) {
        const s = this.boardSpaces[i], p = this.mapData.positions[i];
        if (!s || !p || !s.placeId) continue;
        (byPlace[s.placeId] = byPlace[s.placeId] || []).push(p);
      }
      const names = this.mapData.placeNames || {};
      labels = Object.keys(byPlace).map(pid => {
        const ps = byPlace[pid];
        const cx = ps.reduce((a, p) => a + p.x, 0) / ps.length;
        const minY = Math.min.apply(null, ps.map(p => p.y));
        const nm = (names[pid] || pid).toUpperCase();
        return `<div class="place-label" style="left:${cx}%;top:${minY - 5}%">${esc(nm)}</div>`;
      }).join('');
    }
    let edgesSvg = '';
    if (this.mapData.edges) {
      const pos = this.mapData.positions;
      let lines = '';
      this.mapData.edges.forEach((tos, from) => {
        const a = pos[from];
        if (!a || !tos) return;
        tos.forEach(to => {
          const b = pos[to];
          if (!b) return;
          lines += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" marker-end="url(#atlas-arrow)"></line>`;
        });
      });
      edgesSvg = `<svg class="board__edges" viewBox="0 0 100 100" preserveAspectRatio="none">`
        + `<defs><marker id="atlas-arrow" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto">`
        + `<path d="M0,0 L4,2 L0,4 Z" fill="var(--accent)"></path></marker></defs>`
        + lines + `</svg>`;
    }
    // Real-city world map behind the board (atlas worlds with a bundled asset set).
    const worldBg = (isAtlas && this.mapData.atlasAssets) ? this.mapData.atlasAssets.worldBg : null;
    const gridCls = `board__grid board__grid--absolute${worldBg ? ' board__grid--world' : ''}`;
    const gridStyle = worldBg
      ? ` style="background-image:linear-gradient(rgba(8,12,28,.45),rgba(8,12,28,.45)),url('${worldBg}')"`
      : '';
    this._gridWrap.innerHTML = `<div class="${gridCls}"${gridStyle}>${edgesSvg}${tiles}${labels || ''}${center}</div>`;
  }

  // Returns {x, y} as PERCENT of the board element, for positioning overlay tokens.
  // Absolute layouts use the map's percent positions directly; the CSS-grid square
  // layout measures the tile's rect relative to the board (layout must be settled).
  getSpaceCenter(spaceId) {
    if (this.mapData.layoutType !== 'square') {
      const pos = this.mapData.positions[spaceId];
      return pos ? { x: pos.x, y: pos.y } : { x: 50, y: 50 };
    }
    // square/grid: measure the tile rect relative to the board
    const tile = this.boardEl.querySelector(`.tile[data-space="${spaceId}"]`);
    if (!tile) return { x: 50, y: 50 };
    const b = this.boardEl.getBoundingClientRect();
    const t = tile.getBoundingClientRect();
    if (!b.width || !b.height) return { x: 50, y: 50 };
    return {
      x: ((t.left + t.width / 2) - b.left) / b.width * 100,
      y: ((t.top + t.height / 2) - b.top) / b.height * 100,
    };
  }

  // Persistent token overlay: keep one .token node per non-bankrupt player in
  // #token-layer, repositioning (not rebuilding) it each tick via getSpaceCenter.
  // ctx drives the current-turn highlight (token--turn) — cached alongside G
  // (_lastCtx) so the resize-observer/rAF-retry/hopDone re-render paths (which
  // only have a stale G/ctx pair lying around, not fresh call-site args) can
  // still call back in with both.
  renderTokens(G, ctx) {
    if (!this._tokenLayer) return;
    this._lastG = G;
    this._lastCtx = ctx;
    this._ensureTokenResizeObserver();

    const active = G.players.filter(p => !p.bankrupt);
    // group players by tile to offset stacked tokens
    const byTile = {};
    active.forEach(p => { (byTile[p.position] = byTile[p.position] || []).push(p); });

    const liveIds = new Set(active.map(p => String(p.id)));
    // remove token nodes for players no longer active (bankrupt / gone)
    this._tokenLayer.querySelectorAll('.token[data-player]').forEach(el => {
      if (!liveIds.has(el.dataset.player)) el.remove();
    });

    const isSquare = this.mapData.layoutType === 'square';
    const hasTiles = isSquare ? this.boardEl.querySelector('.tile[data-space]') : true;
    let needsRetry = false;

    active.forEach(p => {
      const id = String(p.id);
      let el = this._tokenLayer.querySelector(`.token[data-player="${id}"]`);
      if (!el) {
        el = document.createElement('span');
        el.className = 'token';
        el.dataset.player = id;
        this._tokenLayer.appendChild(el);
      }
      const color = this._playerColor(G, id);
      const label = p.character ? p.character.name[0] : (parseInt(id) + 1);
      // tokenVisual returns RAW pieces (no HTML escaping) — applied here via DOM
      // property assignments only (style.*, classList.toggle, textContent), never
      // innerHTML, so no escaping is needed or wanted.
      const v = tokenVisual(this._clientChar(p.character), color, label);
      el.style.setProperty('--tcol', v.color);
      el.style.backgroundImage = v.portraitUrl ? `url('${v.portraitUrl}')` : '';
      el.classList.toggle('token--face', !!v.portraitUrl);
      el.classList.toggle('token--turn', !!ctx && ctx.currentPlayer === id);
      el.textContent = v.text;
      if (this.animator && this.animator.isAnimating(id)) return; // animator owns placement mid-hop
      const c = this.getSpaceCenter(p.position);
      // measured grid center fell back to {50,50} while tiles exist → layout not settled
      if (isSquare && hasTiles && c.x === 50 && c.y === 50) needsRetry = true;
      // small cluster offset when multiple players share a tile
      const peers = byTile[p.position];
      const idx = peers.indexOf(p);
      const off = (idx - (peers.length - 1) / 2) * 3; // % offset
      el.style.left = (c.x + off) + '%';
      el.style.top = (c.y + off) + '%';
    });

    // retry once on next frame if a square-board measurement was unsettled
    if (needsRetry && !this._tokenRetried) {
      this._tokenRetried = true;
      requestAnimationFrame(() => { this._tokenRetried = false; if (this._lastG) this.renderTokens(this._lastG, this._lastCtx); });
    }
  }

  // Reposition tokens when the board resizes (measured grid centers change).
  _ensureTokenResizeObserver() {
    if (this._tokenResizeObs || typeof ResizeObserver === 'undefined' || !this.boardEl) return;
    this._tokenResizeObs = new ResizeObserver(() => {
      if (this._lastG) this.renderTokens(this._lastG, this._lastCtx);
    });
    this._tokenResizeObs.observe(this.boardEl);
  }

  // ─────────────────────────────────────────────────────────
  // Top chip strip — one compact chip per player (game-chrome.js chipHtml).
  // Full detail (title/passive/abilities/propchips/status badges) moves to
  // the click-to-open popover (chipDetailHtml) — see the delegated listener
  // wired on #player-info in createLayout.
  // ─────────────────────────────────────────────────────────
  renderPlayerInfo(G, ctx) {
    let html = '';
    this._chipDetail = []; // popover cache, rebuilt every render (see click listener in createLayout)
    G.players.forEach((player, i) => {
      const isCurrent = ctx.currentPlayer === String(i);
      const char = player.character;
      const cchar = this._clientChar(char); // portrait-bearing client character (see _clientChar doc comment)
      const color = this._playerColor(G, i);
      const name = char ? char.name : `Player ${i + 1}`;

      const isOphelia = char && char.passive.id === 'shadow';
      const hideMoney = isOphelia && !isCurrent;
      const moneyHtml = money(hideMoney ? null : player.money, hideMoney);

      const props = player.properties.map(pid => {
        const sp = this.boardSpaces[pid];
        const lvl = G.buildings[pid] || 0;
        const mort = G.mortgaged[pid] || false;
        return `<span class="propchip ${mort ? 'propchip--mortgaged' : ''}" style="border-left-color:${sp.color || 'var(--line)'}">${esc(sp.name)}${lvl > 0 ? ' ·' + lvl : ''}</span>`;
      }).join('');

      let abilities = [];
      if (char) {
        if (player.rerollsLeft > 0) abilities.push(`REROLL ${player.rerollsLeft}`);
        if (player.luckRedraws > 0) abilities.push(`REDRAW ${player.luckRedraws}`);
        if (player.regulatedProperty !== null && player.regulatedProperty !== undefined) abilities.push(`REG: ${this.boardSpaces[player.regulatedProperty].name}`);
      }

      html += chipHtml({
        idx: i, name, color,
        portraitUrl: cchar ? cchar.portrait : null,
        money: moneyHtml, hideMoney,
        isCurrent, isBankrupt: !!player.bankrupt,
        deeds: player.properties.length,
        inJail: !!player.inJail,
      });

      this._chipDetail[i] = {
        name, title: char ? char.title : '', color,
        portraitUrl: cchar ? cchar.portrait : null,
        moneyHtml, deeds: player.properties.length,
        passiveName: char ? char.passive.name : '',
        passiveDesc: char ? char.passive.description : '',
        abilities, propsHtml: props,
        inJail: !!player.inJail, isBankrupt: !!player.bankrupt, isCurrent,
      };
    });
    this.playerInfoEl.innerHTML = html;
  }

  // ─────────────────────────────────────────────────────────
  // Right column — turn box
  // ─────────────────────────────────────────────────────────
  renderTurnbox(G, ctx) {
    const player = G.players[ctx.currentPlayer];
    const char = player.character;
    const color = this._playerColor(G, ctx.currentPlayer);
    const name = char ? char.name : `Player ${parseInt(ctx.currentPlayer) + 1}`;
    const isMyTurn = !this.onlinePlayerID || ctx.currentPlayer === this.onlinePlayerID;

    // Horizontal action bar (layout-rebuild Task 4): who-chip carries a real
    // portrait when available. tokenVisual returns RAW pieces (no escaping —
    // see its doc comment); this is an HTML-STRING consumer (unlike the
    // DOM-property consumers in renderTokens/_updateGlobeOverlay), so every
    // piece is esc()'d here before landing in the template. Portraits only
    // ever come from the CLIENT character bundle (_clientChar) — G.character
    // has no portrait field (see _clientChar doc comment).
    const whoVisual = tokenVisual(this._clientChar(char), color, char ? char.name[0] : parseInt(ctx.currentPlayer) + 1);
    const whoFace = whoVisual.portraitUrl
      ? `<img class="turnbox__face" src="${esc(whoVisual.portraitUrl)}" alt="" />`
      : `<span class="turnbox__face turnbox__face--letter" style="--tcol:${esc(whoVisual.color)}">${esc(whoVisual.text)}</span>`;
    let html = `<div class="turnbox turnbox--bar"><div class="turnbox__who">${whoFace} <span style="color:${color}">${esc(name)}</span></div>`;

    // Duel response (Task 9) is a special case of the isMyTurn gate just below:
    // its actor is the duel OWNER, not ctx.currentPlayer (the challenger, whose
    // turn it still nominally is). On atlas maps the buy/pass-equivalent prompt
    // (_centerSlotHtml) only ever reaches the DOM via this turnbox slot (see the
    // isAtlas branch below), so the plain `!isMyTurn` early-return would hide the
    // FIGHT/DECLINE hand-off from the owner's client entirely online. Detour
    // through _centerSlotHtml here first — it does its own owner-vs-everyone-else
    // check (waiting line for non-owners, hot-seat always shows buttons). Classic
    // (non-atlas) maps don't need this: their board-center _centerHtml already
    // renders unconditionally for every client (see _renderSquareBoard).
    const isAtlas = this.mapData.movementMode === 'atlas';
    const isDuelResponse = G.turnPhase === 'duel' && G.duel && G.duel.phase === 'response';
    if (isAtlas && isDuelResponse) {
      html += `<div class="turnbox__slot">${this._centerSlotHtml(G, ctx)}</div></div>`;
      this.turnboxEl.innerHTML = html;
      return;
    }

    if (!isMyTurn) {
      html += `<div class="turnbox__waiting">WAITING FOR<br/>${esc(name)}…</div></div>`;
      this.turnboxEl.innerHTML = html;
      return;
    }

    // Atlas frees the board center: surface the dice + buy/pass prompt (the
    // _centerSlotHtml content) here in the side panel. #btn-buy/#btn-pass are
    // wired by id in wireActions, so no rewiring is needed. Classic keeps the
    // prompt in the board center (isAtlas false → turnbox unchanged).
    if (isAtlas) {
      html += `<div class="turnbox__slot">${this._centerSlotHtml(G, ctx)}</div>`;
    }

    // Jail / roll. pix-btn--full (width:100%) dropped here (layout-rebuild Task
    // 4): as a direct flex item of .turnbox--bar, a 100%-width button forces
    // its own full line, defeating the horizontal bar's compactness — the
    // #btn-roll/#btn-jail ids and every other pix-btn modifier are unchanged,
    // only the width:100% modifier is removed (no E2E asserts this class —
    // grepped tests/e2e before removing).
    if (player.inJail && !G.hasRolled) {
      html += `<button class="pix-btn pix-btn--primary pix-btn--lg" id="btn-roll">ROLL FOR DOUBLES</button>`;
      html += `<button class="pix-btn pix-btn--default" id="btn-jail">PAY $${RULES.core.jailFine} FINE</button>`;
    } else if (!G.hasRolled && G.turnPhase === 'roll') {
      html += `<button class="pix-btn pix-btn--primary pix-btn--lg" id="btn-roll">ROLL DICE</button>`;
    }

    // Card accept/redraw (also surfaced in modal; keep buttons here as fallback)
    if (G.pendingCard) {
      html += `<div class="turnbox__btnrow"><button class="pix-btn pix-btn--success" id="btn-accept-card">ACCEPT</button><button class="pix-btn pix-btn--default" id="btn-redraw-card">REDRAW</button></div>`;
    }

    // Reroll
    if (G.hasRolled && player.rerollsLeft > 0 && !G.canBuy && !G.pendingCard && G.turnPhase === 'done') {
      html += `<button class="pix-btn pix-btn--default" id="btn-reroll">REROLL (${player.rerollsLeft})</button>`;
    }

    // Duel resolution result strip (review fix — see _duelResultStripHtml doc
    // comment). Placed here, above the end-turn controls, so ONE insertion
    // point covers both render paths that reach this shared "done"-phase code:
    // classic maps (turnbox has never rendered dice — this is the first time a
    // duel result appears there) and atlas maps (turnbox already shows the
    // done-phase _centerSlotHtml hint further up via the `isAtlas` block; this
    // adds the missing per-die breakdown alongside it). Both paths fall through
    // to this exact code after the isDuelResponse/!isMyTurn early-returns above,
    // so no atlas-specific branch is needed — traced during this fix, not
    // assumed.
    if (G.turnPhase === 'done') html += this._duelResultStripHtml(G);

    // Trade + end turn
    const canTrade = RULES.trading.enabled && G.hasRolled && !G.canBuy && !G.pendingCard && !G.trade && !G.auction && G.turnPhase === 'done'
      && G.players.filter(p => p.id !== ctx.currentPlayer && !p.bankrupt).length > 0 && player.properties.length > 0;
    const canEnd = G.hasRolled && !G.canBuy && !G.pendingCard && !G.trade && !G.auction && G.turnPhase === 'done';
    html += `<div class="turnbox__btnrow">`;
    if (canTrade) html += `<button class="pix-btn pix-btn--default" id="btn-propose-trade">TRADE</button>`;
    html += `<button class="pix-btn pix-btn--primary" id="btn-end" ${canEnd ? '' : 'disabled'}>END TURN &#9656;</button>`;
    html += `</div>`;

    html += `</div>`;
    this.turnboxEl.innerHTML = html;
  }

  // Property management list
  renderManage(G, ctx) {
    const player = G.players[ctx.currentPlayer];
    const isMyTurn = !this.onlinePlayerID || ctx.currentPlayer === this.onlinePlayerID;
    if (!isMyTurn || !G.hasRolled || G.canBuy || G.pendingCard || player.properties.length === 0) {
      this.manageEl.innerHTML = '';
      return;
    }

    let rows = '';
    player.properties.forEach(pid => {
      const space = this.boardSpaces[pid];
      const gk = groupKeyOf(space);
      const level = G.buildings[pid] || 0;
      const mortgaged = G.mortgaged[pid] || false;
      let actions = '';

      if (mortgaged) {
        const cost = Math.floor(space.price * RULES.core.unmortgageRate);
        actions += `<button class="pix-btn pix-btn--default pix-btn--sm btn-unmortgage" data-pid="${pid}">UNMORT $${cost}</button>`;
      } else {
        if (space.type === 'property' && gk && this.colorGroups[gk]) {
          const groupIds = this.colorGroups[gk];
          const ownsGroup = groupIds.every(id => G.ownership[id] === ctx.currentPlayer);
          const minLevel = Math.min(...groupIds.map(id => G.buildings[id] || 0));
          const noMortgaged = !groupIds.some(id => G.mortgaged[id]);
          if (ownsGroup && level <= minLevel && level < RULES.core.maxBuildingLevel && noMortgaged) {
            const upgCost = Math.floor(space.price * UPGRADE_COST_MULTIPLIERS[level]);
            actions += `<button class="pix-btn pix-btn--success pix-btn--sm btn-upgrade" data-pid="${pid}" title="~$${upgCost}">+${esc(BUILDING_NAMES[level + 1])}</button>`;
          }
        }
        if (level > 0) {
          let canSell = true;
          if (gk && this.colorGroups[gk]) {
            const maxLevel = Math.max(...this.colorGroups[gk].map(id => G.buildings[id] || 0));
            if (level < maxLevel) canSell = false;
          }
          if (canSell) actions += `<button class="pix-btn pix-btn--default pix-btn--sm btn-sell" data-pid="${pid}">SELL</button>`;
        }
        let canMortgage = true;
        if (gk && this.colorGroups[gk]) {
          canMortgage = !this.colorGroups[gk].some(id => (G.buildings[id] || 0) > 0);
        }
        if (canMortgage && level === 0) {
          const val = Math.floor(space.price * RULES.core.mortgageRate);
          actions += `<button class="pix-btn pix-btn--default pix-btn--sm btn-mortgage" data-pid="${pid}">MORT $${val}</button>`;
        }
      }

      rows += `<div class="manage__row"><span class="manage__name" style="border-left-color:${space.color || 'var(--line)'}">${esc(space.name)}${level > 0 ? ' ·' + level : ''}${mortgaged ? ' (M)' : ''}</span><span class="manage__actions">${actions}</span></div>`;
    });

    this.manageEl.innerHTML = `<div class="pix-panel"><div class="pix-panel__titlebar"><span class="pix-panel__title">MANAGE</span></div><div class="pix-panel__body manage">${rows}</div></div>`;
  }

  renderMessages(G) {
    const lines = G.messages.map(m => {
      const lo = m.toLowerCase();
      let kind = 'neutral';
      if (/(collect|bought|wins|received|\+\$|salary|dividend|matures|inherit|refund)/.test(lo)) kind = 'good';
      else if (/(pay|paid|rent|tax|fine|bankrupt|jail|lost|-\$)/.test(lo)) kind = 'bad';
      return `<div class="logline logline--${kind}">${esc(m)}</div>`;
    }).reverse().join('');
    this.messagesEl.innerHTML = `<div class="logbox"><div class="logbox__title">EVENT LOG</div><div class="logbox__list">${lines}</div></div>`;
  }

  // ─────────────────────────────────────────────────────────
  // Wire all action handlers (buttons live across center/turnbox/manage)
  // ─────────────────────────────────────────────────────────
  // Cosmetic dice roll: tumble random faces (shake+rotate via .die--rolling), easing
  // out, THEN dispatch the real move so the dice visibly "land" on the result. The
  // engine roll is unchanged; works on every map (all render via .centerslot__dice).
  _animateRollThenMove() {
    if (this._rolling) return; // ignore re-clicks mid-roll
    const wrap = this.rootElement.querySelector('.centerslot__dice');
    const fire = () => {
      this._rollTimer = null;
      // NOTE: _rolling is intentionally NOT cleared here — it's released in update()
      // once the post-roll state actually arrives. In online/laggy play the dispatch
      // round-trips, and clearing the lock now would let a second click double-roll
      // while #btn-roll is still on screen.
      // The move was deferred ~0.9s; if the player exited to menu or loaded a save
      // during the animation the client is gone/replaced — abort rather than dispatch
      // against a null or wrong client (and release the lock so it isn't stuck).
      if (!this.client) { this._rolling = false; return; }
      if (this.mapData.movementMode === 'atlas') this.client.moves.rollOnly();
      else this.client.moves.rollDice();
    };
    // E2E fast path: skip the ~0.9s tumble so long game tests stay fast + deterministic
    // (the animation is visual-only; real play keeps it). Flag set via Playwright addInitScript.
    if (typeof window !== 'undefined' && window.__MP_FAST_ROLL) { fire(); return; }
    if (!wrap) { fire(); return; } // no dice DOM → just roll
    this._rolling = true;
    const rnd = () => 1 + Math.floor(Math.random() * 6);
    const steps = [55, 60, 70, 85, 105, 130, 160, 200]; // ease-out: fast tumble, slows before landing (~0.9s)
    let i = 0;
    const tick = () => {
      wrap.innerHTML = dieHtml(rnd(), true) + dieHtml(rnd(), true);
      if (i < steps.length) { this._rollTimer = setTimeout(tick, steps[i++]); }
      else { fire(); } // update() re-renders with the real G.lastDice → the dice "land"
    };
    tick();
  }

  // Abort a dice animation in flight (player exited / loaded a game mid-roll) so the
  // deferred move never fires against a dead or replaced client.
  _cancelRoll() {
    if (this._rollTimer) { clearTimeout(this._rollTimer); this._rollTimer = null; }
    this._rolling = false;
  }

  wireActions(G, ctx) {
    const click = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
    click('btn-roll', () => this._animateRollThenMove());
    click('btn-buy', () => this.client.moves.buyProperty());
    click('btn-pass', () => this.client.moves.passProperty());
    click('btn-payrent', () => this.client.moves.payRent());
    click('btn-duel', () => this.client.moves.initiateDuel());
    click('btn-fight', () => this.client.moves.respondDuel());
    click('btn-decline', () => this.client.moves.declineDuel());
    click('btn-end', () => this.client.moves.endTurn());
    click('btn-jail', () => this.client.moves.payJailFine());
    click('btn-reroll', () => this.client.moves.useReroll());
    click('btn-accept-card', () => this.client.moves.acceptCard());
    click('btn-redraw-card', () => this.client.moves.redrawCard());
    click('btn-propose-trade', () => this.showTradeModal(G, ctx));
    click('btn-save', () => this.saveGame(G, ctx));
    if (this.saveBtnEl) this.saveBtnEl.onclick = () => this.saveGame(G, ctx);

    document.querySelectorAll('.btn-upgrade').forEach(b => b.onclick = () => this.client.moves.upgradeProperty(parseInt(b.dataset.pid)));
    document.querySelectorAll('.btn-mortgage').forEach(b => b.onclick = () => this.client.moves.mortgageProperty(parseInt(b.dataset.pid)));
    document.querySelectorAll('.btn-unmortgage').forEach(b => b.onclick = () => this.client.moves.unmortgageProperty(parseInt(b.dataset.pid)));
    document.querySelectorAll('.btn-sell').forEach(b => b.onclick = () => this.client.moves.sellBuilding(parseInt(b.dataset.pid)));
  }

  // ─────────────────────────────────────────────────────────
  // State-driven modal: event card / auction / trade accept
  // ─────────────────────────────────────────────────────────
  renderStateModal(G, ctx) {
    const isMyTurn = !this.onlinePlayerID || ctx.currentPlayer === this.onlinePlayerID;

    if (G.pendingCard) {
      const card = G.pendingCard.card;
      const deck = G.pendingCard.deck;
      const kind = cardKind(card.action);
      const player = G.players[ctx.currentPlayer];
      const canRedraw = (player.rerollsLeft >= 0); // redraw availability handled by engine; show both
      this.stateModalBoxEl.innerHTML = `
        <div class="evcard evcard--${kind}">
          <div class="evcard__deck">${deck === 'chance' ? 'CHANCE' : 'COMMUNITY CHEST'}</div>
          <div class="evcard__glyph">${glyphHtml(deck === 'chance' ? 'q' : 'chest')}</div>
          <div class="evcard__text">${esc(card.text)}</div>
          <div class="evcard__tag evcard__tag--${kind}">${kind === 'good' ? 'FORTUNE' : kind === 'bad' ? 'HAZARD' : 'EVENT'}</div>
          <div class="evcard__btns">
            <button class="pix-btn pix-btn--primary" id="ev-accept">ACCEPT</button>
            <button class="pix-btn pix-btn--default" id="ev-redraw">REDRAW</button>
          </div>
        </div>`;
      this.stateModalEl.classList.add('open');
      document.getElementById('ev-accept').onclick = () => this.client.moves.acceptCard();
      document.getElementById('ev-redraw').onclick = () => this.client.moves.redrawCard();
      return;
    }

    if (G.auction && G.turnPhase === 'auction') {
      const a = G.auction;
      const space = this.boardSpaces[a.propertyId];
      const currentBidder = a.bidders[a.currentBidderIndex];
      const minBid = a.currentBid === 0 ? RULES.auction.startingBid : a.currentBid + RULES.auction.minimumIncrement;
      const leaderId = a.currentBidder;
      const biddersHtml = a.bidders.map(b => {
        const p = G.players[b.playerId];
        const nm = p.character ? p.character.name : `Player ${parseInt(b.playerId) + 1}`;
        const isLead = leaderId !== null && String(leaderId) === String(b.playerId);
        const state = b.passed ? 'PASS' : (isLead ? 'LEADS' : 'IN');
        return `<div class="auction__bidder ${b.passed ? 'out' : ''} ${isLead ? 'lead' : ''}">${tokenHtml(this._playerColor(G, b.playerId), p.character ? p.character.name[0] : parseInt(b.playerId) + 1, true)}<span>${esc(nm)}</span><span class="auction__bstate">${state}</span></div>`;
      }).join('');
      const curName = G.players[currentBidder.playerId].character ? G.players[currentBidder.playerId].character.name : `Player ${parseInt(currentBidder.playerId) + 1}`;
      this.stateModalBoxEl.innerHTML = `
        <div class="auction">
          <div class="auction__head">AUCTION</div>
          <div class="auction__lot">
            <span class="auction__bar" style="background:${space.color || 'var(--accent)'}"></span>
            <div class="auction__lotname">${esc(space.name)}</div>
            <div class="auction__listed">Listed $${space.price}</div>
          </div>
          <div class="auction__bidbox">
            <span class="auction__bidlabel">CURRENT BID</span>
            <span class="auction__bidval">$${a.currentBid || 0}</span>
            <span class="auction__leader">TO BID: ${esc(curName)}</span>
          </div>
          <div class="auction__bidders">${biddersHtml}</div>
          <div class="auction__bidctl"><input type="number" id="bid-amount" min="${minBid}" value="${minBid}" step="${RULES.auction.minimumIncrement}" /></div>
          <div class="auction__actions">
            <button class="pix-btn pix-btn--ghost" id="btn-pass-auction">PASS</button>
            <button class="pix-btn pix-btn--primary" id="btn-bid">BID</button>
          </div>
        </div>`;
      this.stateModalEl.classList.add('open');
      document.getElementById('btn-bid').onclick = () => {
        const amount = parseInt(document.getElementById('bid-amount').value);
        if (!isNaN(amount)) this.client.moves.placeBid(amount);
      };
      document.getElementById('btn-pass-auction').onclick = () => this.client.moves.passAuction();
      return;
    }

    if (G.trade && G.turnPhase === 'trade') {
      const t = G.trade;
      const proposer = G.players[t.proposerId];
      const target = G.players[t.targetPlayerId];
      const pName = proposer.character ? proposer.character.name : `Player ${parseInt(t.proposerId) + 1}`;
      const tName = target.character ? target.character.name : `Player ${parseInt(t.targetPlayerId) + 1}`;
      const propList = (ids, mny) => {
        let h = ids.map(pid => `<div class="trade__prop"><span class="trade__propbar" style="background:${this.boardSpaces[pid].color || 'var(--ink-dim)'}"></span><span class="trade__propname">${esc(this.boardSpaces[pid].name)}</span></div>`).join('');
        if (mny > 0) h += `<div class="trade__prop"><span class="trade__propname">${money(mny)}</span></div>`;
        return h || '<div class="trade__empty">Nothing</div>';
      };
      this.stateModalBoxEl.innerHTML = `
        <div class="trade">
          <div class="trade__head">TRADE PROPOSAL</div>
          <div class="trade__cols">
            <div class="trade__side">
              <div class="trade__sidehead">${tokenHtml(this._playerColor(G, t.proposerId), proposer.character ? proposer.character.name[0] : parseInt(t.proposerId) + 1, true)}<span style="color:${this._playerColor(G, t.proposerId)}">${esc(pName)}</span></div>
              <div class="trade__proplist">${propList(t.offeredProperties, t.offeredMoney)}</div>
            </div>
            <div class="trade__swap">${glyphHtml('swap')}</div>
            <div class="trade__side">
              <div class="trade__sidehead">${tokenHtml(this._playerColor(G, t.targetPlayerId), target.character ? target.character.name[0] : parseInt(t.targetPlayerId) + 1, true)}<span style="color:${this._playerColor(G, t.targetPlayerId)}">${esc(tName)}</span></div>
              <div class="trade__proplist">${propList(t.requestedProperties, t.requestedMoney)}</div>
            </div>
          </div>
          <div class="trade__actions">
            <button class="pix-btn pix-btn--ghost" id="btn-cancel-trade">CANCEL</button>
            <button class="pix-btn pix-btn--danger" id="btn-reject-trade">REJECT</button>
            <button class="pix-btn pix-btn--success" id="btn-accept-trade">ACCEPT</button>
          </div>
        </div>`;
      this.stateModalEl.classList.add('open');
      document.getElementById('btn-accept-trade').onclick = () => this.client.moves.acceptTrade();
      document.getElementById('btn-reject-trade').onclick = () => this.client.moves.rejectTrade();
      document.getElementById('btn-cancel-trade').onclick = () => this.client.moves.cancelTrade();
      return;
    }

    this.stateModalEl.classList.remove('open');
    this.stateModalBoxEl.innerHTML = '';
  }

  // ─────────────────────────────────────────────────────────
  // Results
  // ─────────────────────────────────────────────────────────
  renderResults(G, ctx) {
    // Prefer the engine's computed standings (mortgage-corrected net worth + tie-break).
    let standings = ctx.gameover.standings;
    if (!standings) {
      standings = G.players.filter(p => !p.bankrupt).map(p => ({ id: p.id, score: p.money, props: p.properties.length, groups: 0 }));
    }
    const winnerId = String(ctx.gameover.winner);
    const winnerEntry = standings.find(s => String(s.id) === winnerId) || standings[0];
    const wIdx = parseInt(winnerEntry.id);
    const wChar = G.players[wIdx].character;
    const wName = wChar ? wChar.name : `Player ${wIdx + 1}`;
    const wColor = this._playerColor(G, wIdx);

    let reason;
    if (ctx.gameover.reason === 'dominion') reason = `${wName} controls ${winnerEntry.groups} color groups.`;
    else if (ctx.gameover.reason === 'maxTurns') reason = `Turn limit reached — richest wins.`;
    else if (ctx.gameover.reason === 'survival') reason = `${wName} is the last one standing.`;
    else reason = `${wName} controls the Council.`;

    const rows = standings.map((s, idx) => {
      const i = parseInt(s.id);
      const ch = G.players[i].character;
      const nm = ch ? ch.name : `Player ${i + 1}`;
      const col = this._playerColor(G, i);
      return `<div class="standrow">
        <span class="standrow__rank">${idx + 1}</span>
        ${tokenHtml(col, ch ? ch.name[0] : i + 1, true)}
        <span class="standrow__name" style="color:${col}">${esc(nm)}</span>
        <span class="standrow__props">${s.props} PROPS</span>
        <span class="standrow__net">${money(s.score)}</span>
      </div>`;
    }).join('');

    this.resultsEl.className = 'screen screen--results';
    this.resultsEl.innerHTML = `
      <div class="results__crown">${glyphHtml('crown')}</div>
      <div class="results__victory">VICTORY</div>
      ${portraitHtml(wChar, 120, true)}
      <div class="results__winner" style="color:${wColor}">${esc(wName)}</div>
      <div class="results__sub">${esc(reason)}</div>
      <div class="pix-panel results__table">
        <div class="pix-panel__titlebar"><span class="pix-panel__title">FINAL STANDINGS</span></div>
        <div class="pix-panel__body">${rows}</div>
      </div>
      <button class="pix-btn pix-btn--primary pix-btn--lg" id="btn-replay">PLAY AGAIN</button>
    `;
    document.getElementById('btn-replay').onclick = () => this.exitToMenu();
  }

  // ─────────────────────────────────────────────────────────
  // UI modals (lore / trade builder / AI settings / saves)
  // ─────────────────────────────────────────────────────────
  openUiModal(html, wide) {
    this.uiModalBoxEl.className = `modal ${wide ? 'modal--wide' : ''}`;
    this.uiModalBoxEl.innerHTML = html;
    this.uiModalEl.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  closeUiModal() {
    this.uiModalEl.classList.remove('open');
    this.uiModalBoxEl.innerHTML = '';
    document.body.style.overflow = '';
  }

  showLoreModal(charId) {
    const char = this.activeMod.characters.find(c => c.id === charId);
    const lore = this.activeMod.getLoreById(charId);
    if (!char || !lore) return;
    const sections = `
      <div class="lore__sectlabel">背景故事</div>
      <div class="lore__body">${renderLoreText(lore.background)}</div>
      ${lore.noticed ? `<div class="lore__sectlabel">被议会注意到的原因</div><div class="lore__body">${renderLoreText(lore.noticed)}</div>` : ''}
      <div class="lore__sectlabel">加入维度议会</div>
      <div class="lore__body">${renderLoreText(lore.joining)}</div>
      <div class="lore__sectlabel">行事风格</div>
      <div class="lore__body">${lore.styleIntro ? renderLoreText(lore.styleIntro) : ''}<ol>${lore.style.map(s => `<li>${s.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</li>`).join('')}</ol>${lore.styleOutro ? renderLoreText(lore.styleOutro) : ''}</div>
      <div class="lore__sectlabel">与其他代理人的关系</div>
      <div class="lore__body"><ul>${lore.relationships.map(r => `<li><strong>${esc(r.target)}</strong>：${esc(r.description)}</li>`).join('')}</ul></div>
      <div class="lore__body"><blockquote>${lore.themeSummary.replace(/\n/g, '<br/>')}</blockquote></div>
    `;
    const startMoney = RULES.core.baseStartingMoney + char.stats.capital * RULES.stats.capital.startingMoneyBonus;
    this.openUiModal(`
      <div class="lore">
        <div class="lore__left">
          ${portraitHtml(char, 150, true)}
          <div class="lore__name" style="color:${readableNameColor(char.color)}">${esc(lore.nameZh)}<br/>${esc(char.name)}</div>
          <div class="lore__title">${esc(lore.titleZh)}</div>
          <div class="lore__stats">${statRowsHtml(char.stats, char.color)}</div>
        </div>
        <div class="lore__right">
          <div class="lore__sectlabel">PASSIVE · ${esc(char.passive.name)}</div>
          <div class="lore__passive">${esc(char.passive.description)}</div>
          <div class="lore__sectlabel">STARTING CAPITAL</div>
          <div class="lore__money">${money(startMoney)}</div>
          ${sections}
          <div class="lore__close"><button class="pix-btn pix-btn--primary" id="btn-lore-close">CLOSE</button></div>
        </div>
      </div>`, true);
    document.getElementById('btn-lore-close').onclick = () => this.closeUiModal();
  }

  showAISettings() {
    const connected = !!this.characterAI.apiKey;
    this.openUiModal(`
      <div class="aiset">
        <div class="aiset__head">AI CHARACTER SETTINGS</div>
        <div class="aiset__status ${connected ? 'on' : 'off'}">${connected ? 'CONNECTED' : 'NO API KEY'}</div>
        <div class="aiset__field">
          <span class="aiset__label">OpenAI API Key</span>
          <input type="password" id="ai-key-input" placeholder="sk-..." value="${esc(this.characterAI.apiKey)}" />
          <span class="aiset__hint">Stored locally in your browser. Sent only to OpenAI.</span>
        </div>
        <div class="aiset__field">
          <span class="aiset__label">Response Verbosity</span>
          <select id="ai-verbosity-select">
            <option value="off">Off (no AI responses)</option>
            <option value="major">Major events only (recommended)</option>
            <option value="all">All events</option>
          </select>
          <span class="aiset__hint">How often characters comment on game events.</span>
        </div>
        <div class="aiset__actions">
          <button class="pix-btn pix-btn--ghost" id="btn-ai-cancel">CANCEL</button>
          <button class="pix-btn pix-btn--primary" id="btn-ai-save">SAVE</button>
        </div>
      </div>`);
    document.getElementById('ai-verbosity-select').value = this.characterAI.verbosity;
    document.getElementById('btn-ai-cancel').onclick = () => this.closeUiModal();
    document.getElementById('btn-ai-save').onclick = () => {
      const key = document.getElementById('ai-key-input').value.trim();
      const verbosity = document.getElementById('ai-verbosity-select').value;
      this.characterAI.setApiKey(key);
      this.characterAI.setVerbosity(verbosity);
      localStorage.setItem('meinopoly_ai_key', key);
      localStorage.setItem('meinopoly_ai_verbosity', verbosity);
      this.closeUiModal();
    };
  }

  showSavesModal() {
    const saves = MonopolyBoard.getSaves();
    const entries = Object.entries(saves).sort((a, b) => b[1].timestamp - a[1].timestamp);
    let body;
    if (entries.length === 0) {
      body = '<div class="saves__empty">No saved games. Save during play to see them here.</div>';
    } else {
      body = entries.map(([name, data]) => {
        const date = new Date(data.timestamp).toLocaleString();
        return `<div class="saves__row">
          <div><div class="saves__name">${esc(name.replace('meinopoly_save_', ''))}</div><div class="saves__meta">${data.numPlayers} players · Turn ${data.G.totalTurns} · ${esc(date)}</div></div>
          <div class="saves__actions"><button class="pix-btn pix-btn--success pix-btn--sm btn-load-save" data-save="${esc(name)}">LOAD</button><button class="pix-btn pix-btn--danger pix-btn--sm btn-delete-save" data-save="${esc(name)}">DEL</button></div>
        </div>`;
      }).join('');
    }
    this.openUiModal(`<div class="saves"><div class="saves__head">SAVED GAMES</div>${body}<div class="aiset__actions"><button class="pix-btn pix-btn--ghost" id="btn-saves-close">CLOSE</button></div></div>`);
    document.getElementById('btn-saves-close').onclick = () => this.closeUiModal();
    this.uiModalBoxEl.querySelectorAll('.btn-load-save').forEach(btn => {
      btn.onclick = () => {
        const data = MonopolyBoard.getSaves()[btn.dataset.save];
        if (data) { this.loadGame(data); this.closeUiModal(); }
      };
    });
    this.uiModalBoxEl.querySelectorAll('.btn-delete-save').forEach(btn => {
      btn.onclick = () => { MonopolyBoard.deleteSave(btn.dataset.save); this.showSavesModal(); };
    });
  }

  // Trade builder modal
  showTradeModal(G, ctx) {
    const player = G.players[ctx.currentPlayer];
    const opponents = G.players.filter(p => p.id !== ctx.currentPlayer && !p.bankrupt);
    if (opponents.length === 0) return;
    this._tradeState = { G, ctx, player, opponents, selectedIndex: 0, myPicks: [], oppPicks: [], myCash: 0, oppCash: 0 };
    this._renderTradeBuilder();
  }

  _renderTradeBuilder() {
    const s = this._tradeState;
    const { G, ctx, player, opponents, selectedIndex } = s;
    const target = opponents[selectedIndex];
    const tradeable = (pl) => pl.properties
      .filter(pid => (G.buildings[pid] || 0) === 0 && (!G.mortgaged[pid] || RULES.trading.allowMortgagedProperties))
      .map(pid => this.boardSpaces[pid]);
    const myProps = tradeable(player);
    const targetProps = tradeable(target);
    const pName = player.character ? player.character.name : `Player ${parseInt(ctx.currentPlayer) + 1}`;
    const tName = target.character ? target.character.name : `Player ${parseInt(target.id) + 1}`;
    const pColor = this._playerColor(G, ctx.currentPlayer);
    const tColor = this._playerColor(G, target.id);

    const sideHtml = (props, picks, who) => {
      if (props.length === 0) return '<div class="trade__empty">No deeds to offer</div>';
      return props.map(sp => `<button class="trade__prop ${picks.includes(sp.id) ? 'on' : ''}" data-side="${who}" data-pid="${sp.id}"><span class="trade__propbar" style="background:${sp.color || 'var(--ink-dim)'}"></span><span class="trade__propname">${esc(sp.name)}</span><span class="trade__propprice">$${sp.price}</span></button>`).join('');
    };
    const cashHtml = (who, val) => RULES.trading.allowMoneyInTrade
      ? `<div class="trade__cash"><span>CASH</span><div class="trade__cashctl"><button data-cash="${who}" data-d="-50">−</button><span class="trade__cashval">$${val}</span><button data-cash="${who}" data-d="50">+</button></div></div>`
      : '';

    const fair = s.myPicks.length + s.myCash / 100 - s.oppPicks.length - s.oppCash / 100;
    const balCls = fair > 0.5 ? 'pos' : fair < -0.5 ? 'neg' : 'even';
    const balTxt = fair > 0.5 ? 'IN YOUR FAVOUR' : fair < -0.5 ? 'FAVOURS RIVAL' : 'ROUGHLY EVEN';

    const targetSelector = opponents.length > 1
      ? `<div class="trade__target">TRADE WITH <select id="trade-target-select">${opponents.map((o, i) => `<option value="${i}" ${i === selectedIndex ? 'selected' : ''}>${esc(o.character ? o.character.name : 'Player ' + (parseInt(o.id) + 1))}</option>`).join('')}</select></div>`
      : '';

    this.openUiModal(`
      <div class="trade">
        <div class="trade__head">PROPOSE TRADE</div>
        ${targetSelector}
        <div class="trade__cols">
          <div class="trade__side">
            <div class="trade__sidehead">${tokenHtml(pColor, player.character ? player.character.name[0] : parseInt(ctx.currentPlayer) + 1, true)}<span style="color:${pColor}">${esc(pName)}</span></div>
            <div class="trade__proplist">${sideHtml(myProps, s.myPicks, 'my')}</div>
            ${cashHtml('my', s.myCash)}
          </div>
          <div class="trade__swap">${glyphHtml('swap')}</div>
          <div class="trade__side">
            <div class="trade__sidehead">${tokenHtml(tColor, target.character ? target.character.name[0] : parseInt(target.id) + 1, true)}<span style="color:${tColor}">${esc(tName)}</span></div>
            <div class="trade__proplist">${sideHtml(targetProps, s.oppPicks, 'opp')}</div>
            ${cashHtml('opp', s.oppCash)}
          </div>
        </div>
        <div class="trade__bal"><span>BALANCE</span><span class="trade__balval ${balCls}">${balTxt}</span></div>
        <div class="trade__actions">
          <button class="pix-btn pix-btn--ghost" id="btn-trade-cancel">CANCEL</button>
          <button class="pix-btn pix-btn--primary" id="btn-trade-send">PROPOSE &#9656;</button>
        </div>
      </div>`, true);

    const sel = document.getElementById('trade-target-select');
    if (sel) sel.onchange = () => { s.selectedIndex = parseInt(sel.value); s.oppPicks = []; s.oppCash = 0; this._renderTradeBuilder(); };
    this.uiModalBoxEl.querySelectorAll('.trade__prop').forEach(btn => {
      btn.onclick = () => {
        const pid = parseInt(btn.dataset.pid);
        const arr = btn.dataset.side === 'my' ? s.myPicks : s.oppPicks;
        const idx = arr.indexOf(pid);
        if (idx >= 0) arr.splice(idx, 1); else arr.push(pid);
        this._renderTradeBuilder();
      };
    });
    this.uiModalBoxEl.querySelectorAll('[data-cash]').forEach(btn => {
      btn.onclick = () => {
        const d = parseInt(btn.dataset.d);
        if (btn.dataset.cash === 'my') s.myCash = Math.max(0, Math.min(player.money, s.myCash + d));
        else s.oppCash = Math.max(0, Math.min(target.money, s.oppCash + d));
        this._renderTradeBuilder();
      };
    });
    document.getElementById('btn-trade-cancel').onclick = () => this.closeUiModal();
    document.getElementById('btn-trade-send').onclick = () => {
      if (s.myPicks.length === 0 && s.oppPicks.length === 0 && s.myCash === 0 && s.oppCash === 0) return;
      this.client.moves.proposeTrade({
        targetPlayerId: target.id,
        offeredProperties: s.myPicks.slice(),
        requestedProperties: s.oppPicks.slice(),
        offeredMoney: s.myCash,
        requestedMoney: s.oppCash,
      });
      this.closeUiModal();
    };
  }

  // ─────────────────────────────────────────────────────────
  // AI event detection — event-driven (lazy seq cursor over G.events;
  // see mapEngineEventToAi/consumeNewEvents in character-ai.js and spec
  // §2.4). String-sniffing over G.messages retired.
  // ─────────────────────────────────────────────────────────
  detectAndTriggerAI(G, ctx) {
    if (!this.characterAI.isEnabled()) return;
    if (G.phase !== 'play') return;

    // Lazy cursor: undefined on first sight of G.events (new game, load,
    // exit-to-menu restart, mid-match online join) -> consumeNewEvents sets
    // the cursor to the current max seq WITHOUT returning anything to fire,
    // so none of those transitions replay old events as a reaction burst.
    const { newEvents, nextSeq } = consumeNewEvents(G.events, this._lastEventSeq);
    this._lastEventSeq = nextSeq;
    if (newEvents.length === 0) return;

    const player = G.players[ctx.currentPlayer];
    const char = player.character;
    if (!char) return;

    const gameState = {
      turnNumber: G.totalTurns,
      season: SEASONS[G.seasonIndex] ? SEASONS[G.seasonIndex].name : '',
      money: player.money,
      propertyCount: player.properties.length,
    };

    for (const event of newEvents) {
      const mapped = mapEngineEventToAi(event, G);
      if (!mapped) continue;
      this._triggerAIResponse(char, mapped.eventType, mapped.eventData, gameState);
    }
  }

  async _triggerAIResponse(char, eventType, eventData, gameState) {
    const lore = this.activeMod.getLoreById(char.id);
    this._nextAIId = (this._nextAIId || 0) + 1;
    const loadingId = this._nextAIId;
    this.aiResponses.push({ id: loadingId, charName: char.name, charColor: char.color, portrait: char.portrait, text: null });
    this._renderAIResponses();

    const text = await this.characterAI.respondToEvent(char, lore, eventType, eventData, gameState);
    const entry = this.aiResponses.find(r => r.id === loadingId);
    if (entry) {
      if (text) entry.text = text;
      else this.aiResponses = this.aiResponses.filter(r => r.id !== loadingId);
    }
    if (this.aiResponses.length > 8) this.aiResponses = this.aiResponses.slice(-8);
    this._renderAIResponses();
  }

  _renderAIResponses() {
    if (!this.aiResponsesEl) return;
    if (this.aiResponses.length === 0) { this.aiResponsesEl.innerHTML = ''; return; }
    let items = '';
    this.aiResponses.forEach(r => {
      const avatar = r.portrait
        ? `<div class="aibubble__av"><img src="${r.portrait}" alt="" /></div>`
        : `<div class="aibubble__av aibubble__avph" style="background:${r.charColor}">${esc(r.charName[0])}</div>`;
      const textHtml = r.text === null
        ? '<div class="aibubble__loading">Thinking…</div>'
        : `<div class="aibubble__text">${esc(r.text)}</div>`;
      items += `<div class="aibubble">${avatar}<div class="aibubble__body"><div class="aibubble__name" style="color:${readableNameColor(r.charColor)}">${esc(r.charName)}</div>${textHtml}</div></div>`;
    });
    this.aiResponsesEl.innerHTML = `<div class="airesp"><div class="airesp__title">COUNCIL CHATTER</div><div class="airesp__list">${items}</div></div>`;
  }

  _escapeHtml(text) { return esc(text); }

  // ─────────────────────────────────────────────────────────
  // Chat panel (unchanged logic, pixel markup)
  // ─────────────────────────────────────────────────────────
  renderChatPanel(G, ctx) {
    if (!this.chatPanelEl) return;
    if (!G || G.phase !== 'play') { this.chatPanelEl.innerHTML = ''; return; }
    const chars = G.players.filter(p => p.character).map(p => p.character);
    if (chars.length === 0) { this.chatPanelEl.innerHTML = ''; return; }

    if (!this.activeChatCharId || !chars.find(c => c.id === this.activeChatCharId)) this.activeChatCharId = chars[0].id;
    const activeChar = chars.find(c => c.id === this.activeChatCharId);
    const history = this.chatHistories[this.activeChatCharId] || [];

    const tabs = chars.map(c => `<div class="chat__tab ${c.id === this.activeChatCharId ? 'active' : ''}" data-chat-char="${c.id}" style="${c.id === this.activeChatCharId ? 'color:' + c.color + ';border-color:' + c.color : ''}">${esc(c.name.split(' ')[0])}</div>`).join('');

    let msgs;
    if (history.length === 0) {
      msgs = `<div class="chat__empty">Start a conversation with ${esc(activeChar.name)}</div>`;
    } else {
      msgs = history.map(m => m.role === 'user'
        ? `<div class="chat__msg user"><div class="chat__sender">YOU</div>${esc(m.content)}</div>`
        : `<div class="chat__msg ai"><div class="chat__sender" style="color:${readableNameColor(activeChar.color)}">${esc(activeChar.name)}</div>${esc(m.content)}</div>`).join('');
    }

    const disabled = !this.characterAI.apiKey ? 'disabled' : '';
    const placeholder = !this.characterAI.apiKey ? 'Set API key in AI settings' : 'Type a message…';
    this.chatPanelEl.innerHTML = `
      <div class="chat">
        <div class="chat__title">CHAT</div>
        <div class="chat__tabs">${tabs}</div>
        <div class="chat__msgs" id="chat-scroll">${msgs}</div>
        <div class="chat__inputrow">
          <input type="text" id="chat-input" placeholder="${placeholder}" ${disabled} />
          <button class="pix-btn pix-btn--primary pix-btn--sm" id="btn-chat-send" ${disabled}>SEND</button>
        </div>
      </div>`;

    const scrollEl = document.getElementById('chat-scroll');
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;

    this.chatPanelEl.querySelectorAll('.chat__tab').forEach(tab => {
      tab.onclick = () => { this.activeChatCharId = tab.dataset.chatChar; this.renderChatPanel(G, ctx); };
    });
    const inputEl = document.getElementById('chat-input');
    const sendBtn = document.getElementById('btn-chat-send');
    const send = () => {
      const text = inputEl.value.trim();
      if (!text) return;
      inputEl.value = '';
      this._sendChat(this.activeChatCharId, text, G, ctx);
    };
    if (sendBtn) sendBtn.onclick = send;
    if (inputEl) inputEl.onkeydown = (e) => { if (e.key === 'Enter') send(); };
  }

  async _sendChat(charId, userMessage, G, ctx) {
    const char = this.activeMod.characters.find(c => c.id === charId);
    if (!char) return;
    const lore = this.activeMod.getLoreById(charId);
    if (!this.chatHistories[charId]) this.chatHistories[charId] = [];
    const history = this.chatHistories[charId];
    history.push({ role: 'user', content: userMessage });
    this.renderChatPanel(G, ctx);

    const player = G.players[ctx.currentPlayer];
    const gameState = {
      turnNumber: G.totalTurns,
      season: SEASONS[G.seasonIndex] ? SEASONS[G.seasonIndex].name : '',
      money: player.money,
      propertyCount: player.properties.length,
      otherPlayers: G.players
        .filter(p => p.character && p.id !== ctx.currentPlayer && !p.bankrupt)
        .map(p => `${p.character.name} ($${p.money}, ${p.properties.length} props)`)
        .join('; '),
      lastEvent: G.messages.length > 0 ? G.messages[G.messages.length - 1] : '',
    };

    const response = await this.characterAI.chat(char, lore, userMessage, history.slice(0, -1), gameState);
    history.push({ role: 'assistant', content: response || '(No response — check your API key in AI settings)' });
    this.renderChatPanel(G, ctx);
  }

  async _charSelectIntro(charId) {
    if (!this.characterAI.apiKey) return;
    const char = this.activeMod.characters.find(c => c.id === charId);
    if (!char) return;
    const lore = this.activeMod.getLoreById(charId);
    const chatEl = document.getElementById('char-chat-' + charId);
    if (chatEl) { chatEl.style.display = 'block'; chatEl.innerHTML = '<div class="charcard__intro">Thinking…</div>'; }
    const text = await this.characterAI.introduce(char, lore);
    const el = document.getElementById('char-chat-' + charId);
    if (el) el.innerHTML = text ? `<div class="charcard__intro">"${esc(text)}"</div>` : '';
  }

  // ─────────────────────────────────────────────────────────
  // Lifecycle / save-load
  // ─────────────────────────────────────────────────────────
  // Stop + drop the live boardgame.io client (and keep the live-client counter honest, used by
  // the soft-exit/leak E2E). Safe to call when no client exists.
  _bumpClients(n) {
    if (typeof window !== 'undefined') window.__MP_LIVE_CLIENTS = Math.max(0, (window.__MP_LIVE_CLIENTS || 0) + n);
  }
  _stopClient() {
    if (this.client) { this.client.stop(); this.client = null; this._bumpClients(-1); }
  }

  exitToMenu() {
    this._cancelRoll(); // kill any in-flight dice animation before the client goes away
    this._teardownGlobe(); // stop the globe RAF loop + WebGL context (update() won't run again)
    this._stopClient();
    if (this.animator) this.animator.reset(); // clear in-flight hop/dice; next game starts at cursor -1
    if (this._tokenResizeObs) { this._tokenResizeObs.disconnect(); this._tokenResizeObs = null; }
    this._lastG = null;
    this._lastCtx = null;
    this._tokenRetried = false;
    this._logSeenCount = 0; // q2: G.messages resets each match — a stale leftover count would suppress the next game's dot
    this.onlinePlayerID = null;
    this._pendingCharId = null;
    this._setupSel = null; // FULL reset: the merged SETUP screen returns to fresh defaults next entry
    this.aiResponses = [];
    this.chatHistories = {};
    this.activeChatCharId = null;
    this._lastEventSeq = undefined;
    if (this.aiResponsesEl) this.aiResponsesEl.innerHTML = '';
    if (this.chatPanelEl) this.chatPanelEl.innerHTML = '';
    this.closeUiModal();
    // drawer close is now centralized in _showScreen(name !== 'game') below (via showModeSelect
    // -> _showScreen('menu')), which also covers the gameover/loadGame paths this one-off missed
    // (Task-2 fix-wave) — no longer needed as an explicit call here.
    this.stateModalEl.classList.remove('open');
    setVictoryConfig(null);
    this.setMap(this.availableMaps[0]); // active mod's default board (classic for Dominion)
    this.showModeSelect();
  }

  saveGame(G, ctx) {
    // A dice roll is animating: the real move is deferred behind the ~0.9s timer, so G
    // is still the PRE-roll state. Saving now would serialize a turn the UI has already
    // shown as rolled; reloading would rewind it. Refuse until the roll has dispatched.
    if (this._rolling) {
      if (this.saveBtnEl) {
        const prev = this.saveBtnEl.textContent;
        this.saveBtnEl.textContent = 'ROLLING…';
        setTimeout(() => { if (this.saveBtnEl) this.saveBtnEl.textContent = prev; }, 1000);
      }
      return;
    }
    const saveData = { G: G, currentPlayer: ctx.currentPlayer, numPlayers: G.players.length, modId: this.activeMod.id, mapId: this.mapData.id, timestamp: Date.now() };
    const saveName = `meinopoly_save_${new Date().toLocaleString().replace(/[/:]/g, '-')}`;
    const saves = JSON.parse(localStorage.getItem('meinopoly_saves') || '{}');
    saves[saveName] = saveData;
    localStorage.setItem('meinopoly_saves', JSON.stringify(saves));
    // G is boardgame.io's frozen live state — never mutate it here. Confirm via the button.
    if (this.saveBtnEl) {
      const prev = this.saveBtnEl.textContent;
      this.saveBtnEl.textContent = 'SAVED ✓';
      setTimeout(() => { if (this.saveBtnEl) this.saveBtnEl.textContent = prev; }, 1200);
    }
  }

  static getSaves() { return JSON.parse(localStorage.getItem('meinopoly_saves') || '{}'); }
  static deleteSave(name) {
    const saves = JSON.parse(localStorage.getItem('meinopoly_saves') || '{}');
    delete saves[name];
    localStorage.setItem('meinopoly_saves', JSON.stringify(saves));
  }

  loadGame(saveData) {
    this._cancelRoll(); // kill any in-flight dice animation before the client is replaced
    // Restore the saved MOD first (its rules singleton + character provider + board set),
    // BEFORE resolving the map — the saved board lives in that mod's world list, and RULES
    // is off-G so it must be installed to match the saved economy. Pre-Stage-4 saves (no
    // modId) default to the first mod (Dominion), so old saves still load.
    const mod = MODS.find(m => m.id === saveData.modId) || MODS[0];
    if (mod !== this.activeMod) {
      this.activeMod = mod;
      setActiveMod(mod.id);
      this.availableMaps = mod.maps.concat(mod.worlds);
    }
    const savedMap = this.availableMaps.find(m => m.id === saveData.mapId) || this.availableMaps[0];
    this.setMap(savedMap);
    this._stopClient(); // null when loading from the menu (no active game)
    // Reset per-game UI caches so a load (possibly from a different prior game) doesn't replay
    // the entire saved log as fresh AI chatter or carry over stale chat history.
    this.aiResponses = [];
    this.chatHistories = {};
    this.activeChatCharId = null;
    this._lastEventSeq = undefined;
    if (this.aiResponsesEl) this.aiResponsesEl.innerHTML = '';
    if (this.chatPanelEl) this.chatPanelEl.innerHTML = '';
    const savedG = saveData.G;
    // _resumeLoad: tells turn.onBegin to skip the turn/season bump on the first turn after load.
    const LoadedGame = { ...Monopoly, setup: () => ({ ...savedG, events: savedG.events || [], eventSeq: savedG.eventSeq || 0, enforceSeats: savedG.enforceSeats || false, _resumeLoad: true }) };
    this.client = Client({ game: LoadedGame, numPlayers: saveData.numPlayers, debug: false });
    this.client.start();
    // Clear any in-flight dice/hop from the PRIOR client before it's replaced, AND seed the
    // cursor to the save's own LAST-BAKED seq (matching the `eventSeq: savedG.eventSeq || 0`
    // fallback two lines up) rather than resetting to -1. A plain reset() would make every event
    // already baked into the loaded G.events (up to the 200-event window) look "fresh" on the
    // very next onState() — replaying the save's whole recent history as a burst of dice/hop
    // animation instead of just resuming play from where the save was taken.
    // `- 1`: events.js's logEvent assigns `seq: G.eventSeq++` (POST-increment), so a save's
    // `eventSeq` is NEXT-to-assign = lastSeq + 1, not lastSeq itself. Seeding the cursor straight
    // from eventSeq over-advances it by one: the FIRST event after resume then has
    // `seq === cursor`, fails anim.js's `seq > cursor` filter, and is silently swallowed (the
    // first roll after a load loses its dice overlay/sound; an awaitingRoute save can lose a
    // hop). `- 1` also makes the legacy-save fallback (no eventSeq -> `savedG.eventSeq || 0` -> 0)
    // land on cursor -1, the correct "consume everything" sentinel for a save with no event log.
    if (this.animator) this.animator.reset((savedG.eventSeq || 0) - 1);
    this.client.subscribe(state => this.update(state));
    this._bumpClients(1);
  }
}

const appElement = document.getElementById('app');
new MonopolyBoard(appElement);
