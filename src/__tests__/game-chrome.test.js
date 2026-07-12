import { chipHtml, chipDetailHtml, drawerShellHtml, tokenVisual } from '../game-chrome';

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
});
