import { Client } from 'boardgame.io/client';
import { SocketIO } from 'boardgame.io/multiplayer';
import { Monopoly, setActiveMap, setActiveMod, setVictoryConfig, calculateRent } from './Game';
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
import { initLocale, getLocale, setLocale, onLocaleChange, t } from './i18n';
import { renderLogLines } from './i18n-log';
import { chipHtml, chipDetailHtml, tileDetailHtml, drawerShellHtml, tokenVisual, nodeGlow, legendHtml, NODE_GLOW_COLORS } from './game-chrome';
import { resolveBoardBg, starfieldDataUri } from './board-bg';
import { bloomSprite } from './wr-bloom';
// Local computer players (Task 2 wiring): bot-driver.js is the engine-decoupled
// paced stepper (Task 1 — see .superpowers/sdd/task-1-report.md); this module's
// own `decide`/`decideRoute` deps close over sim/bot.js's PURE decision logic
// (Atlas Balance Sim's greedy-developer bot), bound per-seat via policyForSeat —
// exactly the convention task-1-report.md documents the wiring layer as expected
// to follow (its own decide() never calls resolvePolicy itself).
import { createBotDriver, deriveActingSeat, policyForSeat } from './bot-driver';
import { decideMoves, decideRoute as decideBotRoute } from './sim/bot';

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

// Redesign B (owner-confirmed bug: board bounding box shrank 742px -> 630px
// after a single roll). INSTRUMENTED root cause, not guessed: _syncChromeBands
// used to call `actionBarEl.getBoundingClientRect().height` on every update()
// tick, and the turnbox's real height genuinely varies with turn state — 96px
// at rest vs 152px in the jail state (ROLL FOR DOUBLES + PAY FINE + disabled
// END TURN) — so the board's height formula (index.html, `.app--game .board`/
// `.board--rect`: `100dvh - chrome-top - chrome-bottom`) walked through a
// SEQUENCE of different sizes within a single turn as the turnbox's content
// changed shape. Fix: both bands are now fixed constants for the life of the
// game screen — reserving the WORST case once (bottom) rather than measuring
// the current case every render. NARROW_* is the floating-chrome (non-gutter)
// state (see _syncChromeBands); GUTTER_MARGIN is what both bands collapse to
// in wide-screen rail mode (see _syncGutterMode / index.html's
// `.game--gutters .game__actionbar` rule), since neither bar floats over the
// board's top/bottom edge there anymore — the action bar docks into the same
// left rail as the chip column instead of staying bottom-center.
const CHROME_NARROW_TOP = 76;     // chip-strip content (64px, player-count-invariant) + 8 offset + 4 gap
const CHROME_NARROW_BOTTOM = 170; // jail-state turnbox worst case (152px, measured) + 8 offset + 4 gap + 6 safety
const CHROME_GUTTER_MARGIN = 12;  // 8 fixed offset + 4 gap — no floating bar to reserve for in gutter mode
// Fixed rail column width for BOTH the chip/action-bar rail (left) and the
// drawer (right) when a rect board (atlas/globe) is active — see
// _syncGutterMode's doc comment for why this can't reuse the classic square
// board's analytic (centered-leftover) derivation.
const GUTTER_RAIL_W = 300;

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
    // Locale must be resolved before createLayout() below paints the topbar's first
    // frame (its button labels are t()-driven) — earliest possible point in boot.
    initLocale();
    // The menu-screen renderer to re-invoke on a locale change (LANG toggle):
    // menu screens aren't client-state-driven, so onLocaleChange can't just re-run
    // update() for them — see the onLocaleChange registration in createLayout() for
    // the full re-render hook (menu re-invoke vs. in-game update() dispatch). Each
    // show*() menu-screen method below overwrites this with itself; defaulted here
    // so a locale flip before the first showModeSelect() call (impossible today,
    // future-proofing) never dereferences null.
    this._currentScreenRenderer = () => this.showModeSelect();
    this.rootElement = rootElement;
    this.mode = null; // 'local' or 'online'
    this.onlinePlayerID = null;
    // The live Lobby instance while the online-lobby screen is showing, null otherwise
    // (cleared centrally in _showScreen — see the comment there). Lets onLocaleChange
    // re-render THIS instance in place on a LANG flip instead of showOnlineLobby()
    // constructing a brand-new Lobby, which used to silently drop the typed player name
    // (and the already-fetched match list) on every flip — post-merge localization ticket 1.
    this._lobbyInstance = null;
    this._pendingCharId = null; // local character-select preview
    // Local computer players (bots): botSeats is the LIVE set of bot-controlled seat
    // ids (String(i), matching Game.js's own id convention) for the CURRENT client
    // only — always rebuilt fresh by startGameWithPlayers/loadGame, and cleared by
    // _stopClient() alongside the driver so a stale set from a prior local game can
    // never mislabel an online seat as a bot. pendingBots is the SETUP SCREEN's
    // in-progress selection (0..count-1), independent of botSeats until the game
    // actually starts. _botDriver is null whenever no client owns a live driver
    // (before first game start, or between _stopClient() and the next build).
    this.botSeats = new Set();
    this.pendingBots = 0;
    this._botDriver = null;
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
    // Classic-map art (reskin R2): optional per-map assets keyed by map id —
    // the classic-board twin of atlasAssets. Feeds the .board__bg layer only.
    this.mapData.mapAssets = (mapJson && this.activeMod.mapAssets && this.activeMod.mapAssets[mapJson.id]) || null;
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
      <div class="app" id="app-root">
        <div class="topbar">
          <button id="btn-lang" class="pix-btn pix-btn--default">${t('topbar.lang')}</button>
          <button id="btn-save" class="pix-btn pix-btn--default" style="display:none;">${t('topbar.save')}</button>
          <button id="btn-load-menu" class="pix-btn pix-btn--default">${t('topbar.load')}</button>
          <button id="btn-ai-settings" class="pix-btn pix-btn--default">${t('topbar.ai')}</button>
          <button id="btn-mute" class="pix-btn pix-btn--default">${t('topbar.snd')}</button>
          <button id="btn-exit-game" class="pix-btn pix-btn--danger" style="display:none;">${t('topbar.exit')}</button>
          <button id="btn-fs-top" class="pix-btn pix-btn--default">${t('topbar.full')}</button>
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
                <div id="route-banner">${t('turnbox.chooseRoute')}</div>
                <div id="board" class="board"></div>
                <div id="dice-overlay" style="display:none;"><span class="bigdie" data-die="1"></span><span class="bigdie" data-die="2"></span></div>
                <div id="drawer-tabs"></div>
              </div>
              <div class="game__actionbar wr-panel wr-notch"><div id="turnbox"></div><button id="btn-fs" class="pix-btn pix-btn--default">${t('topbar.full')}</button></div>
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
    // this._lastG/renderTokens. Shared with board/globe token clicks (Task 3)
    // via _openPlayerDetail — see that method's doc comment.
    this.playerInfoEl.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-chip]');
      if (!chip) return;
      this._openPlayerDetail(chip.dataset.chip);
    });
    this.boardEl = document.getElementById('board');
    // Delegated on the persistent boardEl (survives grid rebuilds). Three
    // things share this one listener, in strict priority order (Task 3):
    //   1. A board TOKEN click (.token[data-player], #token-layer) opens the
    //      player-detail popover (same builder as the chip click above) and
    //      stops here — it must never also open the tile popover underneath
    //      (structurally can't anyway: #token-layer is a SIBLING of the tile
    //      grid, not a descendant, so `.closest('.tile[data-space]')` from a
    //      token never finds a tile ancestor — stopPropagation is belt-and-
    //      braces per spec §2.5b, not load-bearing here).
    //
    //      Route-commit priority fix (fullscreen-stage review): this branch
    //      can ONLY fire when `e.target` actually resolves to a `.token` —
    //      and while a route pick is pending (this._routeTargets set), the
    //      CSS route-pick modality (index.html, `.game--routepick #token-layer
    //      .token { pointer-events:none }`, toggled by _syncRoutePickChrome)
    //      makes every token non-interactive, so a token that visually sits
    //      on a `.tile--route-target` never wins the browser's hit-test —
    //      the click falls straight through to the tile beneath and branch 2
    //      below handles it, same as any other tile click. Route-commit keeps
    //      ABSOLUTE priority over the token popover without this branch
    //      needing to know anything about route-picking itself.
    //   2. Atlas route-picker: reads this._routeTargets {nodeId:route} at
    //      click time (set by _resolveAtlasRoute when a fork is awaiting a
    //      choice) and ABSOLUTELY takes over ANY tile click while a route
    //      pick is pending — target hits commit the move, misses no-op, but
    //      either way the tile-detail popover never opens mid-pick (keeps
    //      the existing priority/behavior byte-for-byte, just early-returns
    //      after instead of implicitly falling through to nothing).
    //   3. Otherwise (no pending route pick): open the tile-detail popover
    //      (spec §2.5) via the live client state (G/ctx), not the stale
    //      closure args this listener was created with.
    this.boardEl.addEventListener('click', (e) => {
      const tokenEl = e.target.closest('.token[data-player]');
      if (tokenEl) {
        e.stopPropagation();
        this._openPlayerDetail(tokenEl.dataset.player);
        return;
      }
      const tile = e.target.closest('.tile[data-space]');
      if (!tile) return;
      if (this._routeTargets) {
        const route = this._routeTargets[tile.dataset.space];
        if (route) { this._routeTargets = null; this._syncRoutePickChrome(); this.client.moves.commitRoute(route); }
        return;
      }
      const state = this.client && this.client.getState();
      if (!state) return;
      const d = this._tileDetailData(parseInt(tile.dataset.space, 10), state.G, state.ctx);
      if (d) this.openUiModal(tileDetailHtml(d));
    });
    this.turnboxEl = document.getElementById('turnbox');
    // Chrome-band sizing (Task 2 review fix — see _syncChromeBands below and
    // the CSS comment above `.app--game .board` in index.html). Redesign B:
    // both bands are now STATIC constants (_syncChromeBands no longer reads
    // either bar's real height), so `chipsBarEl` is unused there now — kept
    // (harmless) since `actionBarEl` is still read by _syncGutterMode's
    // classic-board on/off probe (`getBoundingClientRect().width` on
    // `boardEl`, gated behind an `actionBarEl` truthiness guard).
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
    this._logSeenCount = 0; // q2: message-producing-event count last seen while the LOG tab was open/visible (Task 4: was G.messages.length, now counts G.events entries that render a line — see _updateLogUnread)
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
    // Modal-first ordering (Task 3, resolves the earlier y10/Escape-order
    // minor for BOTH the chip and tile popovers): if the ui-modal is open,
    // Escape closes THAT and stops — the drawer only gets a look on a
    // separate, later Escape press with no modal open. One consolidated
    // handler (not two independent listeners) so a single keypress can't
    // close both at once.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this.uiModalEl && this.uiModalEl.classList.contains('open')) { this.closeUiModal(); return; }
      if (this._drawerOpen) this._closeDrawer();
    });
    this.boardEl.addEventListener('pointerdown', () => { if (this._drawerOpen) this._closeDrawer(); });

    // Topbar buttons
    this.exitBtnEl = document.getElementById('btn-exit-game');
    this.saveBtnEl = document.getElementById('btn-save');
    this.exitBtnEl.onclick = () => this.exitToMenu();
    document.getElementById('btn-exit-foot').onclick = () => this.exitToMenu();
    document.getElementById('btn-load-menu').onclick = () => this.showSavesModal();
    document.getElementById('btn-ai-settings').onclick = () => this.showAISettings();

    // LANG toggle (spec 2026-07-15-localization-design.md §1): the button always shows
    // the locale it will SWITCH TO (t('topbar.lang') is written that way per-locale — see
    // src/i18n.js). Click flips the locale; the actual repaint + re-render happens via the
    // onLocaleChange registration below, same as every other locale-driven listener would.
    this.langBtnEl = document.getElementById('btn-lang');
    this.langBtnEl.onclick = () => setLocale(getLocale() === 'zh' ? 'en' : 'zh');

    // Mute toggle (this.audio is constructed in the constructor, before createLayout runs).
    const muteBtn = document.getElementById('btn-mute');
    this._paintMute = () => { muteBtn.textContent = this.audio && this.audio.isMuted() ? t('topbar.muted') : t('topbar.snd'); };
    muteBtn.onclick = () => { this.audio.setMuted(!this.audio.isMuted()); this._paintMute(); };
    this._paintMute();

    // GB themes + CRT retired in the B2 reskin (R1a): one :root palette in
    // index.html; stale meinopoly_theme/meinopoly_crt localStorage keys are inert.

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
        const label = document.fullscreenElement ? t('topbar.fullExit') : t('topbar.full');
        this.fsBtnEl.textContent = label;
        this.fsBtnTopEl.textContent = label;
      };
      this._paintFs = paintFs;
      const toggleFs = () => {
        // Final fix wave, Fix 2: requestFullscreen/exitFullscreen return promises
        // that reject on denial (permissions-policy, iframe embed without the
        // `allowfullscreen` attribute, etc). Unhandled, that's a console
        // unhandled-rejection AND the button label goes stale (still says FULL/
        // EXIT FS from the optimistic click even though the state never changed).
        // .catch(paintFs) re-reads the real document.fullscreenElement after the
        // rejection settles, so the label always reflects reality.
        if (document.fullscreenElement) document.exitFullscreen().catch(() => paintFs());
        else document.documentElement.requestFullscreen().catch(() => paintFs());
      };
      this.fsBtnEl.onclick = toggleFs;
      this.fsBtnTopEl.onclick = toggleFs;
      document.addEventListener('fullscreenchange', paintFs);
      paintFs();
    }

    // Locale-change re-render hook (spec 2026-07-15-localization-design.md §1). Two parts,
    // both needed on every setLocale() (LANG click or, later, any other caller):
    //  1. Repaint the topbar's own labels — the static ones directly (LOAD/AI/SAVE/EXIT
    //     have no other paint path), the toggle-state ones (SND/MUTED, FULL/EXIT FS) via
    //     their existing paint* functions so they keep reflecting the CURRENT toggle state,
    //     not just the current locale.
    //  2. Re-render whatever's on screen. There's no single "current state" App keeps for
    //     this: boardgame.io-driven screens (characterSelect/game/results) are fully
    //     rebuilt by update(state) already — re-invoking it with client.getState() is the
    //     existing, correct repaint path (see the client.subscribe wiring below). Menu
    //     screens (hero/mod-select/map-select/setup/online-lobby) build their DOM directly
    //     in a show*() method with no backing client yet — those re-invoke themselves via
    //     this._currentScreenRenderer, which each show*() method points at itself on entry
    //     (see showModeSelect() etc.). This.client is null exactly when a menu screen is
    //     active (_stopClient() nulls it; every menu entry point runs after that), so
    //     checking it first is a reliable, already-existing signal for which path applies —
    //     no separate screen-name flag needed.
    onLocaleChange(() => {
      this.langBtnEl.textContent = t('topbar.lang');
      this.saveBtnEl.textContent = t('topbar.save');
      document.getElementById('btn-load-menu').textContent = t('topbar.load');
      document.getElementById('btn-ai-settings').textContent = t('topbar.ai');
      this.exitBtnEl.textContent = t('topbar.exit');
      if (this._paintMute) this._paintMute();
      if (this._paintFs) this._paintFs();
      // Task 3: in-game chrome that is stamped ONCE in createLayout (not per-update)
      // needs its own repaint here — the update()/screen-renderer re-render below
      // rebuilds everything else, but not these three:
      //  - the route banner (static template text, CSS-toggled visibility only);
      //  - the drawer TAB RAIL (drawerShellHtml runs once; innerHTML rebuild is safe —
      //    the tab click handler is DELEGATED on the persistent #drawer-tabs container —
      //    but it resets the active-highlight and unread-dot state, so both are re-applied
      //    right after);
      //  - #btn-exit-foot (its onclick was wired once in createLayout, so only its LABEL
      //    is repainted — never its node, or the wiring would be lost).
      const routeBannerEl = document.getElementById('route-banner');
      if (routeBannerEl) routeBannerEl.textContent = t('turnbox.chooseRoute');
      if (this.drawerTabsEl) {
        const rebuilt = document.createElement('div');
        rebuilt.innerHTML = drawerShellHtml();
        this.drawerTabsEl.innerHTML = rebuilt.querySelector('.drawer-tabs').innerHTML;
        if (this._drawerOpen && this._drawerTab) {
          this.drawerTabsEl.querySelectorAll('.drawer-tabs__btn').forEach(b => {
            b.classList.toggle('drawer-tabs__btn--active', b.dataset.tab === this._drawerTab);
          });
        }
        this._updateLogUnread();
      }
      const exitFootEl = document.getElementById('btn-exit-foot');
      if (exitFootEl) exitFootEl.textContent = t('drawer.exitToMenu');
      // T1-review Finding 1: update()'s first line unconditionally clears this._rolling
      // (the dice-tumble animation lock — see the "Release the dice-roll lock" comment at
      // the top of update()), which must only happen on a REAL post-roll state tick. A LANG
      // click landing mid-tumble (_animateRollThenMove, ~0.9s) would otherwise race that
      // clear here, re-enabling #btn-roll and letting a second click stack a spurious second
      // tumble on top of the first. So THIS handler only, skip the full re-render while a
      // roll is in flight — the topbar labels above are already repainted, and the HUD
      // (board/turnbox/etc.) catches up on the next real client.subscribe tick once the roll
      // actually lands (a sub-second stale window, not a correctness issue). update() itself
      // is intentionally left unchanged; its unconditional clear is correct for every other
      // caller (the real post-roll subscribe tick).
      if (this.client) { if (!this._rolling) this.update(this.client.getState()); }
      // Localization ticket 1: the online-lobby screen has no backing client, so it would
      // otherwise fall to the generic _currentScreenRenderer() branch below, which for the
      // lobby means showOnlineLobby() constructing a BRAND-NEW Lobby instance — discarding
      // the old one along with this.playerName (even a value already committed via the name
      // input's 'change' event) and the already-fetched match list. Re-render the SAME
      // instance in place instead; refreshLocale() also reads the input's live DOM value
      // first, so text typed but not yet blurred survives too (Lobby.js has the full
      // rationale). Must come before the generic fallback, not after — _currentScreenRenderer
      // still points at showOnlineLobby while this._lobbyInstance is set.
      else if (this._lobbyInstance) this._lobbyInstance.refreshLocale();
      else if (this._currentScreenRenderer) this._currentScreenRenderer();
    });

    // Final fix wave, Fix 1: the board sizes off dvw/dvh (index.html, `.app--game
    // .board`), which recomputes INSTANTLY on any viewport resize — including a
    // fullscreen toggle, which resizes the viewport itself. But --chrome-top/
    // --chrome-bottom (the reserved bands _syncChromeBands writes) only get
    // refreshed from the `update()` render loop, so between a resize and the next
    // G-driven re-render the board has already snapped to its new size while the
    // band vars are still stale from the old viewport — a transient board-under-
    // chrome overlap, i.e. exactly the invariant this branch's chrome-band system
    // exists to prevent. `resize` re-measures unconditionally; _syncChromeBands'
    // own this._lastChromeTop/_lastChromeBottom guard makes repeat calls with an
    // unchanged height a no-op (no extra reflow/write), so this is safe to fire
    // on every resize tick without throttling. Verified live: Chromium fires a
    // `resize` event on fullscreen ENTER and EXIT (viewport dimensions actually
    // change), so a dedicated `fullscreenchange` hook is not needed — see
    // task-4-report.md for the verification note.
    window.addEventListener('resize', () => { this._syncGutterMode(); this._syncChromeBands(); });

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
    // Task 4: counts message-producing G.events entries (renderLogLines'
    // output length), not G.messages.length — see _updateLogUnread.
    if (tab === 'log') this._logSeenCount = this._lastG ? renderLogLines(this._lastG.events, getLocale(), this._lastG).length : 0;
    // T4 perf gate: rebuilds skipped while hidden — render the pending content now.
    if (tab === 'log' && this._logStale && this._lastG) this.renderMessages(this._lastG);
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

  // q2: LOG tab unread dot. Compares the message-producing G.events count
  // against the count last seen while the LOG tab was open/visible
  // (this._logSeenCount). While the tab is actively open (viewingLog), the
  // seen-count is kept in sync on every render so new lines arriving while
  // the user is looking never flag unread; the moment the drawer closes or
  // the tab switches away, that count freezes and anything appended after it
  // lights the dot on the next render.
  //
  // Task 4: source moved from G.messages.length (a per-turn RESET buffer —
  // its length could go DOWN between renders, e.g. right after a fresh roll,
  // which would have made `count > this._logSeenCount` spuriously false and
  // silently swallowed an unread flag EVERY turn) to G.events, which is
  // append-only and monotonically grows for the life of a match except at
  // the far edge of its cap (events.js EVENT_LOG_CAP_FALLBACK/
  // RULES.core.eventLogCap — ~200 events; oldest entries are evicted once
  // hit). That residual edge case is strictly rarer than the old buffer's
  // every-single-turn reset, so this is a strict improvement, not a
  // complete fix. renderLogLines' locale param doesn't change the COUNT
  // (every type is null in the exact same conditions in every locale — see
  // i18n-log.js's null-parity guarantee), only the text, so which locale is
  // passed here is immaterial to correctness.
  //
  // `precomputedLines` (post-merge localization ticket 2): when update() just ran
  // renderMessages(G) and got a non-null array back (the log WAS visible and rebuilt this
  // very tick), it hands that array straight in here instead of letting this method run
  // renderLogLines over the same G.events/locale a second time. Every other caller
  // (onLocaleChange's drawer-tab-rebuild branch, _openDrawer) still calls this with no 2nd
  // arg and gets the exact same self-computed count as before — behavior-identical, just
  // not redundantly recomputed on the one hot path where the answer was already sitting
  // right there.
  _updateLogUnread(G, precomputedLines) {
    if (!this.drawerTabsEl) return;
    const btn = this.drawerTabsEl.querySelector('.drawer-tabs__btn[data-tab="log"]');
    if (!btn) return;
    const g = G || this._lastG;
    const count = precomputedLines ? precomputedLines.length
      : (g && g.events ? renderLogLines(g.events, getLocale(), g).length : 0);
    const viewingLog = this._drawerOpen && this._drawerTab === 'log';
    if (viewingLog) this._logSeenCount = count;
    const unread = !viewingLog && count > this._logSeenCount;
    btn.classList.toggle('drawer-tabs__btn--unread', unread);
    const dot = btn.querySelector('.drawer-tabs__dot');
    if (dot) dot.hidden = !unread;
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
    // Localization ticket 1: every screen transition routes through here (same reasoning
    // as the drawer close above), so this is the one place that reliably knows we've left
    // the lobby screen — clear the cached instance so onLocaleChange's lobby-reuse branch
    // (below, in createLayout) never re-renders a Lobby that isn't actually on screen.
    if (name !== 'lobby') this._lobbyInstance = null;
  }

  // ─────────────────────────────────────────────────────────
  // Menu screens
  // ─────────────────────────────────────────────────────────
  showModeSelect() {
    this._currentScreenRenderer = () => this.showModeSelect();
    this._showScreen('menu');
    this.menuEl.className = 'screen screen--hero';
    const totalMaps = MODS.reduce((n, m) => n + m.maps.length + m.worlds.length, 0);
    this.menuEl.innerHTML = `
      <img class="hero-art" src="${this.activeMod.keyArt}" alt="${t('menu.heroAlt')}" draggable="false" />
      <div class="hero-overlay">
        <div class="mode-grid">
          <button class="pix-btn pix-btn--primary pix-btn--lg mode-btn" id="btn-mode-local">${t('menu.localGame')}</button>
          <button class="pix-btn pix-btn--default pix-btn--lg mode-btn" id="btn-mode-online">${t('menu.onlineGame')}</button>
        </div>
        <div class="title__press"><span class="glyph glyph--arrow"></span> ${t('menu.pressStart')}</div>
        <div class="title__foot">v0.4 · ${MODS.length} ${t('menu.modsWord')} · ${pluralize(totalMaps, 'MAP')} · ${t('menu.tradeAuction')}</div>
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
    this._currentScreenRenderer = () => this.showModSelect();
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
      <div><div class="menu__heading">${t('mod.heading')}</div><div class="menu__sub">${t('mod.subheading')}</div></div>
      <div class="map-grid">${cards}</div>
      <button class="pix-btn pix-btn--ghost" id="btn-back-mode-mods"><span class="glyph glyph--arrow-back"></span> ${t('mod.back')}</button>
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
    this._currentScreenRenderer = () => this.showMapSelect();
    this._showScreen('menu');
    this.menuEl.className = 'screen screen--menu';
    let cards = '';
    this.availableMaps.forEach((mapJson, idx) => {
      const isWorld = mapJson.movementMode === 'atlas';
      const layoutLabel = isWorld ? t('map.layoutAtlas') : mapJson.layout.type;
      const spaceLabel = isWorld ? (mapJson.places.length + ' ' + t('map.places')) : (mapJson.spaceCount + ' ' + t('map.spaces'));
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
      <div><div class="menu__heading">${t('map.heading')}</div><div class="menu__sub">${t('map.subheading')}</div></div>
      <div class="map-grid">${cards}</div>
      <button class="pix-btn pix-btn--ghost" id="btn-back-mode"><span class="glyph glyph--arrow-back"></span> ${t('map.back')}</button>
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
    this._currentScreenRenderer = () => this.showSetup(playerCount);
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
      this.pendingBots = 0; // fresh setup entry (new map, or first visit) -> BOTS row default
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
    // BOTS row (local-bots wiring): 0..playerCount-1 — at least one human seat
    // (the LAST seats are handed to bots at game start, see startGameWithPlayers)
    // must always remain, so the max selectable bot count is one less than the
    // TOTAL player count chosen above (.count-btn semantics are unchanged — total
    // players — per the E2E contract).
    let botBtns = '';
    for (let n = 0; n <= s.playerCount - 1; n++) {
      botBtns += `<button class="pix-btn ${this.pendingBots === n ? 'pix-btn--primary' : 'pix-btn--default'} bot-btn" data-bots="${n}">${n}</button>`;
    }
    const MODES = [
      { id: 'survival', label: t('setup.modeSurvivalLabel'), desc: t('setup.modeSurvivalDesc') },
      { id: 'wealth', label: t('setup.modeWealthLabel'), desc: t('setup.modeWealthDesc') },
      { id: 'monopoly', label: t('setup.modeMonopolyLabel'), desc: t('setup.modeMonopolyDesc') },
    ];
    const cards = MODES.map(m => `
      <div class="pix-panel map-card vic-card ${s.primary === m.id ? 'vic-card--sel' : ''}" data-mode="${m.id}">
        <div class="pix-panel__body">
          <div class="map-card__title">${m.label}</div>
          <div class="map-card__desc">${m.desc}</div>
          ${s.primary === m.id ? `<div class="charcard__seltag">${t('setup.selected')}</div>` : ''}
        </div>
      </div>`).join('');

    let param = '';
    if (s.primary === 'wealth') {
      param = `<div class="vic-param"><span class="aiset__label">${t('setup.turnLimit')}</span>
        <div class="trade__cashctl"><button id="vic-mt-dec">−</button><span class="trade__cashval">${s.maxTurns}</span><button id="vic-mt-inc">+</button></div></div>`;
    } else if (s.primary === 'monopoly') {
      param = `<div class="vic-param"><span class="aiset__label">${t('setup.groupsToWin')}</span>
        <div class="trade__cashctl"><button id="vic-gw-dec">−</button><span class="trade__cashval">${s.groupsToWin}</span><button id="vic-gw-inc">+</button></div></div>`;
    }

    this.menuEl.innerHTML = `
      ${this._breadcrumb('setup')}
      <div><div class="menu__heading">${t('setup.heading')}</div><div class="menu__sub">${t('setup.subheading')}</div></div>
      <div class="setup__count"><span class="aiset__label">${t('setup.players')}</span><div class="count-grid">${counts}</div></div>
      <div class="setup__count" id="setup-bots-row"><span class="aiset__label">${t('setup.bots')}</span><div class="count-grid">${botBtns}</div></div>
      <div class="vic-grid">${cards}</div>
      <div class="vic-paramrow">${param}</div>
      <div class="vic-actions">
        <button class="pix-btn pix-btn--ghost" id="btn-vic-back"><span class="glyph glyph--arrow-back"></span> ${t('setup.back')}</button>
        <button class="pix-btn pix-btn--primary pix-btn--lg" id="btn-vic-start">${t('setup.start')} <span class="glyph glyph--arrow"></span></button>
      </div>
    `;

    this.menuEl.querySelectorAll('.count-btn').forEach(btn => {
      btn.onclick = () => {
        this._setupSel.playerCount = parseInt(btn.dataset.count);
        // Count change clamps bots: total players just shrank (or grew), so
        // pendingBots can never sit at/above the new total (>=1 human seat rule).
        this.pendingBots = Math.min(this.pendingBots, this._setupSel.playerCount - 1);
        this._renderSetup();
      };
    });
    this.menuEl.querySelectorAll('.bot-btn').forEach(btn => {
      btn.onclick = () => { this.pendingBots = parseInt(btn.dataset.bots); this._renderSetup(); };
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
    this._currentScreenRenderer = () => this.showOnlineLobby();
    this._showScreen('lobby');
    this.lobbyEl.className = 'screen screen--menu';
    const serverUrl = window.location.protocol + '//' + window.location.hostname + ':8088';
    const lobby = new Lobby(this.lobbyEl, serverUrl, (matchID, playerID, credentials, numPlayers) => {
      this.startOnlineGame(serverUrl, matchID, playerID, credentials, numPlayers);
    });
    lobby.onBack = () => this.showModeSelect();
    this._lobbyInstance = lobby;
  }

  startOnlineGame(serverUrl, matchID, playerID, credentials, numPlayers) {
    this.onlinePlayerID = playerID;
    // Bots are a local-only concept (Task 1's driver dispatches with no seat
    // argument, relying on hot-seat's enforceSeats:false — see task-1-report.md
    // Design Decision 6 — which is NOT true online). Clear any stale set left
    // over from a prior local game so an online seat is never mislabeled BOT in
    // the chip strip; _botDriver itself is left null (never built here), and
    // _stopClient() already nulls it on the way out of any prior local game.
    this.botSeats = new Set();
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
    // Bot seats = the LAST M seat ids (String(i), Game.js's own convention —
    // createPlayer, Game.js:1165), where M = this.pendingBots (SETUP screen's
    // BOTS row selection), clamped to numPlayers-1 so at least one human seat
    // always remains even if a stale pendingBots value somehow exceeded it.
    const botCount = Math.max(0, Math.min(this.pendingBots || 0, numPlayers - 1));
    this.botSeats = new Set();
    for (let i = numPlayers - botCount; i < numPlayers; i++) this.botSeats.add(String(i));
    this.client = Client({ game: Monopoly, numPlayers: numPlayers, debug: false });
    this.client.start();
    // Driver is built AFTER client.start() (needs a live this.client for its
    // getState/dispatch deps) and BEFORE subscribe() (so the very first state
    // delivery — characterSelect phase, if any bot seats exist — can already
    // drive bot auto-pick).
    this._buildBotDriver();
    this.client.subscribe(state => this.update(state));
    this._bumpClients(1);
  }

  // seat -> is this seat bot-controlled in the CURRENT client. String-coerced
  // (Game.js seat ids are always String(i); deriveActingSeat/ctx.currentPlayer
  // sometimes arrive as numbers depending on caller) so lookups never miss on
  // a type mismatch.
  _isBotSeat(seat) {
    return !!(this.botSeats && this.botSeats.has(String(seat)));
  }

  // Constructs the paced bot-turn stepper (src/bot-driver.js, Task 1) bound to
  // THIS client. Called once per client (startGameWithPlayers / loadGame,
  // always AFTER client.start()); _stopClient() stops + nulls the driver on
  // every teardown path (exitToMenu, loadGame's own pre-rebuild stop,
  // _softExitTo), so a stray driver from a previous game can never survive
  // into a new one — see the botSeats doc comment on the constructor fields.
  _buildBotDriver() {
    if (this._botDriver) this._botDriver.stop();
    this._botDriver = createBotDriver({
      getState: () => this.client.getState(),
      // Deferred to a fresh macrotask — INSTRUMENTED, not guessed (browser E2E
      // run: a 3p/2-bot game stalled forever after exactly one bot action,
      // reproduced live before this fix, see task-2-report.md). Root cause:
      // boardgame.io's local Client notifies subscribers SYNCHRONOUSLY inside
      // client.moves[name](...) (verified in node_modules/boardgame.io/dist/cjs/
      // client-cadd28ea.js — notifySubscribers() is a plain forEach, no
      // microtask/RAF deferral). A synchronous call here would re-enter
      // App.update() -> this._botDriver.onUpdate() WHILE this exact dispatch is
      // still running as the terminal hop of bot-driver.js's own guardedStep —
      // whose single-flight `scheduled` flag is only released by finish() AFTER
      // this call returns. That reentrant onUpdate() call sees scheduled===true
      // and silently no-ops (single-flight working as designed), and — because
      // dispatching is this stepper's only externally-visible effect — nothing
      // else ever calls onUpdate() again on its own, permanently stalling the
      // NEXT seat's turn. Deferring the real move call lets this dispatch()
      // return (and the driver's own finish() run) BEFORE boardgame.io's
      // synchronous notify chain fires, so by the time it reaches
      // this._botDriver.onUpdate(), `scheduled` is already false.
      dispatch: (name, ...args) => {
        // Identity capture (T2 review Important): a stale 0ms timer armed just
        // before loadGame() swaps clients must NOT fire into the NEW game — a
        // truthiness check would (this.client is truthy again post-load).
        const c = this.client;
        setTimeout(() => { if (this.client === c) c.moves[name](...args); }, 0);
      },
      // decide/decideRoute close over policyForSeat(seat) themselves — bot-driver.js
      // never calls resolvePolicy (task-1-report.md's documented convention for the
      // wiring layer); sim/bot.js's decideMoves/decideRoute each do their own
      // resolvePolicy(policy) as their first step.
      decide: (G, ctx, seat) => decideMoves(G, ctx, seat, policyForSeat(seat)),
      decideRoute: (G, ctx, seat) => decideBotRoute(G, ctx, policyForSeat(seat)),
      isBot: (seat) => this._isBotSeat(seat),
      animBusy: () => !!(this.animator && this.animator.isBusy()),
      getCharacterIds: () => this.activeMod.characters.map(c => c.id),
    });
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
      // Bot auto-pick must run during character select too, not just the game
      // phase's tail below — this phase branch returns before ever reaching it.
      if (this._botDriver) this._botDriver.onUpdate();
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
    this._renderLegend(G, ctx);
    this.renderTokens(G, ctx);
    this.renderPlayerInfo(G, ctx);
    this.renderTurnbox(G, ctx);
    this.renderManage(G, ctx);
    const logLines = this.renderMessages(G);
    this._updateLogUnread(G, logLines);
    this._renderAIResponses();
    this.renderChatPanel(G, ctx);
    this.renderStateModal(G, ctx);
    this.wireActions(G, ctx);
    this._resolveAtlasRoute(G, ctx);
    // After BOTH route resolvers have run for this render (flat: the line above;
    // globe: _updateGlobeOverlay inside renderBoard, earlier in this update) — sync
    // the route-pick chrome modality. See _syncRoutePickChrome.
    this._syncRoutePickChrome();
    // Gutter-mode sync runs BEFORE the chrome-band sizing below — _syncChromeBands
    // reads the `.game--gutters` class this writes to decide whether the chip
    // strip's height still belongs in the TOP band (see that method's doc comment).
    this._syncGutterMode();
    // Chrome-band sizing runs last, after renderPlayerInfo/renderTurnbox have
    // written this render's real chip-strip/action-bar markup — see doc
    // comment on the method for why this is JS-measured instead of a static
    // CSS worst-case default.
    this._syncChromeBands();
    if (this.animator) { this.animator.onState(G); this.animator.afterRender(); }
    // Paced bot-turn stepper (local-bots wiring): single-flight internally, so
    // calling this every render is cheap (no-op unless the current acting seat
    // per deriveActingSeat is bot-controlled and no step is already in flight).
    if (this._botDriver) this._botDriver.onUpdate();
  }

  // Chrome-band sizing (Task 2 review fix; STATIC constants as of Redesign B).
  // `.app--game .board`/`.board--rect` (index.html) size off
  // `calc(100dvh - var(--chrome-top) - var(--chrome-bottom))` instead of the
  // raw viewport, so the full-bleed board never renders underneath the
  // floating chip strip (top) or action bar (bottom).
  // Redesign B root cause (INSTRUMENTED, not guessed — this is the exact
  // 742px -> 630px owner-reported deformation): this method used to call
  // `actionBarEl.getBoundingClientRect().height` on every update() tick, and
  // the turnbox's real height genuinely changes with turn state within a
  // single turn — 96px at rest, 152px in the jail state (ROLL FOR DOUBLES +
  // PAY FINE + disabled END TURN) — so a ROLL that revealed a taller/shorter
  // turnbox visibly resized the board out from under the player mid-turn.
  // Fix: stop measuring. Both bands are fixed constants (CHROME_NARROW_TOP/
  // BOTTOM, CHROME_GUTTER_MARGIN — module scope, top of file) for the entire
  // life of the game screen, reserving the WORST case up front instead of
  // whatever the current state happens to need. This does cost some board
  // size during the ~95% of turns when the bar is shorter than the jail-state
  // worst case (vs the old best-effort-measured size) — an explicit trade of
  // a few px of board for a board that never visibly deforms mid-turn, which
  // is the whole point of this redesign; the resize listener (constructor)
  // still calls this on viewport resize, since a resize genuinely reshapes
  // the available space and IS allowed to resize the board — only
  // STATE-driven (per-turn) resizing was the bug. this._lastChromeTop/
  // _lastChromeBottom still throttle the `style.setProperty` writes (now
  // they only ever fire on a narrow<->gutter mode flip or a resize, not on
  // ordinary gameplay).
  _syncChromeBands() {
    if (!this.gameAreaEl) return;
    const gutters = this.gameAreaEl.classList.contains('game--gutters');
    const top = gutters ? CHROME_GUTTER_MARGIN : CHROME_NARROW_TOP;
    const bottom = gutters ? CHROME_GUTTER_MARGIN : CHROME_NARROW_BOTTOM;
    if (top !== this._lastChromeTop) {
      this._lastChromeTop = top;
      this.gameAreaEl.style.setProperty('--chrome-top', `${top}px`);
    }
    if (bottom !== this._lastChromeBottom) {
      this._lastChromeBottom = bottom;
      this.gameAreaEl.style.setProperty('--chrome-bottom', `${bottom}px`);
    }
    // Rail actionbar clip fix (owner-reported: dice roll's bottom-left half
    // hidden — probe @1890x920: turnbox rect 276px tall vs the actionbar's old
    // static 170px cap). index.html's `.game--gutters .game__actionbar` no
    // longer clips at a fixed worst-case height — it sizes to its REAL content
    // and grows upward from its bottom:8px anchor (safe: it lives entirely in
    // the rail, never touches the board — the deform-bug lock above is
    // untouched). The chip column above it (`.game--gutters .game__chips`)
    // must yield the SAME real height back, or a tall turnbox (jail, or
    // roll -> buy-prompt) would overlap the chips instead of clipping the
    // dice. `--rail-bar-h` carries the actionbar's MEASURED offsetHeight —
    // read here because this method already runs last, after
    // renderPlayerInfo/renderTurnbox have painted this render's real content
    // (see the doc comment above) — to the chip column's CSS
    // `bottom: calc(var(--rail-bar-h) + 16px)`. Same measured-var +
    // throttled-write pattern as --chrome-top/--chrome-bottom just above.
    // Gated on `gutters`: the var is only ever read by gutter-mode CSS, so
    // skip the forced-layout offsetHeight read in narrow mode.
    if (gutters && this.actionBarEl) {
      const railBarH = this.actionBarEl.offsetHeight;
      if (railBarH !== this._lastRailBarH) {
        this._lastRailBarH = railBarH;
        this.gameAreaEl.style.setProperty('--rail-bar-h', `${railBarH}px`);
      }
    }
  }

  // Owner acceptance fix wave, Fix 3 ("wide-screen gutter layout" — the owner's
  // choice for the horizontal voids beside the height-driven square board on
  // wide monitors): when the board leaves a gutter of >=300px on EACH side, fill
  // both voids with UI instead of leaving them blank — index.html's
  // `.game--gutters` rules move the chip strip into a vertical column in the
  // LEFT gutter (full info, no hover needed) and turn the right drawer into a
  // persistent, non-overlay panel in the RIGHT gutter. Below the threshold,
  // layout is untouched (today's floating slim chips + overlay drawer).
  //
  // --gutter-w carries the gutter width the CSS panels are sized FROM, never
  // wider than it, so the zero-overlap invariant holds in both modes.
  //
  // MEASURED, not analytic, would seem the obvious choice (mirroring
  // --chrome-top/--chrome-bottom above) — but it's wrong here, and the bug is
  // real, not theoretical (caught live by tests/e2e/layout.spec.js's gutter
  // test: chips overlapped the board by ~22px on gutter-mode ENTRY). The
  // reason: on the very render gutter mode turns ON, `this.boardEl`'s rect
  // still reflects the OLD, not-yet-shrunk --chrome-top (the shrink happens
  // in _syncChromeBands, called right after this method — see update()) — so
  // a measured board width here is systematically SMALLER, and the gutter
  // computed from it SYSTEMATICALLY BIGGER, than the board will actually be
  // once the top band shrinks a few lines later in the same render. Sizing
  // the chip column off that stale, oversized gutter overlaps the board that
  // grows into the gap immediately after. Computing the POST-shrink board
  // width analytically instead — mirroring `.app--game .board`'s CSS formula
  // (index.html) exactly, with top hardcoded to the same gutter-mode margin
  // constant _syncChromeBands uses — sidesteps the ordering dependency
  // entirely and is correct from the very first gutter-mode render, no
  // convergence lag.
  //
  // Redesign A extension (rect boards — atlas/globe, `.board--rect`): the
  // classic square board's analytic derivation above fundamentally does not
  // apply — that formula measures how much LEFTOVER space a height-driven
  // SQUARE board leaves beside it, but a rect board fills the available
  // width BY DESIGN (no leftover to measure without a circular dependency:
  // the rect board's own width IS "whatever gutter mode decides to leave
  // it"). Two separate concerns, handled separately for a rect board:
  //   1. ON/OFF threshold — probe with the SAME square-equivalent width the
  //      classic board would have at this viewport (purely a "would two
  //      300px rails still leave reasonable room" affordability test, not a
  //      real measurement of the rect board, which never actually renders
  //      that width) — keeps one shared, already-vetted 300px-per-side
  //      threshold for both board types instead of inventing a second
  //      unrelated constant.
  //   2. Rail width once ON — a FIXED constant (GUTTER_RAIL_W, module scope),
  //      not derived: unlike the classic board there is no "centered
  //      leftover" to split in half, so the CSS (`.game--gutters
  //      .board--rect`, index.html) just subtracts two rails of this exact
  //      width from 100dvw directly.
  //
  // Auto-opens the LOG tab exactly once per mode-ENTRY (the `on && !wasOn` edge
  // below, not every render): a user who deliberately closes the drawer while
  // still in gutter mode does not get it reopened out from under them on the
  // next render — the transition check itself is what makes the dismissal
  // "stick" until the mode is left and re-entered, no separate memory flag
  // needed.
  _syncGutterMode() {
    if (!this.gameAreaEl || !this.boardEl || !this.actionBarEl) return;
    const isRect = this.boardEl.classList.contains('board--rect');
    let gutterNow;
    if (isRect) {
      const squareEquivW = Math.min(window.innerWidth,
        window.innerHeight - CHROME_NARROW_TOP - CHROME_NARROW_BOTTOM, 1100);
      gutterNow = (window.innerWidth - squareEquivW) / 2;
    } else {
      // Decide on/off from the board's CURRENTLY rendered width — a simple,
      // non-circular "is there already a wide void" read (whatever this
      // render's chrome-top happens to be doesn't change the ON/OFF verdict
      // by more than a render's worth of chip-strip height, nowhere near the
      // 300px threshold's margin in practice).
      const boardWNow = this.boardEl.getBoundingClientRect().width;
      gutterNow = (window.innerWidth - boardWNow) / 2;
    }
    const on = gutterNow >= 300;
    const wasOn = this.gameAreaEl.classList.contains('game--gutters');
    this.gameAreaEl.classList.toggle('game--gutters', on);
    if (on) {
      // Written on document.documentElement (:root), NOT this.gameAreaEl —
      // latent bug found by instrumentation while fixing the drawer overlap
      // just below (see index.html's `.game--gutters ~ #drawer` doc comment
      // for the full root-cause writeup): CSS custom properties only inherit
      // to DESCENDANTS of the element they're set on, but `#drawer` is a
      // SIBLING of `#game-area` in the DOM (App.js createLayout), not a
      // descendant — a --gutter-w written on gameAreaEl was invisible to
      // #drawer's `var(--gutter-w, 300px)` reference, which silently fell
      // back to the 300px default instead of the real computed value. :root
      // is a shared ancestor of both, so both the rail (inside #game-area)
      // and the drawer (its sibling) see the same real value.
      if (isRect) {
        document.documentElement.style.setProperty('--gutter-w', `${GUTTER_RAIL_W}px`);
      } else {
        // Analytic post-shrink board width — see doc comment above. Must match
        // `.app--game .board`'s CSS formula exactly, or the two drift apart
        // again. top/bottom are both CHROME_GUTTER_MARGIN now (Redesign B:
        // the action bar leaves the bottom-center floating position entirely
        // in gutter mode — see index.html's `.game--gutters .game__actionbar`
        // rule — so there is no longer a real bar height to measure here
        // either).
        const boardWFinal = Math.min(window.innerWidth,
          window.innerHeight - CHROME_GUTTER_MARGIN - CHROME_GUTTER_MARGIN, 1100);
        const gutterFinal = (window.innerWidth - boardWFinal) / 2;
        document.documentElement.style.setProperty('--gutter-w', `${Math.floor(gutterFinal)}px`);
      }
    }
    if (on && !wasOn) this._openDrawer('log');
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
    // Owner acceptance fix wave, Fix 2 ("线条非常凌乱" — rank-fit spread the
    // positions; geographic-adjacency edges now cross the whole board): light
    // up ONLY the pending fork's branch edges instead of dimming/re-coloring
    // the whole network. Per-edge identification turned out cheap rather than
    // invasive — routeChoices() already returns full node-list routes, and
    // consecutive pairs in a path ARE the edges — so this is the primary fix,
    // not the "dim everything, rely on tile pulses" fallback the brief allowed.
    // `<line data-from data-to>` identity is set once at SVG build time in
    // _renderAbsoluteBoard; the base network's near-invisible dim under
    // `.game--routepick` is pure CSS (index.html), this only toggles the
    // `edge--hot` opt-in class (+ swaps the arrowhead marker to the bright
    // variant) on the lines that belong to a reachable branch. routeChoices()
    // omits the player's CURRENT tile from each route, so prepend
    // player.position first — same reasoning as _globeSetRouteArcs's path-
    // building (see that method's doc comment for the globe-side twin of this).
    const hotEdges = new Set();
    choices.forEach(c => {
      const path = [player.position].concat(c.route);
      for (let i = 0; i < path.length - 1; i++) hotEdges.add(`${path[i]}>${path[i + 1]}`);
    });
    this.boardEl.querySelectorAll('.board__edges line[data-from]').forEach(line => {
      const hot = hotEdges.has(`${line.dataset.from}>${line.dataset.to}`);
      line.classList.toggle('edge--hot', hot);
      line.setAttribute('marker-end', hot ? 'url(#atlas-arrow-hot)' : 'url(#atlas-arrow)');
    });
  }

  // ─────────────────────────────────────────────────────────
  // Character select
  // ─────────────────────────────────────────────────────────
  renderCharacterSelect(G, ctx) {
    this.charSelectEl.className = 'screen screen--select';
    const playerNo = parseInt(ctx.currentPlayer) + 1;
    // Bot seats occupy the LAST seats (startGameWithPlayers) and pick in seat
    // order, so a bot never selects before every lower-numbered human seat has —
    // the "PLAYER N" text E2E waits on for human flows (gameplay.spec.js's
    // selectCharacters helper, /PLAYER 2/) is untouched for any all-human game.
    const actingIsBot = this._isBotSeat(ctx.currentPlayer);
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
              <span class="charcard__money">${t('charselect.startMoney')} ${money(startMoney)}</span>
            </div>
          </div>
          <div class="charcard__stats">${statRowsHtml(char.stats, char.color)}</div>
          <div class="charcard__passive">
            <span class="charcard__passive-name">${esc(char.passive.name)}</span>
            <span class="charcard__passive-desc">${esc(char.passive.description)}</span>
          </div>
          <div class="charcard__foot">
            <button class="charcard__lore" data-char-id="${char.id}">${t('charselect.viewLore')}</button>
            ${this.characterAI.apiKey ? `<button class="charcard__ai" data-char-id="${char.id}">${t('charselect.askAI')}</button>` : ''}
            ${taken ? `<span class="charcard__takentag">${t('charselect.taken')}</span>` : (selected ? `<span class="charcard__seltag">${t('charselect.selected')}</span>` : '')}
          </div>
          <div id="char-chat-${char.id}" style="display:none;"></div>
        </div>`;
    });

    const picked = this._pendingCharId ? this.activeMod.characters.find(c => c.id === this._pendingCharId) : null;
    const chosenHtml = picked
      ? `${portraitHtml(picked, 40, false)}<span style="color:${readableNameColor(picked.color)}">${esc(picked.name)}</span><span class="select__chosen-title">${esc(picked.title)}</span>`
      : `<span class="select__chosen-empty">${t('charselect.selectPrompt')}</span>`;

    this.charSelectEl.innerHTML = `
      ${this._breadcrumb('character')}
      <div class="select__head">
        <div class="select__heading">
          <span class="select__p">${actingIsBot ? t('charselect.botPicking') : t('charselect.player', { n: playerNo })}</span>
          <span class="select__h">${t('charselect.heading')}</span>
        </div>
        <div class="select__sub">${t('charselect.subheading')}</div>
      </div>
      <div class="select__grid">${cards}</div>
      <div class="select__bar">
        <button class="pix-btn pix-btn--ghost" id="btn-select-back"><span class="glyph glyph--arrow-back"></span> ${t('charselect.back')}</button>
        <div class="select__chosen">${chosenHtml}</div>
        <button class="pix-btn pix-btn--primary" id="btn-select-confirm" ${picked ? '' : 'disabled'}>${isLast ? t('charselect.beginGame') + ' <span class="glyph glyph--arrow"></span>' : t('charselect.nextPlayer') + ' <span class="glyph glyph--arrow"></span>'}</button>
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
    // Season NAMES: the summer/autumn/winter/spring cycle is an engine constant
    // (identical `seasons.list` ids in every mod today), so the DISPLAY name is a
    // UI-layer lookup keyed by season id (localization brief: seasons are engine
    // constants, not mod flavor). A custom future season id has no season.name.*
    // key — t() then returns the key itself, which the !== check below catches to
    // fall back to the mod's own season.name DATA (t()'s once-per-session missing-
    // key warn doubles as the "this mod ships an unnamed custom season" dev hint).
    const seasonNameKey = 'season.name.' + season.id;
    const seasonNameLookup = t(seasonNameKey);
    const seasonName = seasonNameLookup === seasonNameKey ? season.name : seasonNameLookup;
    let fx = '';
    if (season.priceMod !== 1.0) fx += `<span>${t('season.fxPrice', { v: (season.priceMod > 1 ? '+' : '') + Math.round((season.priceMod - 1) * 100) })}</span>`;
    if (season.rentMod !== 1.0) fx += `<span>${t('season.fxRent', { v: Math.round((season.rentMod - 1) * 100) })}</span>`;
    if (season.taxMod !== 1.0) fx += `<span>${t('season.fxTax', { v: season.taxMod })}</span>`;
    if (RULES.core.freeParkingPot && G.freeParkingPot > 0) fx += `<span>${t('season.fxPot', { v: G.freeParkingPot })}</span>`;

    return `
      <div class="board__logo">
        <span class="board__logo-main">${esc(this.mapData.theme.logoText || 'MEINOPOLY')}</span>
        <span class="board__logo-sub">${esc(this.mapData.theme.logoSubtitle || 'DOMINION · COUNCIL OF WORLDS')}</span>
      </div>
      <div class="board__season">
        <span class="board__season-label">${t('season.label')}</span>
        <span class="board__season-val">${esc(seasonName)}</span>
        <span class="board__season-turns">${t('season.cycle', { c: cycle, i: interval })}${RULES.core.maxTurns > 0 ? ' · ' + t('season.turnOf', { n: G.totalTurns, max: RULES.core.maxTurns }) : ' · ' + t('season.turn', { n: G.totalTurns })}</span>
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
    const total = d ? `<div class="centerslot__total">${t('turnbox.total', { n: d.total })}${d.isDoubles ? ' · ' + t('turnbox.doubles', { n: G.doublesCount }) : ''}</div>` : '';

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
            <button class="pix-btn pix-btn--success pix-btn--sm" id="btn-buy">${t('turnbox.buy')}</button>
            <button class="pix-btn pix-btn--ghost pix-btn--sm" id="btn-pass">${RULES.auction.enabled && RULES.auction.auctionOnPass ? t('turnbox.auction') : t('turnbox.pass')}</button>
          </div>
        </div>`;
    } else {
      let hint = '';
      if (!isMyTurn) hint = t('turnbox.waiting');
      else if (G.awaitingRoute) hint = t('turnbox.chooseRoute');
      else if (player.inJail && !G.hasRolled) hint = t('turnbox.payFineOrRoll');
      else if (!G.hasRolled) hint = t('turnbox.rollToMove');
      else if (G.pendingCard) hint = t('turnbox.resolveCard');
      else if (G.auction) hint = t('turnbox.auctionInProgress');
      else if (G.trade) hint = t('turnbox.tradePending');
      else hint = t('turnbox.endWhenReady');
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
    const challengerName = challenger.character ? challenger.character.name : t('game.playerFallback', { n: parseInt(duel.challengerId) + 1 });
    const ownerName = owner.character ? owner.character.name : t('game.playerFallback', { n: parseInt(duel.ownerId) + 1 });

    if (duel.phase === 'offer') {
      if (!isChallengerTurn) return `<div class="centerslot__hint">${t('turnbox.waiting')}</div>`;
      // blocked via the shared helper (final-review Fix 3 — de-triplication);
      // `cd`/`last` stay local, only needed here for the "N turn(s)" tooltip
      // countdown, which isDuelCooldownBlocked doesn't compute.
      const cd = RULES.duel.cooldownTurns;
      const last = challenger.lastDuelTurn;
      const blocked = isDuelCooldownBlocked(challenger, G.totalTurns);
      const remaining = blocked ? cd - (G.totalTurns - last) : 0;
      return `
        <div class="centerslot__prompt">
          <div class="cp__name">${t('duel.offer', { name: esc(space.name), rent: money(duel.rent) })}</div>
          <div class="cp__btns">
            <button class="pix-btn pix-btn--success pix-btn--sm" id="btn-payrent">${t('duel.payRent')}</button>
            <button class="pix-btn pix-btn--danger pix-btn--sm" id="btn-duel" ${blocked ? `disabled title="${t('duel.cooldown', { n: remaining })}"` : ''}>${t('duel.duel')}</button>
          </div>
        </div>`;
    }

    // phase === 'response'
    const isOwnerSeat = !G.enforceSeats || !this.onlinePlayerID || String(this.onlinePlayerID) === String(duel.ownerId);
    if (!isOwnerSeat) {
      return `<div class="centerslot__hint">${t('duel.waitingResponse', { name: esc(ownerName) })}</div>`;
    }
    const loseAmount = Math.round(RULES.duel.loseMultiplier * duel.rent);
    return `
      <div class="centerslot__prompt">
        <div class="cp__name">${t('duel.challenged', { owner: esc(ownerName), space: esc(space.name) })}</div>
        <div class="cp__info">${t('duel.stakes', { challenger: esc(challengerName), mult: RULES.duel.loseMultiplier, amount: money(loseAmount) })}</div>
        <div class="cp__btns">
          <button class="pix-btn pix-btn--danger pix-btn--sm" id="btn-fight">${t('duel.fight')}</button>
          <button class="pix-btn pix-btn--ghost pix-btn--sm" id="btn-decline">${t('duel.decline')}</button>
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
    const challengerName = challenger.character ? challenger.character.name : t('game.playerFallback', { n: parseInt(challengerId) + 1 });
    const ownerName = owner.character ? owner.character.name : t('game.playerFallback', { n: parseInt(ownerId) + 1 });
    const winnerName = winner.character ? winner.character.name : t('game.playerFallback', { n: parseInt(winnerId) + 1 });
    const cBonus = cr.stamina + cr.luckBonus;
    const dBonus = dr.stamina + dr.luckBonus;
    const outcomeText = outcome === 'waived' ? t('duel.outcomeWaived') : t('duel.outcomePaid', { mult: RULES.duel.loseMultiplier });
    return `
      <div class="turnbox__slot">
        <div class="cp__info">${esc(challengerName)} [${cr.dice[0]}][${cr.dice[1]}]+${cBonus} = ${cr.total} &nbsp;${t('duel.vs')}&nbsp; ${esc(ownerName)} [${dr.dice[0]}][${dr.dice[1]}]+${dBonus} = ${dr.total}</div>
        <div class="cp__info">${t('duel.wins', { name: esc(winnerName), outcome: outcomeText })}</div>
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

    const cls = `tile tile--${edge} tile--t-${space.type} ${isCorner ? 'tile--corner' : ''} ${mortgaged ? 'tile--mortgaged' : ''} ${opts.abs ? 'tile--abs' : ''} ${space.isHub ? 'tile--hub' : ''} ${cityImg ? 'tile--photo' : ''} ${hasOwner ? 'tile--owned' : ''} tile--click`;
    // --ocol lives on the TILE itself (not just the .tile__owner pip strip) so both
    // the tile--owned border AND the .tile__flag (child, inherits the custom prop)
    // can read it. Appended onto opts.style rather than replacing it — opts.style
    // already carries the tile's grid/absolute positioning.
    const styleAttr = (opts.style || '') + (hasOwner ? `--ocol:${ownerColor};` : '');
    const style = styleAttr ? ` style="${styleAttr}"` : '';
    return `<div class="${cls}" data-space="${spaceId}"${style}>${photo}${bar}<div class="tile__inner">${glyph}<span class="tile__name">${esc(space.name)}</span>${price}</div>${owned}${flag}${mort}${pot}</div>`;
  }

  // Human-readable type label for the tile popover header (spec §2.5). Covers
  // every space.type value that either classic boards (mods/dominion/board.js)
  // or atlas worlds (world-loader.js ROLE_TO_TYPE) can produce.
  _tileTypeLabel(space) {
    switch (space.type) {
      case 'go': return t('tile.type.go');
      case 'property': return t('tile.type.property');
      case 'railroad': return t('tile.type.railroad');
      case 'utility': return t('tile.type.utility');
      case 'tax': return t('tile.type.tax');
      case 'chance': return t('tile.type.chance');
      case 'community': return t('tile.type.community');
      case 'jail': return t('tile.type.jail');
      case 'goToJail': return t('tile.type.goToJail');
      case 'parking': return t('tile.type.parking');
      // Unknown types stay RAW DATA (a mod-authored type string), not a t() key.
      default: return String(space.type || '').toUpperCase();
    }
  }

  // Flavor line for non-property corners/specials (spec §2.5: "still show a
  // popover — name + type + flavor line"). Static, engine-flavored text — no
  // per-map authoring surface for this today (classic board.js has no
  // description field on these spaces; atlas worlds don't expand these roles
  // with one either). Tax reuses `space.rent`, which board.js/world-loader.js
  // both (over)load as the tax AMOUNT for type:'tax' spaces (not a rent value —
  // same field, different meaning, pre-existing convention, not introduced here).
  _tileFlavorText(space) {
    switch (space.type) {
      case 'go': return t('tile.flavor.go');
      case 'jail': return t('tile.flavor.jail');
      case 'goToJail': return t('tile.flavor.goToJail');
      case 'chance': return t('tile.flavor.chance');
      case 'community': return t('tile.flavor.community');
      case 'tax': return t('tile.flavor.tax', { amount: space.rent || 0 });
      case 'parking': return RULES.core.freeParkingPot ? t('tile.flavor.parkingPot') : t('tile.flavor.parking');
      default: return null;
    }
  }

  // Sibling chips for the tile popover's group/place section (spec §2.5:
  // "group/place siblings — other spaces of the same color group / placeId").
  // Reuses groupKeyOf (color-first for classic, placeId-first for atlas — same
  // rule Game.js's own groupKeyOf uses) and the SAME .propchip markup/CSS
  // already shipped for renderPlayerInfo's per-player property chips (raw
  // pass-through into tileDetailHtml's groupHtml slot — see that builder's
  // doc comment). '' (not just no siblings) when the space has no group key
  // at all (classic railroads/utilities: color is null, no group).
  _tileGroupHtml(space, G) {
    const gk = groupKeyOf(space);
    if (!gk) return '';
    const siblings = this.boardSpaces.filter(sp => sp && sp.id !== space.id && groupKeyOf(sp) === gk);
    if (!siblings.length) return '';
    return siblings.map(sp => {
      const mort = G.mortgaged[sp.id] || false;
      const barColor = sp.color || (sp.placeId ? placeIdColor(sp.placeId) : 'var(--line)');
      return `<span class="propchip ${mort ? 'propchip--mortgaged' : ''}" style="border-left-color:${barColor}">${esc(sp.name)}</span>`;
    }).join('');
  }

  // Assemble the `d` object for tileDetailHtml (spec §2.5) from a spaceId +
  // live G/ctx. Mirrors _tileHtml's owner/level/mortgaged derivation (same
  // G.ownership/G.buildings/G.mortgaged reads, same _clientChar portrait
  // resolution) rather than reimplementing it, per task-1-report.md's note.
  _tileDetailData(spaceId, G, ctx) {
    const space = this.boardSpaces[spaceId];
    if (!space) return null;

    const owner = G.ownership[spaceId];
    const hasOwner = owner !== null && owner !== undefined;
    const ownerColor = hasOwner ? this._playerColor(G, owner) : '';
    let ownerName = null, ownerPortraitUrl = null;
    if (hasOwner) {
      const ownerPlayer = G.players[Number(owner)];
      const ochar = ownerPlayer && ownerPlayer.character;
      const cchar = ochar && this._clientChar(ochar);
      ownerName = ochar ? ochar.name : t('game.playerFallback', { n: Number(owner) + 1 });
      ownerPortraitUrl = (cchar && cchar.portrait) || null;
    }

    // price:0 on non-property spaces (classic board.js) vs undefined on LIVE
    // atlas maps (world-loader.js only sets .price for property/transit slots)
    // both normalize to null here — the `price > 0` precedent from _tileHtml
    // above (spec §2.5's price-normalization note).
    const price = space.price > 0 ? space.price : null;

    // Atlas place extras (spec §2.5): this.mapData.atlasPlaces is the RAW
    // world places array (mapJson.places, set verbatim in setMap) already
    // scoped to the CURRENTLY ACTIVE map — a more direct route to the same
    // data the brief's "activeMod.worlds place lookup" describes, without
    // re-searching every world the mod ships (avoids ambiguity if two worlds
    // in one mod ever reused a placeId). null for classic boards (no
    // placeId), which gracefully omits every field below (each independently
    // gated by tileDetailHtml).
    const place = (space.placeId && this.mapData.atlasPlaces)
      ? this.mapData.atlasPlaces.find(p => p.id === space.placeId) : null;

    const name = place ? place.realName : space.name;

    let rentText = null;
    if (hasOwner) {
      if (space.type === 'utility') {
        rentText = t('tile.rentVaries'); // calculateRent's utility branch multiplies by diceTotal — a nominal total here would mislead
      } else {
        // Intentional (per brief, task-3-report.md): rent is computed for the
        // CURRENT PLAYER as the hypothetical visitor, not the tile's owner —
        // charisma discounts are per-viewer, so the number shown here is "what
        // it would cost YOU to land here right now," not a fixed property
        // attribute. Not a bug to fix.
        const visitor = G.players[parseInt(ctx.currentPlayer, 10)];
        rentText = `$${calculateRent(G, space, 0, visitor)}`; // railroad/property branches ignore diceTotal — 0 is inert
      }
    }

    return {
      name,
      typeLabel: this._tileTypeLabel(space),
      price,
      ownerName,
      ownerColor,
      ownerPortraitUrl,
      level: G.buildings[spaceId] || 0,
      mortgaged: G.mortgaged[spaceId] || false,
      rentText,
      groupHtml: this._tileGroupHtml(space, G),
      placeStats: place && place.data ? { population: place.data.population, gdp: place.data.gdp, fame: place.data.fame } : null,
      archetypes: place && place.archetypes && place.archetypes.length ? place.archetypes : null,
      description: (place && place.description) || null,
      flavorText: this._tileFlavorText(space),
    };
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

  // R1d: legend cartouche — LIVE rows (neutral + one per non-bankrupt player
  // + tax + chance), colors from the same tables the board glows use. Rebuilt
  // every update like the rest of the HUD; pure builder lives in game-chrome.
  _renderLegend(G, ctx) {
    const el = document.getElementById('board-legend');
    if (!el) return;
    const rows = [{ color: NODE_GLOW_COLORS.neutral, label: t('legend.neutral'), kind: 'neutral' }];
    G.players.forEach((p, i) => {
      if (p.bankrupt) return;
      const name = p.character ? p.character.name : t('game.playerFallback', { n: i + 1 });
      rows.push({ color: this._playerColor(G, i), label: t('legend.territory', { name }), kind: 'player' });
    });
    rows.push({ color: NODE_GLOW_COLORS.tax, label: t('legend.tax'), kind: 'tax' });
    rows.push({ color: NODE_GLOW_COLORS.chance, label: t('legend.chance'), kind: 'chance' });
    el.innerHTML = legendHtml(rows);
  }

  renderBoard(G, ctx) {
    const mode = this.mapData.renderMode;
    // Tear down the globe when we leave globe mode (frees the WebGL context + RAF loop).
    if (mode !== 'globe') this._teardownGlobe();
    if (mode === 'globe') this._renderGlobeBoard(G, ctx);
    else if (this.mapData.layoutType === 'square') this._renderSquareBoard(G, ctx);
    else this._renderAbsoluteBoard(G, ctx);
    // Flat boards paint the per-mod background layer (globe owns its own canvas —
    // _ensureBoardChildren never ran for it, so _syncBoardBg no-ops there).
    if (mode !== 'globe') this._syncBoardBg();
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
    // board--rect (Redesign A): the globe always renders on the rect
    // full-bleed canvas — it has no tile grid of its own (container-type:size
    // is a no-op for it, harmless), just a container the ResizeObserver
    // already feeds independent W/H into (_ensureGlobeResizeObserver above),
    // so it naturally fills a wide rect (sphere centered, more sky) with no
    // further change needed here beyond the class.
    this.boardEl.className = 'board board--globe board--rect';
    this._ensureBoardChildren();

    const places = (this.mapData.atlasPlaces || []).filter(p => p.geo);
    const byId = {};
    places.forEach(p => { byId[p.id] = p; });
    const points = places.map(p => ({ lat: p.geo.lat, lng: p.geo.lng, name: (p.realName || p.id).toUpperCase(), id: p.id }));
    const arcs = [];
    places.forEach(p => {
      if (!p.connectors) return;
      Object.keys(p.connectors).forEach(dir => {
        const target = byId[p.connectors[dir]];
        if (target) arcs.push({ sLat: p.geo.lat, sLng: p.geo.lng, eLat: target.geo.lat, eLng: target.geo.lng, fromId: p.id, toId: target.id, hot: false });
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
        // player rolls into a fork (see _globeSetRouteArcs). 'hot' is set per-arc. The base
        // (non-hot) network is drawn from the FIRST render — hot only ever tightens the
        // filter, it never gates initial visibility (see _globeSetRouteArcs: arcs start
        // hot:false in _renderGlobeBoard and stay that way until a genuine fork). Task 3
        // (spec §2.6) bumped the base opacity/stroke — 0.33 alpha + 0.8px read as
        // near-invisible against the globe texture at rest (owner's original complaint,
        // confirmed live at 1400x900 before this change).
        // Owner acceptance fix wave, Fix 2 ("线条非常凌乱"): Task 3's bump (0.33->0.5,
        // 0.8->1.2) overshot — the owner's later screenshot read as too busy/flat again.
        // Pulled back to a middle, more-restrained resting point (0.35/1.0) that still
        // clears "near-invisible" (Task 3's original bug) while staying clearly dimmer
        // than hot (2.3px, near-solid gold) so the fork highlight keeps its contrast.
        .arcsData(d.arcs)
        .arcColor(a => a.hot ? ['#fff3c0', '#ffd24a'] : 'rgba(233,178,60,0.35)')
        .arcStroke(a => a.hot ? 2.3 : 1.0)
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
      // Delegated click: two things share this one listener (Task 3, spec §2.5b/§2.6).
      //   1. A globe TOKEN click (.gtoken[data-player]) opens the same player-detail
      //      popover as the chip/flat-token click (_openPlayerDetail) — checked first,
      //      stopPropagation + return (mirrors the flat-board token listener).
      //   2. Otherwise: committing a chosen branch at a fork (route picker on the globe) —
      //      UNCHANGED from before this task.
      ov.addEventListener('click', (e) => {
        const tok = e.target.closest('.gtoken[data-player]');
        if (tok) {
          e.stopPropagation();
          this._openPlayerDetail(tok.dataset.player);
          return;
        }
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
    const targets = {};
    choices.forEach(c => {
      const sp = this.boardSpaces[c.node];
      if (sp && sp.placeId) targets[sp.placeId] = c.route;
    });
    return targets;
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
      // #board-legend anchors to the BOARD's bottom-left (R1d) — in the
      // full-bleed layout .game__center spans the viewport under the fixed
      // rails, so anchoring there put the cartouche beneath the actionbar.
      this.boardEl.innerHTML = '<div class="board__bg"></div><div class="board__grid-wrap"></div><div id="token-layer"></div><div id="board-legend" class="wr-panel wr-notch--sm"></div>';
      this._boardBgEl = this.boardEl.querySelector('.board__bg');
      this._gridWrap = this.boardEl.querySelector('.board__grid-wrap');
      this._tokenLayer = this.boardEl.querySelector('#token-layer');
    }
  }

  // Reskin R2: paint the persistent .board__bg layer — per-mod art when the mod
  // ships it (atlas worldBg / classic mapAssets.boardBg), engine starfield
  // otherwise. Replaces the old inline background-image on the absolute grid
  // (one mechanism only, spec §2). Presentation-only.
  _syncBoardBg() {
    if (!this._boardBgEl) return;
    const { url } = resolveBoardBg({
      isAtlas: this.mapData.movementMode === 'atlas',
      atlasAssets: this.mapData.atlasAssets,
      mapAssets: this.mapData.mapAssets,
      mapId: this.mapData.id,
    });
    const finalUrl = url || starfieldDataUri();
    if (this._boardBgUrl !== finalUrl) {
      this._boardBgUrl = finalUrl;
      this._boardBgEl.style.backgroundImage = `url('${finalUrl}')`;
    }
    this.boardEl.classList.toggle('board--hasbg', !!url);
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
    // board--rect (Redesign A): atlas boards render on the rect full-bleed
    // canvas (index.html `.board--rect`) instead of the classic square
    // (aspect-ratio:1/1) constraint. Classic-absolute (circle/hex/custom,
    // movementMode !== 'atlas') is NOT given this class — it keeps the
    // traditional square board untouched, per the redesign brief.
    const isRect = isAtlas;
    this.boardEl.className = isAtlas ? 'board board--atlas board--rect' : 'board';
    this._ensureBoardChildren();
    let tiles = '';
    let halos = '';
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
      // Redesign A: tile SIZE (not position — left/top stay % of the board's
      // independent W/H, that still positions correctly on a non-square
      // board) uses cqmin (the board's own short axis, via container-type:
      // size on .board--rect — index.html) instead of % on rect boards, so
      // tiles stay perfectly square even though the board itself is not. A
      // square board (classic-absolute) doesn't need this — % of W == % of H
      // there already, so it keeps the simpler unit.
      const sizeUnit = isRect ? 'cqmin' : '%';
      const style = `left:${pos.x}%;top:${pos.y}%;width:${size}${sizeUnit};height:${size}${sizeUnit};`;
      tiles += this._tileHtml(i, G, { edge, abs: true, style });
      // R1c: dither-bloom halo under each atlas node — a SIBLING layer (the
      // tile clips overflow, a child halo would be cut off), same pos math,
      // ~1.9x the tile size. bloomSprite memoizes per color|context, and
      // nodeGlow only ever emits enum contexts, so cache stays bounded.
      if (isAtlas) {
        const sp = this.boardSpaces[i];
        const owner = G.ownership[i];
        const ownColor = owner !== null && owner !== undefined ? this._playerColor(G, owner) : null;
        const glow = nodeGlow(sp, ownColor);
        const hs = size * 1.9;
        halos += `<div class="tile-halo" style="left:${pos.x}%;top:${pos.y}%;width:${hs}${sizeUnit};height:${hs}${sizeUnit};background-image:url('${bloomSprite(glow.color, glow.context)}')"></div>`;
      }
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
          // data-from/data-to (line-tidiness fix, acceptance fix wave): gives
          // _resolveAtlasRoute a per-edge identity so it can light up ONLY the
          // pending fork's branch edges (edge--hot) instead of the whole
          // network at once — see that method's doc comment.
          lines += `<line data-from="${from}" data-to="${to}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" marker-end="url(#atlas-arrow)"></line>`;
        });
      });
      edgesSvg = `<svg class="board__edges" viewBox="0 0 100 100" preserveAspectRatio="none">`
        + `<defs>`
        + `<marker id="atlas-arrow" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto">`
        + `<path d="M0,0 L4,2 L0,4 Z" fill="var(--ink-dim)"></path></marker>`
        + `<marker id="atlas-arrow-hot" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto">`
        + `<path d="M0,0 L4,2 L0,4 Z" fill="var(--accent)"></path></marker>`
        + `</defs>`
        + lines + `</svg>`;
    }
    // World art now renders via the persistent .board__bg layer (_syncBoardBg,
    // reskin R2) — the old inline background-image on this grid is retired.
    // Halos paint between the route network and the tiles (edges < halos < tiles).
    this._gridWrap.innerHTML = `<div class="board__grid board__grid--absolute">${edgesSvg}${halos}${tiles}${labels || ''}${center}</div>`;
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
    const tileRect = tile.getBoundingClientRect();
    if (!b.width || !b.height) return { x: 50, y: 50 };
    return {
      x: ((tileRect.left + tileRect.width / 2) - b.left) / b.width * 100,
      y: ((tileRect.top + tileRect.height / 2) - b.top) / b.height * 100,
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

  // Shared player-detail popover opener (spec §2.5b) — the chip-click listener
  // AND both token click listeners (#token-layer + the globe overlay) all
  // funnel through here. Reads the SAME this._chipDetail[idx] cache rebuilt
  // every renderPlayerInfo (one-render-stale freshness contract, same as
  // this._lastG/renderTokens) — no separate d-assembly for tokens, per brief.
  _openPlayerDetail(playerId) {
    const idx = parseInt(playerId, 10);
    const d = this._chipDetail && this._chipDetail[idx];
    if (d) this.openUiModal(chipDetailHtml(d));
  }

  // First-paragraph lore excerpt for the chip/token popover (spec §2.5b).
  // Every mod ships lore (activeMod.getLoreById); `lore.background` is the
  // biography field common to every shipped mod's lore data (verified across
  // every registered mod's lore.js — same shape everywhere). Split
  // on the first blank line (paragraph break) rather than truncating by
  // length, so the excerpt never cuts mid-sentence. esc()'d BEFORE the
  // ** -> <strong> markdown pass (asterisks survive escaping unchanged), same
  // order as the full lore modal's renderLoreText, minus its multi-paragraph/
  // blockquote handling — this is deliberately simpler (one paragraph only).
  _loreParagraphHtml(charId) {
    if (!charId || !this.activeMod || !this.activeMod.getLoreById) return null;
    const lore = this.activeMod.getLoreById(charId);
    if (!lore || !lore.background) return null;
    const first = String(lore.background).split('\n\n')[0].trim();
    if (!first) return null;
    const html = esc(first).replace(/\n/g, '<br/>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    return `<p>${html}</p>`;
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
      const name = char ? char.name : t('game.playerFallback', { n: i + 1 });

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
        if (player.rerollsLeft > 0) abilities.push(t('chip.abilityReroll', { n: player.rerollsLeft }));
        if (player.luckRedraws > 0) abilities.push(t('chip.abilityRedraw', { n: player.luckRedraws }));
        if (player.regulatedProperty !== null && player.regulatedProperty !== undefined) abilities.push(t('chip.abilityReg', { name: this.boardSpaces[player.regulatedProperty].name }));
      }

      html += chipHtml({
        idx: i, name, color,
        portraitUrl: cchar ? cchar.portrait : null,
        money: moneyHtml, hideMoney,
        isCurrent, isBankrupt: !!player.bankrupt,
        deeds: player.properties.length,
        inJail: !!player.inJail,
        isBot: this._isBotSeat(i),
      });

      this._chipDetail[i] = {
        name, title: char ? char.title : '', color,
        portraitUrl: cchar ? cchar.portrait : null,
        moneyHtml, deeds: player.properties.length,
        passiveName: char ? char.passive.name : '',
        passiveDesc: char ? char.passive.description : '',
        abilities, propsHtml: props,
        inJail: !!player.inJail, isBankrupt: !!player.bankrupt, isCurrent,
        // Task 3 (spec §2.5b): first-paragraph lore excerpt, shown in both the
        // chip-click and token-click popovers (same cache, same builder).
        loreHtml: char ? this._loreParagraphHtml(char.id) : null,
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
    const name = char ? char.name : t('game.playerFallback', { n: parseInt(ctx.currentPlayer) + 1 });
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

    // Bot pacing hint (local-bots wiring): whichever seat deriveActingSeat resolves
    // to next — own turn, or a cross-seat blocking state (auction bidder / duel-
    // response owner / pending-trade target) — takes priority over BOTH the atlas
    // duel-response detour just below and the plain isMyTurn gate further down,
    // since a bot never needs an actionable prompt of any kind. Checked before
    // either so no button row (jail/roll/card/duel/trade/end-turn) can ever render
    // for a bot seat; humans' turns are completely unaffected by this branch.
    if (this._isBotSeat(deriveActingSeat(G, ctx))) {
      html += `<div class="turnbox__waiting">${t('turnbox.botThinking')}</div></div>`;
      this.turnboxEl.innerHTML = html;
      return;
    }

    if (isAtlas && isDuelResponse) {
      html += `<div class="turnbox__slot">${this._centerSlotHtml(G, ctx)}</div></div>`;
      this.turnboxEl.innerHTML = html;
      return;
    }

    if (!isMyTurn) {
      html += `<div class="turnbox__waiting">${t('turnbox.waitingFor', { name: esc(name) })}</div></div>`;
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
      html += `<button class="pix-btn pix-btn--primary pix-btn--lg" id="btn-roll">${t('turnbox.rollForDoubles')}</button>`;
      html += `<button class="pix-btn pix-btn--default" id="btn-jail">${t('turnbox.payFine', { fine: RULES.core.jailFine })}</button>`;
    } else if (!G.hasRolled && G.turnPhase === 'roll') {
      html += `<button class="pix-btn pix-btn--primary pix-btn--lg" id="btn-roll">${t('turnbox.rollDice')}</button>`;
    }

    // Card accept/redraw (also surfaced in modal; keep buttons here as fallback)
    if (G.pendingCard) {
      html += `<div class="turnbox__btnrow"><button class="pix-btn pix-btn--success" id="btn-accept-card">${t('card.accept')}</button><button class="pix-btn pix-btn--default" id="btn-redraw-card">${t('card.redraw')}</button></div>`;
    }

    // Reroll
    if (G.hasRolled && player.rerollsLeft > 0 && !G.canBuy && !G.pendingCard && G.turnPhase === 'done') {
      html += `<button class="pix-btn pix-btn--default" id="btn-reroll">${t('turnbox.reroll', { n: player.rerollsLeft })}</button>`;
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
    if (canTrade) html += `<button class="pix-btn pix-btn--default" id="btn-propose-trade">${t('turnbox.trade')}</button>`;
    html += `<button class="pix-btn pix-btn--primary" id="btn-end" ${canEnd ? '' : 'disabled'}>${t('turnbox.endTurn')} &#9656;</button>`;
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
        actions += `<button class="pix-btn pix-btn--default pix-btn--sm btn-unmortgage" data-pid="${pid}">${t('manage.unmort', { v: cost })}</button>`;
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
          if (canSell) actions += `<button class="pix-btn pix-btn--default pix-btn--sm btn-sell" data-pid="${pid}">${t('manage.sell')}</button>`;
        }
        let canMortgage = true;
        if (gk && this.colorGroups[gk]) {
          canMortgage = !this.colorGroups[gk].some(id => (G.buildings[id] || 0) > 0);
        }
        if (canMortgage && level === 0) {
          const val = Math.floor(space.price * RULES.core.mortgageRate);
          actions += `<button class="pix-btn pix-btn--default pix-btn--sm btn-mortgage" data-pid="${pid}">${t('manage.mort', { v: val })}</button>`;
        }
      }

      rows += `<div class="manage__row"><span class="manage__name" style="border-left-color:${space.color || 'var(--line)'}">${esc(space.name)}${level > 0 ? ' ·' + level : ''}${mortgaged ? ' (M)' : ''}</span><span class="manage__actions">${actions}</span></div>`;
    });

    this.manageEl.innerHTML = `<div class="pix-panel"><div class="pix-panel__titlebar"><span class="pix-panel__title">${t('manage.title')}</span></div><div class="pix-panel__body manage">${rows}</div></div>`;
  }

  // Event-driven, locale-aware (spec 2026-07-15-localization-design.md §3):
  // source is G.events (append-only, never reset), not G.messages (a
  // per-turn reset buffer the earlier implementation read) — the log now
  // shows the WHOLE game history, and a LANG flip re-renders that entire
  // history in the new language (renderLogLines re-derives every line from
  // event data on every call, never from a cached string).
  // Returns the rendered { type, kind, text } array (post-merge localization ticket 2:
  // update() below hands this straight to _updateLogUnread instead of it independently
  // re-running renderLogLines over the same G.events/locale/G a second time on every tick
  // the log happens to be open — same inputs, same result, computed twice for nothing).
  // Returns null when the rebuild was skipped (log not visible) — _updateLogUnread falls
  // back to computing its own count in that case, exactly as it always has.
  renderMessages(G) {
    // T4 review Important #2 (perf): the log source is now up to 200 events per
    // rebuild, and update() calls this every state tick — skip the DOM rebuild
    // while the log isn't visible. Unread counting is independent
    // (_updateLogUnread), and _openDrawer('log') re-renders on reveal below.
    if (!(this._drawerOpen && this._drawerTab === 'log')) {
      this._logStale = true;
      return null;
    }
    this._logStale = false;
    const rendered = renderLogLines(G.events, getLocale(), G);
    const lines = rendered.map(({ kind, text }) => (
      `<div class="logline logline--${kind}">${esc(text)}</div>`
    )).reverse().join('');
    this.messagesEl.innerHTML = `<div class="logbox"><div class="logbox__title">${t('log.title')}</div><div class="logbox__list">${lines}</div></div>`;
    return rendered;
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
          <div class="evcard__deck">${deck === 'chance' ? t('tile.type.chance') : t('tile.type.community')}</div>
          <div class="evcard__glyph">${glyphHtml(deck === 'chance' ? 'q' : 'chest')}</div>
          <div class="evcard__text">${esc(card.text)}</div>
          <div class="evcard__tag evcard__tag--${kind}">${kind === 'good' ? t('card.tagGood') : kind === 'bad' ? t('card.tagBad') : t('card.tagNeutral')}</div>
          <div class="evcard__btns">
            <button class="pix-btn pix-btn--primary" id="ev-accept">${t('card.accept')}</button>
            <button class="pix-btn pix-btn--default" id="ev-redraw">${t('card.redraw')}</button>
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
        const nm = p.character ? p.character.name : t('game.playerFallback', { n: parseInt(b.playerId) + 1 });
        const isLead = leaderId !== null && String(leaderId) === String(b.playerId);
        const state = b.passed ? t('auction.pass') : (isLead ? t('auction.stateLeads') : t('auction.stateIn'));
        return `<div class="auction__bidder ${b.passed ? 'out' : ''} ${isLead ? 'lead' : ''}">${tokenHtml(this._playerColor(G, b.playerId), p.character ? p.character.name[0] : parseInt(b.playerId) + 1, true)}<span>${esc(nm)}</span><span class="auction__bstate">${state}</span></div>`;
      }).join('');
      const curName = G.players[currentBidder.playerId].character ? G.players[currentBidder.playerId].character.name : t('game.playerFallback', { n: parseInt(currentBidder.playerId) + 1 });
      this.stateModalBoxEl.innerHTML = `
        <div class="auction">
          <div class="auction__head">${t('auction.title')}</div>
          <div class="auction__lot">
            <span class="auction__bar" style="background:${space.color || 'var(--accent)'}"></span>
            <div class="auction__lotname">${esc(space.name)}</div>
            <div class="auction__listed">${t('auction.listed', { price: space.price })}</div>
          </div>
          <div class="auction__bidbox">
            <span class="auction__bidlabel">${t('auction.currentBid')}</span>
            <span class="auction__bidval">$${a.currentBid || 0}</span>
            <span class="auction__leader">${t('auction.toBid', { name: esc(curName) })}</span>
          </div>
          <div class="auction__bidders">${biddersHtml}</div>
          <div class="auction__bidctl"><input type="number" id="bid-amount" min="${minBid}" value="${minBid}" step="${RULES.auction.minimumIncrement}" /></div>
          <div class="auction__actions">
            <button class="pix-btn pix-btn--ghost" id="btn-pass-auction">${t('auction.pass')}</button>
            <button class="pix-btn pix-btn--primary" id="btn-bid">${t('auction.bid')}</button>
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
      const tr = G.trade; // NOT `t` — that would shadow i18n's t() for this whole block
      const proposer = G.players[tr.proposerId];
      const target = G.players[tr.targetPlayerId];
      const pName = proposer.character ? proposer.character.name : t('game.playerFallback', { n: parseInt(tr.proposerId) + 1 });
      const tName = target.character ? target.character.name : t('game.playerFallback', { n: parseInt(tr.targetPlayerId) + 1 });
      const propList = (ids, mny) => {
        let h = ids.map(pid => `<div class="trade__prop"><span class="trade__propbar" style="background:${this.boardSpaces[pid].color || 'var(--ink-dim)'}"></span><span class="trade__propname">${esc(this.boardSpaces[pid].name)}</span></div>`).join('');
        if (mny > 0) h += `<div class="trade__prop"><span class="trade__propname">${money(mny)}</span></div>`;
        return h || `<div class="trade__empty">${t('trade.nothing')}</div>`;
      };
      this.stateModalBoxEl.innerHTML = `
        <div class="trade">
          <div class="trade__head">${t('trade.proposalTitle')}</div>
          <div class="trade__cols">
            <div class="trade__side">
              <div class="trade__sidehead">${tokenHtml(this._playerColor(G, tr.proposerId), proposer.character ? proposer.character.name[0] : parseInt(tr.proposerId) + 1, true)}<span style="color:${this._playerColor(G, tr.proposerId)}">${esc(pName)}</span></div>
              <div class="trade__proplist">${propList(tr.offeredProperties, tr.offeredMoney)}</div>
            </div>
            <div class="trade__swap">${glyphHtml('swap')}</div>
            <div class="trade__side">
              <div class="trade__sidehead">${tokenHtml(this._playerColor(G, tr.targetPlayerId), target.character ? target.character.name[0] : parseInt(tr.targetPlayerId) + 1, true)}<span style="color:${this._playerColor(G, tr.targetPlayerId)}">${esc(tName)}</span></div>
              <div class="trade__proplist">${propList(tr.requestedProperties, tr.requestedMoney)}</div>
            </div>
          </div>
          <div class="trade__actions">
            <button class="pix-btn pix-btn--ghost" id="btn-cancel-trade">${t('trade.cancel')}</button>
            <button class="pix-btn pix-btn--danger" id="btn-reject-trade">${t('trade.reject')}</button>
            <button class="pix-btn pix-btn--success" id="btn-accept-trade">${t('trade.accept')}</button>
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
    const wName = wChar ? wChar.name : t('game.playerFallback', { n: wIdx + 1 });
    const wColor = this._playerColor(G, wIdx);

    let reason;
    if (ctx.gameover.reason === 'dominion') reason = t('results.reasonDominion', { name: wName, groups: winnerEntry.groups });
    else if (ctx.gameover.reason === 'maxTurns') reason = t('results.reasonMaxTurns');
    else if (ctx.gameover.reason === 'survival') reason = t('results.reasonSurvival', { name: wName });
    else reason = t('results.reasonDefault', { name: wName });

    const rows = standings.map((s, idx) => {
      const i = parseInt(s.id);
      const ch = G.players[i].character;
      const nm = ch ? ch.name : t('game.playerFallback', { n: i + 1 });
      const col = this._playerColor(G, i);
      return `<div class="standrow">
        <span class="standrow__rank">${idx + 1}</span>
        ${tokenHtml(col, ch ? ch.name[0] : i + 1, true)}
        <span class="standrow__name" style="color:${col}">${esc(nm)}</span>
        <span class="standrow__props">${s.props} ${t('results.propsWord')}</span>
        <span class="standrow__net">${money(s.score)}</span>
      </div>`;
    }).join('');

    this.resultsEl.className = 'screen screen--results';
    this.resultsEl.innerHTML = `
      <div class="results__crown">${glyphHtml('crown')}</div>
      <div class="results__victory">${t('results.victory')}</div>
      ${portraitHtml(wChar, 120, true)}
      <div class="results__winner" style="color:${wColor}">${esc(wName)}</div>
      <div class="results__sub">${esc(reason)}</div>
      <div class="pix-panel results__table">
        <div class="pix-panel__titlebar"><span class="pix-panel__title">${t('results.finalStandings')}</span></div>
        <div class="pix-panel__body">${rows}</div>
      </div>
      <button class="pix-btn pix-btn--primary pix-btn--lg" id="btn-replay">${t('results.playAgain')}</button>
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
    // Section LABELS are UI copy (t()); the lore TEXT itself is mod data, untouched.
    const sections = `
      <div class="lore__sectlabel">${t('lore.background')}</div>
      <div class="lore__body">${renderLoreText(lore.background)}</div>
      ${lore.noticed ? `<div class="lore__sectlabel">${t('lore.noticed')}</div><div class="lore__body">${renderLoreText(lore.noticed)}</div>` : ''}
      <div class="lore__sectlabel">${t('lore.joining')}</div>
      <div class="lore__body">${renderLoreText(lore.joining)}</div>
      <div class="lore__sectlabel">${t('lore.style')}</div>
      <div class="lore__body">${lore.styleIntro ? renderLoreText(lore.styleIntro) : ''}<ol>${lore.style.map(s => `<li>${s.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</li>`).join('')}</ol>${lore.styleOutro ? renderLoreText(lore.styleOutro) : ''}</div>
      <div class="lore__sectlabel">${t('lore.relationships')}</div>
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
          <div class="lore__sectlabel">${t('lore.passive')} · ${esc(char.passive.name)}</div>
          <div class="lore__passive">${esc(char.passive.description)}</div>
          <div class="lore__sectlabel">${t('lore.startingCapital')}</div>
          <div class="lore__money">${money(startMoney)}</div>
          ${sections}
          <div class="lore__close"><button class="pix-btn pix-btn--primary" id="btn-lore-close">${t('lore.close')}</button></div>
        </div>
      </div>`, true);
    document.getElementById('btn-lore-close').onclick = () => this.closeUiModal();
  }

  showAISettings() {
    const connected = !!this.characterAI.apiKey;
    this.openUiModal(`
      <div class="aiset">
        <div class="aiset__head">${t('aiset.title')}</div>
        <div class="aiset__status ${connected ? 'on' : 'off'}">${connected ? t('aiset.connected') : t('aiset.noKey')}</div>
        <div class="aiset__field">
          <span class="aiset__label">${t('aiset.apiKeyLabel')}</span>
          <input type="password" id="ai-key-input" placeholder="sk-..." value="${esc(this.characterAI.apiKey)}" />
          <span class="aiset__hint">${t('aiset.keyHint')}</span>
        </div>
        <div class="aiset__field">
          <span class="aiset__label">${t('aiset.verbosityLabel')}</span>
          <select id="ai-verbosity-select">
            <option value="off">${t('aiset.verbosityOff')}</option>
            <option value="major">${t('aiset.verbosityMajor')}</option>
            <option value="all">${t('aiset.verbosityAll')}</option>
          </select>
          <span class="aiset__hint">${t('aiset.verbosityHint')}</span>
        </div>
        <div class="aiset__actions">
          <button class="pix-btn pix-btn--ghost" id="btn-ai-cancel">${t('aiset.cancel')}</button>
          <button class="pix-btn pix-btn--primary" id="btn-ai-save">${t('aiset.save')}</button>
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
      body = `<div class="saves__empty">${t('saves.empty')}</div>`;
    } else {
      body = entries.map(([name, data]) => {
        const date = new Date(data.timestamp).toLocaleString();
        return `<div class="saves__row">
          <div><div class="saves__name">${esc(name.replace('meinopoly_save_', ''))}</div><div class="saves__meta">${data.numPlayers} ${t('saves.playersWord')} · ${t('saves.turnWord')} ${data.G.totalTurns} · ${esc(date)}</div></div>
          <div class="saves__actions"><button class="pix-btn pix-btn--success pix-btn--sm btn-load-save" data-save="${esc(name)}">${t('saves.load')}</button><button class="pix-btn pix-btn--danger pix-btn--sm btn-delete-save" data-save="${esc(name)}">${t('saves.delete')}</button></div>
        </div>`;
      }).join('');
    }
    this.openUiModal(`<div class="saves"><div class="saves__head">${t('saves.heading')}</div>${body}<div class="aiset__actions"><button class="pix-btn pix-btn--ghost" id="btn-saves-close">${t('saves.close')}</button></div></div>`);
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
    const pName = player.character ? player.character.name : t('game.playerFallback', { n: parseInt(ctx.currentPlayer) + 1 });
    const tName = target.character ? target.character.name : t('game.playerFallback', { n: parseInt(target.id) + 1 });
    const pColor = this._playerColor(G, ctx.currentPlayer);
    const tColor = this._playerColor(G, target.id);

    const sideHtml = (props, picks, who) => {
      if (props.length === 0) return `<div class="trade__empty">${t('trade.noDeeds')}</div>`;
      return props.map(sp => `<button class="trade__prop ${picks.includes(sp.id) ? 'on' : ''}" data-side="${who}" data-pid="${sp.id}"><span class="trade__propbar" style="background:${sp.color || 'var(--ink-dim)'}"></span><span class="trade__propname">${esc(sp.name)}</span><span class="trade__propprice">$${sp.price}</span></button>`).join('');
    };
    const cashHtml = (who, val) => RULES.trading.allowMoneyInTrade
      ? `<div class="trade__cash"><span>${t('trade.cash')}</span><div class="trade__cashctl"><button data-cash="${who}" data-d="-50">−</button><span class="trade__cashval">$${val}</span><button data-cash="${who}" data-d="50">+</button></div></div>`
      : '';

    const fair = s.myPicks.length + s.myCash / 100 - s.oppPicks.length - s.oppCash / 100;
    const balCls = fair > 0.5 ? 'pos' : fair < -0.5 ? 'neg' : 'even';
    const balTxt = fair > 0.5 ? t('trade.balPos') : fair < -0.5 ? t('trade.balNeg') : t('trade.balEven');

    const targetSelector = opponents.length > 1
      ? `<div class="trade__target">${t('trade.with')} <select id="trade-target-select">${opponents.map((o, i) => `<option value="${i}" ${i === selectedIndex ? 'selected' : ''}>${esc(o.character ? o.character.name : t('game.playerFallback', { n: parseInt(o.id) + 1 }))}</option>`).join('')}</select></div>`
      : '';

    this.openUiModal(`
      <div class="trade">
        <div class="trade__head">${t('trade.builderTitle')}</div>
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
        <div class="trade__bal"><span>${t('trade.balance')}</span><span class="trade__balval ${balCls}">${balTxt}</span></div>
        <div class="trade__actions">
          <button class="pix-btn pix-btn--ghost" id="btn-trade-cancel">${t('trade.cancel')}</button>
          <button class="pix-btn pix-btn--primary" id="btn-trade-send">${t('trade.send')} &#9656;</button>
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
        ? `<div class="aibubble__loading">${t('ai.thinking')}</div>`
        : `<div class="aibubble__text">${esc(r.text)}</div>`;
      items += `<div class="aibubble">${avatar}<div class="aibubble__body"><div class="aibubble__name" style="color:${readableNameColor(r.charColor)}">${esc(r.charName)}</div>${textHtml}</div></div>`;
    });
    this.aiResponsesEl.innerHTML = `<div class="airesp"><div class="airesp__title">${t('ai.councilChatter')}</div><div class="airesp__list">${items}</div></div>`;
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
      msgs = `<div class="chat__empty">${t('chat.start', { name: esc(activeChar.name) })}</div>`;
    } else {
      // AI REPLY content (m.content) is OpenAI output — data, never localized.
      msgs = history.map(m => m.role === 'user'
        ? `<div class="chat__msg user"><div class="chat__sender">${t('chat.you')}</div>${esc(m.content)}</div>`
        : `<div class="chat__msg ai"><div class="chat__sender" style="color:${readableNameColor(activeChar.color)}">${esc(activeChar.name)}</div>${esc(m.content)}</div>`).join('');
    }

    const disabled = !this.characterAI.apiKey ? 'disabled' : '';
    const placeholder = !this.characterAI.apiKey ? t('chat.setKey') : t('chat.typeMessage');
    this.chatPanelEl.innerHTML = `
      <div class="chat">
        <div class="chat__title">${t('chat.title')}</div>
        <div class="chat__tabs">${tabs}</div>
        <div class="chat__msgs" id="chat-scroll">${msgs}</div>
        <div class="chat__inputrow">
          <input type="text" id="chat-input" placeholder="${placeholder}" ${disabled} />
          <button class="pix-btn pix-btn--primary pix-btn--sm" id="btn-chat-send" ${disabled}>${t('chat.send')}</button>
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
    // Localized at PUSH time (stored in history) — a later LANG flip won't retranslate
    // this one line; acceptable, it's transient client-local feedback, not wire data.
    history.push({ role: 'assistant', content: response || t('chat.noResponse') });
    this.renderChatPanel(G, ctx);
  }

  async _charSelectIntro(charId) {
    if (!this.characterAI.apiKey) return;
    const char = this.activeMod.characters.find(c => c.id === charId);
    if (!char) return;
    const lore = this.activeMod.getLoreById(charId);
    const chatEl = document.getElementById('char-chat-' + charId);
    if (chatEl) { chatEl.style.display = 'block'; chatEl.innerHTML = `<div class="charcard__intro">${t('ai.thinking')}</div>`; }
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
    // Driver's lifetime always mirrors the client's — stop (epoch bump, cancel
    // any pending timer) AND null the reference here, the ONE spot every
    // teardown path funnels through (exitToMenu, loadGame's pre-rebuild stop,
    // _softExitTo), so a stray driver from a prior local game can never survive
    // into whatever comes next (a fresh local game rebuilds it; an online game
    // never builds one at all).
    if (this._botDriver) { this._botDriver.stop(); this._botDriver = null; }
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
    this.botSeats = new Set(); // no bot badges/hints should ever leak into the next menu visit
    this.pendingBots = 0;
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
        this.saveBtnEl.textContent = t('topbar.rolling');
        setTimeout(() => { if (this.saveBtnEl) this.saveBtnEl.textContent = prev; }, 1000);
      }
      return;
    }
    const saveData = { G: G, currentPlayer: ctx.currentPlayer, numPlayers: G.players.length, modId: this.activeMod.id, mapId: this.mapData.id, timestamp: Date.now(), botSeats: [...this.botSeats] };
    const saveName = `meinopoly_save_${new Date().toLocaleString().replace(/[/:]/g, '-')}`;
    const saves = JSON.parse(localStorage.getItem('meinopoly_saves') || '{}');
    saves[saveName] = saveData;
    localStorage.setItem('meinopoly_saves', JSON.stringify(saves));
    // G is boardgame.io's frozen live state — never mutate it here. Confirm via the button.
    if (this.saveBtnEl) {
      const prev = this.saveBtnEl.textContent;
      this.saveBtnEl.textContent = t('topbar.saved');
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
    // Final-review Minor #2: a long game's seen-count would suppress a shorter
    // loaded game's unread dot (amplified by T4's full-history counting) —
    // exitToMenu resets this; the direct-load path must too.
    this._logSeenCount = 0;
    this.activeChatCharId = null;
    this._lastEventSeq = undefined;
    if (this.aiResponsesEl) this.aiResponsesEl.innerHTML = '';
    if (this.chatPanelEl) this.chatPanelEl.innerHTML = '';
    const savedG = saveData.G;
    // _resumeLoad: tells turn.onBegin to skip the turn/season bump on the first turn after load.
    const LoadedGame = { ...Monopoly, setup: () => ({ ...savedG, events: savedG.events || [], eventSeq: savedG.eventSeq || 0, enforceSeats: savedG.enforceSeats || false, _resumeLoad: true }) };
    this.client = Client({ game: LoadedGame, numPlayers: saveData.numPlayers, debug: false });
    this.client.start();
    // Restore bot seats (absent field -> empty set, e.g. pre-bots saves) and rebuild
    // the driver against THIS client — same build-after-start ordering as
    // startGameWithPlayers. _stopClient() a few lines up already stopped + nulled
    // whatever driver belonged to the PRIOR client (if any was active).
    this.botSeats = new Set(saveData.botSeats || []);
    this._buildBotDriver();
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
