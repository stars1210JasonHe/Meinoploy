// game-chrome.js — pure HTML builders for the map-dominant in-game chrome
// (top chip strip / bottom action bar / right drawer), spec 2026-07-12.
// entry-ui.js precedent: pure string builders, unit-tested without DOM.
// This module must NOT import DOM, App.js, images, or boardgame.io.
// i18n's t() IS allowed (localization spec §2: pure lookup, same convention
// as esc() below — imported directly rather than threaded through params).

import { t } from './i18n';

function esc(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Top chip strip — one per player. Carries the .pcard class family so existing
// CSS + the 30-spec Playwright E2E contract (pcard--chip / pcard--active /
// pcard--bankrupt / pcard__name / pcard__money / pcard__turn) keeps working.
// `p.money` arrives PRE-FORMATTED raw HTML (App's money() helper already handled the
// Ophelia hideMoney case upstream — masked runs come through as the SAME dim/pixel-styled
// '???' markup the popover uses, not a plain string) — always render it verbatim; chipHtml
// does not re-derive a masked display from p.hideMoney (Task-2 fix-wave: the old
// `p.hideMoney ? '???' : p.money` branch discarded the pre-masked html's styling).
export function chipHtml(p) {
  const letter = esc((p.name || '')[0] || String(p.idx + 1));
  const face = p.portraitUrl
    ? `<img class="chip__face" src="${esc(p.portraitUrl)}" alt="">`
    : `<span class="chip__face chip__face--letter" style="--tcol:${esc(p.color)}">${letter}</span>`;
  return `
    <div class="pcard pcard--chip wr-panel wr-notch ${p.isCurrent ? 'pcard--active' : ''} ${p.isBankrupt ? 'pcard--bankrupt' : ''}"
         style="--pc:${esc(p.color)}" data-chip="${p.idx}">
      ${face}
      <span class="pcard__name" style="color:${esc(p.color)}">${esc(p.name)}</span>
      <span class="pcard__money">${p.money}</span>
      <span class="chip__deeds">${p.deeds}D</span>
      ${p.isCurrent ? `<span class="pcard__turn">${t('chip.turn')}</span>` : ''}
      ${p.isBankrupt ? `<span class="pcard__bankrupt">${t('chip.out')}</span>` : ''}
      ${p.inJail ? `<span class="pcard__jail">${t('chip.jail')}</span>` : ''}
      ${p.isBot ? `<span class="pcard__bot">${t('chip.bot')}</span>` : ''}
    </div>`;
}

// Popover detail card — the full pcard body, opened when a chip is clicked.
// Content mirrors App.js renderPlayerInfo's tall pcard (name/title/money/deeds/
// abilities/passive/propchips) verbatim; propsHtml arrives pre-built (App keeps
// building it — needs boardSpaces access this module intentionally lacks).
//
// Task 2 review carry-forward: the `d` interface originally omitted inJail/
// isBankrupt/isCurrent, silently dropping the live tall pcard's IN JAIL /
// OUT / TURN status badges (App.js renderPlayerInfo ~1775-1783) from the
// popover. Extended below with the SAME class names so status stays visible.
export function chipDetailHtml(d) {
  const face = d.portraitUrl
    ? `<img class="chip-detail__face" src="${esc(d.portraitUrl)}" alt="">`
    : `<span class="chip-detail__face chip-detail__face--letter" style="--tcol:${esc(d.color)}">${esc((d.name || '')[0] || '?')}</span>`;
  const abilities = (d.abilities || []);
  return `
    <div class="chip-detail" style="--pc:${esc(d.color)}">
      <div class="chip-detail__head">
        ${face}
        <div class="chip-detail__id">
          <span class="pcard__name" style="color:${esc(d.color)}">${esc(d.name)}</span>
          ${d.title ? `<span class="pcard__title">${esc(d.title)}</span>` : ''}
        </div>
        ${d.isCurrent ? `<span class="pcard__turn">${t('chip.turn')}</span>` : ''}
        ${d.isBankrupt ? `<span class="pcard__bankrupt">${t('chip.out')}</span>` : ''}
      </div>
      <div class="pcard__money">${d.moneyHtml || ''}</div>
      <div class="pcard__meta">
        <span>${t('chip.deeds', { n: d.deeds })}</span>
        ${d.passiveName ? `<span class="pcard__passive" title="${esc(d.passiveDesc || '')}">${esc(d.passiveName)}</span>` : ''}
      </div>
      ${d.inJail ? `<div class="pcard__jail">${t('chip.inJail')}</div>` : ''}
      ${abilities.length ? `<div class="pcard__abilities">${abilities.map(esc).join(' · ')}</div>` : ''}
      ${d.propsHtml ? `<div class="pcard__props">${d.propsHtml}</div>` : ''}
      ${
        // loreHtml: RAW pass-through — App escapes/truncates upstream (same contract as propsHtml/groupHtml).
        d.loreHtml ? `<div class="chip-detail__lore">${d.loreHtml}</div>` : ''
      }
    </div>`;
}

// ─────────────────────────────────────────────────────────────────────────
// Dialogue system UI (MT2-SP4 direction B, T3) — speech bubble content.
// Keyless-safe (reads only strings App already resolved off the live
// dialogueLedger — no network, no engine access).
// ─────────────────────────────────────────────────────────────────────────

// d: { idx (player index, matches chipHtml's data-chip), seq (monotonic bubble
// counter — App uses this to decide whether an existing DOM node can be left
// alone or must be replaced, so its own CSS pop-in animation doesn't restart
// on unrelated re-renders), text, color }. App owns ALL positioning (fixed
// overlay, getBoundingClientRect against the anchor chip) — this builder only
// returns the bubble's own content, never inline position styles.
export function bubbleHtml(d) {
  return `<div class="dbubble" data-bubble-owner="${esc(d.idx)}" data-bubble-seq="${esc(d.seq)}" style="--pc:${esc(d.color || '')}">
    <div class="dbubble__text">${esc(d.text)}</div>
    <div class="dbubble__tail"></div>
  </div>`;
}

// Resolve the tile popover's `description` field (ticket: classic-board place
// descriptions in the tile popover). App.js's _tileDetailData previously only
// ever surfaced `place.description` (the atlas world-place lookup, gated on
// space.placeId) — classic board spaces have no placeId, so `place` is always
// null for them and the popover's description section silently never
// appeared, even after the 2026-07-16 content wave started emitting
// `spaces[i].description` on generated classic maps (createmod/smart/board.js
// deriveClassicBoard). Atlas behavior is UNCHANGED: whenever `place` resolved
// (non-null), its .description is used exactly as before, even when falsy —
// classic spaces (place === null) now fall back to the space's own
// .description instead of going straight to null.
export function resolveTileDescription(place, space) {
  return (place ? place.description : (space && space.description)) || null;
}

// Tile detail popover — opened when a board tile is clicked. Same GB-pixel
// class-family style as chipDetailHtml, rooted at .tile-detail (E2E asserts
// this class is present). `groupHtml` is the ONLY raw pass-through field
// (App pre-builds sibling-in-color-group chips, mirroring propsHtml above);
// every other user-influenced string (name/typeLabel/ownerName/description/
// flavorText/archetypes entries/rentText) is esc()'d here, even rentText —
// it arrives PRE-FORMATTED by App from a number ("$120"/"varies by dice"),
// but escaping it is cheap and keeps this builder's discipline uniform.
//
// `price` gates the whole "ownable" block (price line, owner section, level
// pips, mortgaged badge): non-property corner spaces (GO, jail, etc.) pass
// price: null and rely on flavorText alone, per spec. placeStats/archetypes/
// description/flavorText/groupHtml/rentText are each independently optional —
// null/'' means the section is fully absent from the html, not just empty.
export function tileDetailHtml(d) {
  const isOwnable = d.price != null;

  const priceHtml = isOwnable ? `<div class="tile-detail__price">$${esc(d.price)}</div>` : '';

  let ownerHtml = '';
  if (isOwnable) {
    if (d.ownerName) {
      const face = d.ownerPortraitUrl
        ? `<img class="tile-detail__owner-face" src="${esc(d.ownerPortraitUrl)}" alt="">`
        : '';
      ownerHtml = `<div class="tile-detail__owner">${face}<span class="tile-detail__owner-name" style="color:${esc(d.ownerColor)}">${esc(d.ownerName)}</span></div>`;
    } else {
      ownerHtml = `<div class="tile-detail__owner tile-detail__owner--unowned">${t('tile.unowned')}</div>`;
    }
  }

  let pipsHtml = '';
  if (isOwnable) {
    const level = d.level || 0;
    let pips = '';
    for (let i = 0; i < level; i++) pips += '<span class="tile-detail__pip"></span>';
    pipsHtml = `<div class="tile-detail__level">${pips}</div>`;
  }

  const mortgagedHtml = (isOwnable && d.mortgaged) ? `<div class="tile-detail__mortgaged">${t('tile.mortgaged')}</div>` : '';

  const rentHtml = d.rentText ? `<div class="tile-detail__rent">${t('tile.rent', { rent: esc(d.rentText) })}</div>` : '';

  const stats = d.placeStats;
  const statsHtml = stats
    ? `<div class="tile-detail__stats">
        <span class="tile-detail__stat">${t('tile.pop', { v: esc(stats.population) })}</span>
        <span class="tile-detail__stat">${t('tile.gdp', { v: esc(stats.gdp) })}</span>
        <span class="tile-detail__stat">${t('tile.fame', { v: esc(stats.fame) })}</span>
      </div>`
    : '';

  const archetypesHtml = (d.archetypes && d.archetypes.length)
    ? `<div class="tile-detail__archetypes">${d.archetypes.map(a => `<span class="tile-detail__archetype">${esc(a)}</span>`).join('')}</div>`
    : '';

  const descriptionHtml = d.description ? `<div class="tile-detail__description">${esc(d.description)}</div>` : '';

  const flavorHtml = d.flavorText ? `<div class="tile-detail__flavor">${esc(d.flavorText)}</div>` : '';

  // groupHtml: RAW pass-through, same discipline as propsHtml in chipDetailHtml.
  const groupHtml = d.groupHtml ? `<div class="tile-detail__group">${d.groupHtml}</div>` : '';

  return `
    <div class="tile-detail">
      <div class="tile-detail__head">
        <span class="tile-detail__name">${esc(d.name)}</span>
        <span class="tile-detail__type">${esc(d.typeLabel)}</span>
      </div>
      ${priceHtml}
      ${ownerHtml}
      ${pipsHtml}
      ${mortgagedHtml}
      ${rentHtml}
      ${statsHtml}
      ${archetypesHtml}
      ${descriptionHtml}
      ${flavorHtml}
      ${groupHtml}
    </div>`;
}

// Right drawer shell — tab rail + panel container. Section divs (#log,
// #ai-responses, #chat-panel, #manage) and #btn-exit-foot are ALWAYS present
// in the DOM (render functions write into them every update regardless of
// whether the drawer is open), so they live inside this single builder.
//
// As-built shape: ONE builder returning BOTH the tab rail markup and the
// drawer panel markup concatenated as a single string. Task 2's template can
// still split the tabs into `.game__center` and the panel as a sibling of
// `#game-area` by parsing out the two top-level wrapper elements
// (`.drawer-tabs` and `.drawer`) — see task-1-report.md for the exact split
// points if Task 2 needs them as separate DOM insertions.
export function drawerShellHtml() {
  return `
    <div class="drawer-tabs">
      <button class="drawer-tabs__btn" data-tab="log">${t('drawer.log')}<span class="drawer-tabs__dot" hidden></span></button>
      <button class="drawer-tabs__btn" data-tab="chat">${t('drawer.chat')}</button>
      <button class="drawer-tabs__btn" data-tab="manage">${t('drawer.manage')}</button>
    </div>
    <div class="drawer" id="drawer">
      <div id="manage"></div>
      <div id="ai-responses"></div>
      <div id="chat-panel"></div>
      <div id="log"></div>
      <div class="drawer__foot">
        <button id="btn-exit-foot" class="pix-btn pix-btn--ghost pix-btn--full pix-btn--sm">${t('drawer.exitToMenu')}</button>
      </div>
    </div>`;
}

// Shared portrait-vs-letter decision for board tokens. Pure: returns RAW data
// pieces, no DOM, NO HTML escaping. Consumed by both token renderers (Task 3:
// App.js renderTokens for the flat/grid board, _updateGlobeOverlay for the
// globe) — both apply the result via DOM PROPERTY assignments (el.style.
// backgroundImage, el.style.setProperty('--tcol', ...), el.textContent,
// el.classList.toggle(<face-class>, !!v.portraitUrl)), never via innerHTML/
// attribute strings. Property assignment needs NO escaping, so this function
// must NOT esc() its output — entity-escaped text landing in textContent would
// double-escape (a name starting with "<" would literally render "&lt;").
// Task 1 originally returned an HTML-flavored {style, className} pair; Task 3
// review found both real consumers assign via textContent, so the contract
// was rebuilt around raw pieces instead (see task-3-report.md).
export function tokenVisual(char, color, fallbackLabel) {
  if (char && char.portrait) {
    return { portraitUrl: char.portrait, color, text: '' };
  }
  const text = char && char.name ? char.name[0] : String(fallbackLabel);
  return { portraitUrl: null, color, text };
}

// R1c: dither-bloom glow per atlas node — color by type (mockup glowColor
// table), owner neon overriding; context is a BLOOM_CONTEXTS key (fixed enum,
// wr-bloom): hubs use the wider 'hub' halo, GO uses 'start', ownership only
// brightens alpha via 'nodeOwned' — never a continuous per-instance value.
export const NODE_GLOW_COLORS = Object.freeze({
  neutral: '#4fe3ff', // cyan — unowned ownables
  tax: '#ff8a3d',
  chance: '#a97bff',
  start: '#ffb648',
  dim: '#5c7690', // jail / parking / other non-play specials
});

// R1d: legend cartouche rows (mockup .legend) — bottom-left board overlay.
// rows: [{ color, label, kind: 'neutral'|'player'|'tax'|'chance' }] — the
// App builds them LIVE (one player row per non-bankrupt seat), never static copy.
export function legendHtml(rows) {
  const body = (rows || []).map(r =>
    `<div class="legend__row legend__row--${esc(r.kind)}" style="--dot:${esc(r.color)}">
       <span class="legend__dot"></span><span class="legend__label">${esc(r.label)}</span>
     </div>`).join('');
  return `<div class="legend__title">${t('legend.title')}</div>${body}`;
}

export function nodeGlow(space, ownerColor) {
  const context = space.isHub ? 'hub' : (space.type === 'go' ? 'start' : (ownerColor ? 'nodeOwned' : 'node'));
  if (ownerColor) return { color: ownerColor, context };
  switch (space.type) {
    case 'property': case 'railroad': case 'utility':
      return { color: NODE_GLOW_COLORS.neutral, context };
    case 'tax': return { color: NODE_GLOW_COLORS.tax, context };
    case 'chance': case 'community': return { color: NODE_GLOW_COLORS.chance, context };
    case 'go': return { color: NODE_GLOW_COLORS.start, context };
    default: return { color: NODE_GLOW_COLORS.dim, context };
  }
}
