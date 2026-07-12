// game-chrome.js — pure HTML builders for the map-dominant in-game chrome
// (top chip strip / bottom action bar / right drawer), spec 2026-07-12.
// entry-ui.js precedent: pure string builders, unit-tested without DOM.
// This module must NOT import DOM, App.js, images, or boardgame.io.

function esc(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Top chip strip — one per player. Carries the .pcard class family so existing
// CSS + the 30-spec Playwright E2E contract (pcard--chip / pcard--active /
// pcard--bankrupt / pcard__name / pcard__money / pcard__turn) keeps working.
// `p.money` arrives PRE-FORMATTED (App's money() helper already handled the
// Ophelia hideMoney case upstream) — hideMoney here only swaps the DISPLAY.
export function chipHtml(p) {
  const letter = esc((p.name || '')[0] || String(p.idx + 1));
  const face = p.portraitUrl
    ? `<img class="chip__face" src="${esc(p.portraitUrl)}" alt="">`
    : `<span class="chip__face chip__face--letter" style="--tcol:${esc(p.color)}">${letter}</span>`;
  return `
    <div class="pcard pcard--chip ${p.isCurrent ? 'pcard--active' : ''} ${p.isBankrupt ? 'pcard--bankrupt' : ''}"
         style="--pc:${esc(p.color)}" data-chip="${p.idx}">
      ${face}
      <span class="pcard__name" style="color:${esc(p.color)}">${esc(p.name)}</span>
      <span class="pcard__money">${p.hideMoney ? '???' : p.money}</span>
      <span class="chip__deeds">${p.deeds}D</span>
      ${p.isCurrent ? '<span class="pcard__turn">TURN</span>' : ''}
      ${p.isBankrupt ? '<span class="pcard__bankrupt">OUT</span>' : ''}
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
        ${d.isCurrent ? '<span class="pcard__turn">TURN</span>' : ''}
        ${d.isBankrupt ? '<span class="pcard__bankrupt">OUT</span>' : ''}
      </div>
      <div class="pcard__money">${d.moneyHtml || ''}</div>
      <div class="pcard__meta">
        <span>${d.deeds} DEEDS</span>
        ${d.passiveName ? `<span class="pcard__passive" title="${esc(d.passiveDesc || '')}">${esc(d.passiveName)}</span>` : ''}
      </div>
      ${d.inJail ? '<div class="pcard__jail">IN JAIL</div>' : ''}
      ${abilities.length ? `<div class="pcard__abilities">${abilities.map(esc).join(' · ')}</div>` : ''}
      ${d.propsHtml ? `<div class="pcard__props">${d.propsHtml}</div>` : ''}
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
      <button class="drawer-tabs__btn" data-tab="log">LOG</button>
      <button class="drawer-tabs__btn" data-tab="chat">CHAT</button>
      <button class="drawer-tabs__btn" data-tab="manage">MANAGE</button>
    </div>
    <div class="drawer" id="drawer">
      <div id="manage"></div>
      <div id="ai-responses"></div>
      <div id="chat-panel"></div>
      <div id="log"></div>
      <div class="drawer__foot">
        <button id="btn-exit-foot" class="pix-btn pix-btn--ghost pix-btn--full pix-btn--sm">EXIT TO MENU</button>
      </div>
    </div>`;
}

// Shared portrait-vs-letter decision for board tokens. Pure: returns plain
// strings/booleans, no DOM. Consumed by both token renderers (Task 3).
export function tokenVisual(char, color, fallbackLabel) {
  if (char && char.portrait) {
    return {
      style: `background-image:url('${esc(char.portrait)}');--tcol:${esc(color)}`,
      className: 'token token--face',
      text: '',
    };
  }
  const text = char && char.name ? esc(char.name[0]) : esc(String(fallbackLabel));
  return {
    style: `--tcol:${esc(color)}`,
    className: 'token',
    text,
  };
}
