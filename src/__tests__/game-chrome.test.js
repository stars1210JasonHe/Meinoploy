import { chipHtml, chipDetailHtml, drawerShellHtml, tokenVisual, tileDetailHtml } from '../game-chrome';

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
});
