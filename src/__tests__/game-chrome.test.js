import { chipHtml, chipDetailHtml, drawerShellHtml, tokenVisual, tileDetailHtml, nodeGlow, NODE_GLOW_COLORS, legendHtml, resolveTileDescription } from '../game-chrome';
// T3 (MT2-SP4 direction B), deliverable 1 (speech bubbles).
import { bubbleHtml } from '../game-chrome';
// T3, deliverable 2 (attitude chips + diary tab).
import { attitudeChipsHtml, diaryTabHtml } from '../game-chrome';
import { setLocale } from '../i18n';

// Task 3 (i18n): game-chrome now renders its static labels through t(), whose
// module default is 'zh'. Pin 'en' before every test so the pre-existing
// English-literal assertions below stay locale-explicit rather than relying on
// incidental module state (same convention as entry-ui.test.js).
beforeEach(() => setLocale('en'));

const P = { idx: 0, name: 'Hammurabi', title: 'The Lawgiver', color: '#e8a33d',
  money: '$3,085', portraitUrl: '/portraits/h.png', isCurrent: true, isBankrupt: false,
  deeds: 3, hideMoney: false };

describe('chipHtml', () => {
  test('active chip keeps the pcard class family (E2E contract)', () => {
    const h = chipHtml(P);
    expect(h).toContain('pcard');
    expect(h).toContain('pcard--chip');
    expect(h).toContain('pcard--active');
    expect(h).toContain('pcard__name');
    expect(h).toContain('pcard__money');
    expect(h).toContain('data-chip="0"');
  });
  test('non-current chip has no active class; bankrupt gets pcard--bankrupt', () => {
    expect(chipHtml({ ...P, isCurrent: false })).not.toContain('pcard--active');
    expect(chipHtml({ ...P, isCurrent: false, isBankrupt: true })).toContain('pcard--bankrupt');
  });
  test('chip carries the B2 war-room panel classes (reskin R1a, additive)', () => {
    const h = chipHtml(P);
    expect(h).toContain('wr-panel');
    expect(h).toContain('wr-notch');
  });
  test('inJail renders the pcard__jail badge; absent when false', () => {
    expect(chipHtml({ ...P, inJail: true })).toContain('pcard__jail');
    expect(chipHtml({ ...P, inJail: true })).toContain('JAIL');
    expect(chipHtml({ ...P, inJail: false })).not.toContain('pcard__jail');
  });
  test('portrait renders as pixelated img; null portrait falls back to letter block', () => {
    expect(chipHtml(P)).toContain('/portraits/h.png');
    const fb = chipHtml({ ...P, portraitUrl: null });
    expect(fb).not.toContain('<img');
    expect(fb).toContain('H'); // first letter fallback
  });
  test('escapes hostile names', () => {
    const h = chipHtml({ ...P, name: '<script>x</script>' });
    expect(h).not.toContain('<script>');
    expect(h).toContain('&lt;script&gt;');
  });
  // Task-2 fix-wave: masking now happens upstream (App's money() helper) — chipHtml
  // has no '???' branch of its own and must render p.money verbatim, styled markup
  // included, whether or not hideMoney is set.
  test('hideMoney: p.money html is rendered verbatim, not replaced with plain "???"', () => {
    const masked = { ...P, hideMoney: true, money: '<span class="money money--hidden">$?,???</span>' };
    const h = chipHtml(masked);
    expect(h).toContain('<span class="money money--hidden">$?,???</span>');
    expect(h).not.toMatch(/pcard__money">\?\?\?</);
  });
  test('non-hidden money html still passes through unchanged', () => {
    const h = chipHtml(P);
    expect(h).toContain('pcard__money">$3,085</span>');
  });
  // local-bots wiring (Task 2): additive isBot badge, absent by default.
  test('isBot renders the pcard__bot BOT badge; absent when false/omitted', () => {
    expect(chipHtml({ ...P, isBot: true })).toContain('<span class="pcard__bot">BOT</span>');
    expect(chipHtml({ ...P, isBot: false })).not.toContain('pcard__bot');
    expect(chipHtml(P)).not.toContain('pcard__bot');
  });
  // Task 3 (i18n): badges resolve through t() at build time.
  test('zh locale: status badges render the zh labels', () => {
    setLocale('zh');
    const h = chipHtml({ ...P, isCurrent: true, isBankrupt: true, inJail: true, isBot: true });
    expect(h).toContain('行动中'); // TURN
    expect(h).toContain('出局');   // OUT
    expect(h).toContain('入狱');   // JAIL
    expect(h).toContain('BOT');    // acronym, same in both locales
    expect(h).not.toContain('TURN');
  });
});

describe('tokenVisual', () => {
  // Consumers (App.js renderTokens + _updateGlobeOverlay) apply these via DOM
  // PROPERTY assignments (style.backgroundImage, style.setProperty('--tcol', ...),
  // textContent, classList.toggle) — properties need NO HTML escaping. tokenVisual
  // must return RAW text/portraitUrl/color, not entity-escaped strings, or a
  // textContent assignment would double-escape.
  test('portrait char -> raw portraitUrl + color passed through, empty text', () => {
    const v = tokenVisual({ name: 'Hammurabi', portrait: '/p.png' }, '#e8a33d', '1');
    expect(v.portraitUrl).toBe('/p.png');
    expect(v.color).toBe('#e8a33d');
    expect(v.text).toBe('');
  });
  test('no portrait -> letter text, null portraitUrl', () => {
    const v = tokenVisual({ name: 'Hammurabi', portrait: null }, '#e8a33d', '1');
    expect(v.portraitUrl).toBeNull();
    expect(v.text).toBe('H');
  });
  test('no character at all -> fallback label, null portraitUrl', () => {
    const v = tokenVisual(null, '#888', '2');
    expect(v.portraitUrl).toBeNull();
    expect(v.text).toBe('2');
  });
  test('hostile name text is returned RAW, not HTML-escaped (consumers use textContent)', () => {
    const v = tokenVisual({ name: '<b>x</b>' }, '#fff', '1');
    expect(v.text).toBe('<');
  });
});

describe('drawerShellHtml', () => {
  test('contains the three tab buttons and the re-homed section containers', () => {
    const h = drawerShellHtml();
    ['data-tab="log"', 'data-tab="chat"', 'data-tab="manage"',
     'id="log"', 'id="chat-panel"', 'id="manage"', 'id="ai-responses"',
     'id="btn-exit-foot"'].forEach(s => expect(h).toContain(s));
  });
  // q2 (LOG tab unread dot): the dot element is static markup, starts hidden;
  // App.js toggles [hidden] + the drawer-tabs__btn--unread class at runtime.
  test('LOG tab button carries a hidden unread dot placeholder', () => {
    const h = drawerShellHtml();
    expect(h).toMatch(/data-tab="log">LOG<span class="drawer-tabs__dot" hidden><\/span>/);
  });
  // Task 3 (i18n): tab labels + exit-foot resolve through t() at build time —
  // App.js's onLocaleChange hook rebuilds the tab rail from this builder.
  test('zh locale: tab labels and exit-foot are zh; dot placeholder survives', () => {
    setLocale('zh');
    const h = drawerShellHtml();
    expect(h).toMatch(/data-tab="log">日志<span class="drawer-tabs__dot" hidden><\/span>/);
    expect(h).toContain('data-tab="chat">聊天');
    expect(h).toContain('data-tab="manage">管理');
    expect(h).toContain('退出至主菜单');
    expect(h).not.toContain('EXIT TO MENU');
  });
});

describe('chipDetailHtml', () => {
  test('carries abilities, passive, and props through', () => {
    const h = chipDetailHtml({ name: 'H', title: 'T', color: '#fff', portraitUrl: null,
      moneyHtml: '$1', deeds: 2, abilities: ['REROLL 1'], passiveName: 'Code of Law',
      passiveDesc: 'desc', propsHtml: '<span class="propchip">X</span>' });
    expect(h).toContain('REROLL 1');
    expect(h).toContain('Code of Law');
    expect(h).toContain('propchip');
  });

  // Carry-forward from Task 1 review: inJail/isBankrupt/isCurrent status badges
  // (same class names as the live tall pcard: pcard__jail / pcard__bankrupt / pcard__turn)
  // must not silently vanish from the popover.
  test('status badges: inJail/isBankrupt/isCurrent render the same classes as the live pcard', () => {
    const base = { name: 'H', title: 'T', color: '#fff', portraitUrl: null, moneyHtml: '$1', deeds: 2 };
    const h = chipDetailHtml({ ...base, inJail: true, isBankrupt: true, isCurrent: true });
    expect(h).toContain('pcard__jail');
    expect(h).toContain('IN JAIL');
    expect(h).toContain('pcard__bankrupt');
    expect(h).toContain('OUT');
    expect(h).toContain('pcard__turn');
    expect(h).toContain('TURN');
  });

  test('status badges: absent flags render no badge markup', () => {
    const base = { name: 'H', title: 'T', color: '#fff', portraitUrl: null, moneyHtml: '$1', deeds: 2 };
    const h = chipDetailHtml(base);
    expect(h).not.toContain('pcard__jail');
    expect(h).not.toContain('pcard__bankrupt');
    expect(h).not.toContain('pcard__turn');
  });

  // Task 1: optional bottom lore section — raw pass-through (App escapes/truncates
  // upstream), mirrors propsHtml's raw-passthrough documentation style.
  test('loreHtml renders as a bottom section when present', () => {
    const base = { name: 'H', title: 'T', color: '#fff', portraitUrl: null, moneyHtml: '$1', deeds: 2 };
    const h = chipDetailHtml({ ...base, loreHtml: '<p class="lore">Once a lawgiver...</p>' });
    expect(h).toContain('chip-detail__lore');
    expect(h).toContain('<p class="lore">Once a lawgiver...</p>');
  });

  test('loreHtml absent when not provided', () => {
    const base = { name: 'H', title: 'T', color: '#fff', portraitUrl: null, moneyHtml: '$1', deeds: 2 };
    const h = chipDetailHtml(base);
    expect(h).not.toContain('chip-detail__lore');
  });

  // T3 (MT2-SP4 direction B): attitudeHtml is a RAW pass-through field (App
  // pre-builds it via attitudeChipsHtml — same discipline as propsHtml/loreHtml).
  test('attitudeHtml renders verbatim when present', () => {
    const base = { name: 'H', title: 'T', color: '#fff', portraitUrl: null, moneyHtml: '$1', deeds: 2 };
    const h = chipDetailHtml({ ...base, attitudeHtml: '<div class="attitude">STANDING</div>' });
    expect(h).toContain('<div class="attitude">STANDING</div>');
  });

  test('attitudeHtml absent when not provided (no empty wrapper)', () => {
    const base = { name: 'H', title: 'T', color: '#fff', portraitUrl: null, moneyHtml: '$1', deeds: 2 };
    const h = chipDetailHtml(base);
    expect(h).not.toContain('class="attitude"');
  });

  // T3: mid-game entry point into the full lore modal (showLoreModal), needed
  // so the modal's new Diary tab is ever reachable outside character-select.
  test('charId present -> renders the view-lore button with the char id', () => {
    const base = { name: 'H', title: 'T', color: '#fff', portraitUrl: null, moneyHtml: '$1', deeds: 2 };
    const h = chipDetailHtml({ ...base, charId: 'marcus-kodak' });
    expect(h).toContain('id="btn-chip-lore"');
    expect(h).toContain('data-char-id="marcus-kodak"');
  });

  test('charId absent -> no view-lore button', () => {
    const base = { name: 'H', title: 'T', color: '#fff', portraitUrl: null, moneyHtml: '$1', deeds: 2 };
    const h = chipDetailHtml(base);
    expect(h).not.toContain('btn-chip-lore');
  });
});

describe('attitudeChipsHtml', () => {
  const TIERS = { grudgeTiers: [3, 6, 9], trustTiers: [3, 6, 9] };

  test('empty rows -> empty string', () => {
    expect(attitudeChipsHtml([], TIERS)).toBe('');
    expect(attitudeChipsHtml(null, TIERS)).toBe('');
  });

  test('all-neutral rows (grudge 0, trust 0) -> empty string, no empty section header', () => {
    const h = attitudeChipsHtml([{ name: 'Guan Yu', color: '#f00', grudge: 0, trust: 0 }], TIERS);
    expect(h).toBe('');
  });

  test('grudge crossing 1 tier -> one ▲, trust untouched', () => {
    const h = attitudeChipsHtml([{ name: 'Guan Yu', color: '#f00', grudge: 3, trust: 0 }], TIERS);
    expect(h).toContain('▲');
    expect(h).not.toContain('▲▲');
    expect(h).not.toContain('▼');
    expect(h).toContain('Guan Yu');
  });

  test('grudge crossing all 3 tiers -> ▲▲▲', () => {
    const h = attitudeChipsHtml([{ name: 'Guan Yu', color: '#f00', grudge: 9, trust: 0 }], TIERS);
    expect(h).toContain('▲▲▲');
    expect(h).not.toContain('▲▲▲▲');
  });

  test('trust crossing tiers renders ▼ glyphs, independent of grudge', () => {
    const h = attitudeChipsHtml([{ name: 'Guan Yu', color: '#f00', grudge: 0, trust: 6 }], TIERS);
    expect(h).toContain('▼▼');
    expect(h).not.toContain('▲');
  });

  test('mixed rows: neutral pairs are omitted, non-neutral pairs still render', () => {
    const rows = [
      { name: 'Neutral Guy', color: '#0f0', grudge: 0, trust: 0 },
      { name: 'Guan Yu', color: '#f00', grudge: 6, trust: 3 },
    ];
    const h = attitudeChipsHtml(rows, TIERS);
    expect(h).not.toContain('Neutral Guy');
    expect(h).toContain('Guan Yu');
    expect(h).toContain('▲▲');
    expect(h).toContain('▼');
  });

  test('root wrapper carries the .attitude class + title, escapes hostile names', () => {
    const h = attitudeChipsHtml([{ name: '<script>x</script>', color: '#f00', grudge: 3, trust: 0 }], TIERS);
    expect(h).toContain('class="attitude"');
    expect(h).not.toContain('<script>x</script>');
    expect(h).toContain('&lt;script&gt;');
  });

  test('zh locale: grudge/trust labels + section title localize', () => {
    setLocale('zh');
    const h = attitudeChipsHtml([{ name: '关羽', color: '#f00', grudge: 6, trust: 3 }], TIERS);
    expect(h).toContain('宿怨');
    expect(h).toContain('信任');
    expect(h).toContain('态度');
  });

  test('missing tiers config defaults to zero crossings (no glyphs, row omitted)', () => {
    const h = attitudeChipsHtml([{ name: 'Guan Yu', color: '#f00', grudge: 5, trust: 5 }], {});
    expect(h).toBe('');
  });
});

describe('bubbleHtml', () => {
  test('carries owner/seq data attributes for App.js seq-diffing', () => {
    const h = bubbleHtml({ idx: '2', seq: 7, text: 'Hello', color: '#e8a33d' });
    expect(h).toContain('data-bubble-owner="2"');
    expect(h).toContain('data-bubble-seq="7"');
    expect(h).toContain('dbubble');
  });

  test('text is escaped (hostile content safe)', () => {
    const h = bubbleHtml({ idx: '0', seq: 1, text: '<script>x</script>', color: '#fff' });
    expect(h).not.toContain('<script>x</script>');
    expect(h).toContain('&lt;script&gt;');
  });

  test('missing color falls back gracefully (no "undefined" leaking into style)', () => {
    const h = bubbleHtml({ idx: '0', seq: 1, text: 'hi' });
    expect(h).not.toContain('undefined');
  });

  test('carries a tail element for the pixel speech-bubble pointer', () => {
    const h = bubbleHtml({ idx: '0', seq: 1, text: 'hi', color: '#fff' });
    expect(h).toContain('dbubble__tail');
    expect(h).toContain('dbubble__text');
  });
});

describe('diaryTabHtml', () => {
  test('empty/absent entries -> empty string (lore modal hides the whole tab)', () => {
    expect(diaryTabHtml([])).toBe('');
    expect(diaryTabHtml(null)).toBe('');
    expect(diaryTabHtml(undefined)).toBe('');
  });

  test('renders entry text + season/turn metadata', () => {
    const h = diaryTabHtml([{ turn: 12, seasonName: 'Autumn', text: 'Guan Yu wronged me again.' }]);
    expect(h).toContain('Guan Yu wronged me again.');
    expect(h).toContain('Autumn');
    expect(h).toContain('diary__entry');
  });

  test('multiple entries all render, in the given (oldest-first) order', () => {
    const h = diaryTabHtml([
      { turn: 1, seasonName: 'Summer', text: 'First entry.' },
      { turn: 12, seasonName: 'Autumn', text: 'Second entry.' },
    ]);
    const firstIdx = h.indexOf('First entry.');
    const secondIdx = h.indexOf('Second entry.');
    expect(firstIdx).toBeGreaterThan(-1);
    expect(secondIdx).toBeGreaterThan(firstIdx);
  });

  test('escapes hostile diary text', () => {
    const h = diaryTabHtml([{ turn: 1, seasonName: 'Summer', text: '<script>x</script>' }]);
    expect(h).not.toContain('<script>x</script>');
    expect(h).toContain('&lt;script&gt;');
  });

  test('missing seasonName/turn tolerated (no "undefined" leaking through)', () => {
    const h = diaryTabHtml([{ text: 'Just text.' }]);
    expect(h).toContain('Just text.');
    expect(h).not.toContain('undefined');
  });
});

describe('tileDetailHtml', () => {
  const OWNED = {
    name: 'Stuttgart Fracture', typeLabel: 'PROPERTY', price: 240,
    ownerName: 'Hammurabi', ownerColor: '#e8a33d', ownerPortraitUrl: '/portraits/h.png',
    level: 2, mortgaged: false, rentText: '$120',
    groupHtml: '<span class="propchip">Sibling A</span>',
    placeStats: { population: '600K', gdp: '$40B', fame: 82 },
    archetypes: ['industrial', 'gritty'],
    description: 'A fractured industrial district.',
    flavorText: null,
  };

  test('root class is tile-detail (E2E contract)', () => {
    const h = tileDetailHtml(OWNED);
    expect(h).toMatch(/class="tile-detail[\s"]/);
  });

  test('full-owned case: name/price/owner portrait/level pips/rent all render', () => {
    const h = tileDetailHtml(OWNED);
    expect(h).toContain('Stuttgart Fracture');
    expect(h).toContain('PROPERTY');
    expect(h).toContain('$240');
    expect(h).toContain('<img');
    expect(h).toContain('/portraits/h.png');
    expect(h).toContain('Hammurabi');
    expect(h).toContain('#e8a33d');
    expect(h).toContain('tile-detail__pip');
    // level 2 -> exactly 2 pip spans
    expect((h.match(/tile-detail__pip/g) || []).length).toBe(2);
    expect(h).toContain('$120');
    expect(h).not.toContain('UNOWNED');
  });

  test('unowned case: UNOWNED state, no owner portrait img rendered', () => {
    const h = tileDetailHtml({ ...OWNED, ownerName: null, ownerPortraitUrl: null, level: 0 });
    expect(h).toContain('UNOWNED');
    expect(h).not.toContain('<img');
  });

  test('mortgaged badge renders when mortgaged, absent when not', () => {
    const h = tileDetailHtml({ ...OWNED, mortgaged: true });
    expect(h).toContain('tile-detail__mortgaged');
    const h2 = tileDetailHtml({ ...OWNED, mortgaged: false });
    expect(h2).not.toContain('tile-detail__mortgaged');
  });

  test('null-section absence: placeStats/archetypes/description/flavorText/groupHtml/rentText fully absent when null', () => {
    const h = tileDetailHtml({ ...OWNED, placeStats: null, archetypes: null, description: null,
      flavorText: null, groupHtml: '', rentText: null });
    expect(h).not.toContain('tile-detail__stats');
    expect(h).not.toContain('tile-detail__archetypes');
    expect(h).not.toContain('tile-detail__description');
    expect(h).not.toContain('tile-detail__flavor');
    expect(h).not.toContain('tile-detail__group');
    expect(h).not.toContain('tile-detail__rent');
  });

  test('flavor-only corner variant: no price/owner section, flavorText renders', () => {
    const h = tileDetailHtml({
      name: 'Go', typeLabel: 'CORNER', price: null, ownerName: null, ownerColor: null,
      ownerPortraitUrl: null, level: 0, mortgaged: false, rentText: null, groupHtml: '',
      placeStats: null, archetypes: null, description: null, flavorText: 'Collect on the way past.',
    });
    expect(h).toContain('Collect on the way past.');
    expect(h).not.toContain('tile-detail__price');
    expect(h).not.toContain('tile-detail__owner');
    expect(h).not.toContain('UNOWNED');
    expect(h).not.toContain('$');
  });

  test('escapes hostile name + description into entities', () => {
    const h = tileDetailHtml({ ...OWNED, name: '<script>x</script>', description: '<img src=x onerror=alert(1)>' });
    expect(h).not.toContain('<script>x</script>');
    expect(h).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(h).not.toContain('<img src=x onerror=alert(1)>');
    expect(h).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  test('groupHtml is a raw pass-through (not escaped)', () => {
    const h = tileDetailHtml(OWNED);
    expect(h).toContain('<span class="propchip">Sibling A</span>');
  });

  // Task 3 (i18n): static labels (UNOWNED/MORTGAGED/RENT/POP/GDP/FAME) route
  // through t(); the DATA fields around them (name, rentText value, stats
  // values) stay untranslated pass-throughs.
  test('zh locale: static labels flip, data fields stay verbatim', () => {
    setLocale('zh');
    const h = tileDetailHtml({ ...OWNED, ownerName: null, ownerPortraitUrl: null, mortgaged: true });
    expect(h).toContain('无主');       // UNOWNED
    expect(h).toContain('已抵押');     // MORTGAGED
    expect(h).toContain('租金 $120'); // RENT {rent} — value untouched
    expect(h).toContain('人口 600K'); // POP {v}
    expect(h).toContain('声望 82');   // FAME {v}
    expect(h).toContain('Stuttgart Fracture'); // name = data
    expect(h).not.toContain('UNOWNED');
    expect(h).not.toContain('MORTGAGED');
  });
});

// Ticket: classic-board place descriptions in the tile popover.
describe('resolveTileDescription', () => {
  test('atlas: place resolved -> uses place.description verbatim, ignores space.description', () => {
    expect(resolveTileDescription({ description: 'Real-world atlas blurb.' }, { description: 'should be ignored' }))
      .toBe('Real-world atlas blurb.');
  });

  test('atlas: place resolved but has no description -> null (behavior UNCHANGED, no classic fallback)', () => {
    expect(resolveTileDescription({ description: null }, { description: 'should still be ignored' })).toBeNull();
    expect(resolveTileDescription({}, { description: 'should still be ignored' })).toBeNull();
  });

  test('classic: no place (placeId-less space) -> falls back to space.description', () => {
    expect(resolveTileDescription(null, { description: 'A fractured industrial district.' }))
      .toBe('A fractured industrial district.');
  });

  test('classic: no place and no space.description -> null', () => {
    expect(resolveTileDescription(null, { name: 'GO' })).toBeNull();
    expect(resolveTileDescription(null, null)).toBeNull();
  });
});

// R1c: node glow chooser — color + BLOOM_CONTEXTS key per space type/ownership
// (mockup: haloColor by type; haloAlpha by owner).
describe('nodeGlow', () => {
  test('owned property glows in the owner neon (overrides type)', () => {
    expect(nodeGlow({ type: 'property' }, '#ff3b5c')).toEqual({ color: '#ff3b5c', context: 'nodeOwned' });
    expect(nodeGlow({ type: 'railroad' }, '#e8b34d')).toEqual({ color: '#e8b34d', context: 'nodeOwned' });
  });
  test('unowned ownables glow neutral cyan', () => {
    expect(nodeGlow({ type: 'property' }, null)).toEqual({ color: NODE_GLOW_COLORS.neutral, context: 'node' });
    expect(nodeGlow({ type: 'utility' }, null)).toEqual({ color: NODE_GLOW_COLORS.neutral, context: 'node' });
  });
  test('special types carry their mockup glow colors', () => {
    expect(nodeGlow({ type: 'tax' }, null)).toEqual({ color: NODE_GLOW_COLORS.tax, context: 'node' });
    expect(nodeGlow({ type: 'chance' }, null)).toEqual({ color: NODE_GLOW_COLORS.chance, context: 'node' });
    expect(nodeGlow({ type: 'community' }, null)).toEqual({ color: NODE_GLOW_COLORS.chance, context: 'node' });
    expect(nodeGlow({ type: 'go' }, null)).toEqual({ color: NODE_GLOW_COLORS.start, context: 'start' });
  });
  test('hubs glow cyan in the wider hub context; dim steel for the rest', () => {
    expect(nodeGlow({ type: 'property', isHub: true }, null)).toEqual({ color: NODE_GLOW_COLORS.neutral, context: 'hub' });
    expect(nodeGlow({ type: 'jail' }, null)).toEqual({ color: NODE_GLOW_COLORS.dim, context: 'node' });
    expect(nodeGlow({ type: 'parking' }, null)).toEqual({ color: NODE_GLOW_COLORS.dim, context: 'node' });
  });
  test('owner neon wins even on a hub (context stays hub-wide)', () => {
    expect(nodeGlow({ type: 'property', isHub: true }, '#a97bff')).toEqual({ color: '#a97bff', context: 'hub' });
  });
});

// R1d: legend cartouche — live rows (mockup .legend).
describe('legendHtml', () => {
  const ROWS = [
    { color: '#4fe3ff', label: '中立 NEUTRAL', kind: 'neutral' },
    { color: '#ff3b5c', label: '领地 · 董卓', kind: 'player' },
    { color: '#ff8a3d', label: '税赋 TAX', kind: 'tax' },
    { color: '#a97bff', label: '机变 CHANCE', kind: 'chance' },
  ];
  test('renders a dot-colored row per entry with escaped labels', () => {
    const h = legendHtml(ROWS);
    expect(h).toContain('legend__row');
    expect((h.match(/legend__dot/g) || []).length).toBe(4);
    expect(h).toContain('--dot:#ff3b5c');
    expect(h).toContain('领地 · 董卓');
    expect(legendHtml([{ color: '#fff', label: '<img>', kind: 'player' }])).not.toContain('<img>');
  });
  test('carries the cartouche title and kind modifiers', () => {
    const h = legendHtml(ROWS);
    expect(h).toContain('legend__title');
    expect(h).toContain('legend__row--player');
    expect(h).toContain('legend__row--neutral');
  });
  // Task 3 (i18n): the reskin's bilingual cartouche title is the ZH value;
  // en gets the plain-EN half. Row labels arrive pre-localized from App.
  test('title localizes: en plain LEGEND, zh keeps the bilingual cartouche', () => {
    expect(legendHtml(ROWS)).toContain('>LEGEND<'); // en (pinned) — no 图例
    expect(legendHtml(ROWS)).not.toContain('图例');
    setLocale('zh');
    expect(legendHtml(ROWS)).toContain('LEGEND · 图例');
  });
});
