const { pluralize, breadcrumbSteps, mapPreviewPoints, miniMapSvg } = require('../entry-ui');
const { setLocale, t } = require('../i18n');

// pluralize()/breadcrumbSteps() route through i18n's t(), which defaults to zh (Task 1).
// Existing assertions below pin ENGLISH text, so they must run under an explicit 'en'
// locale rather than relying on incidental default state — set it before every test and
// let the dedicated zh describe blocks below opt back into 'zh' inside their own test body.
beforeEach(() => setLocale('en'));

describe('pluralize', () => {
  test('singular for 1', () => expect(pluralize(1, 'MAP')).toBe('1 MAP'));
  test('plural for 4', () => expect(pluralize(4, 'MAP')).toBe('4 MAPS'));
  test('plural for 0', () => expect(pluralize(0, 'MAP')).toBe('0 MAPS'));

  test('zh has no plural s — same string for singular and plural', () => {
    setLocale('zh');
    expect(pluralize(1, 'MAP')).toBe('1 张地图');
    expect(pluralize(4, 'MAP')).toBe('4 张地图');
  });
  test('zh CHARACTER word', () => {
    setLocale('zh');
    expect(pluralize(1, 'CHARACTER')).toBe('1 位角色');
    expect(pluralize(3, 'CHARACTER')).toBe('3 位角色');
  });
});

describe('breadcrumbSteps', () => {
  test('omits MOD when single mod', () => {
    const steps = breadcrumbSteps({ current: 'map', picks: {}, modCount: 1 });
    expect(steps.map(s => s.key)).toEqual(['mode', 'map', 'setup', 'character']);
  });
  test('includes MOD when multiple mods', () => {
    const steps = breadcrumbSteps({ current: 'map', picks: {}, modCount: 2 });
    expect(steps.map(s => s.key)).toEqual(['mode', 'mod', 'map', 'setup', 'character']);
  });
  test('done steps before current are interactive; future are not', () => {
    const steps = breadcrumbSteps({ current: 'map', picks: { mod: 'Terra Titans' }, modCount: 2 });
    const byKey = Object.fromEntries(steps.map(s => [s.key, s]));
    expect(byKey.mode.state).toBe('done');
    expect(byKey.mode.interactive).toBe(true);
    expect(byKey.mod.state).toBe('done');
    expect(byKey.mod.value).toBe('Terra Titans');
    expect(byKey.map.state).toBe('current');
    expect(byKey.map.interactive).toBe(false);
    expect(byKey.setup.state).toBe('future');
    expect(byKey.setup.interactive).toBe(false);
  });
  test('labels are locale-independent English text under en', () => {
    const steps = breadcrumbSteps({ current: 'map', picks: {}, modCount: 2 });
    expect(steps.map(s => s.label)).toEqual(['MODE', 'MOD', 'MAP', 'SETUP', 'CHARACTER']);
  });
  test('labels switch to zh when the locale flips', () => {
    setLocale('zh');
    const steps = breadcrumbSteps({ current: 'map', picks: {}, modCount: 2 });
    expect(steps.map(s => s.label)).toEqual(['模式', '模组', '地图', '设置', '角色']);
  });
});

describe('mapPreviewPoints', () => {
  const square = {
    movementMode: undefined,
    layout: { type: 'square', params: {} },
    spaceCount: 40,
    spaces: [{ id: 0, color: '#ff0000' }],
    theme: { logoColor: '#00ff00' },
  };
  const atlasGeo = {
    movementMode: 'atlas',
    places: [{ id: 'a', geo: { lat: 0, lng: 0 } }, { id: 'b', geo: { lat: 10, lng: 20 } }],
    theme: {},
  };
  const atlasPosOnly = {
    movementMode: 'atlas',
    places: [{ id: 'a', pos: { x: 10, y: 46 } }, { id: 'b', pos: { x: 80, y: 20 } }],
    theme: {},
  };

  test('square map yields points within 0-100', () => {
    const pts = mapPreviewPoints(square);
    expect(pts.length).toBeGreaterThan(0);
    pts.forEach(p => {
      expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(100);
      expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(100);
    });
  });
  test('atlas with geo yields points (orthographic)', () => {
    expect(mapPreviewPoints(atlasGeo).length).toBeGreaterThan(0);
  });
  test('atlas with only pos still yields points', () => {
    const pts = mapPreviewPoints(atlasPosOnly);
    expect(pts.length).toBe(2);
    expect(pts[0]).toMatchObject({ x: 10, y: 46 });
  });
  test('atlas points use var(--accent)', () => {
    expect(mapPreviewPoints(atlasPosOnly)[0].color).toBe('var(--accent)');
  });
  test('custom map uses layout.positions (generatePositions returns {} for custom)', () => {
    const custom = {
      layout: { type: 'custom', positions: { '0': { x: 88, y: 88 }, '1': { x: 74, y: 88 } } },
      spaceCount: 2,
      spaces: [{ id: 0, color: '#f00' }, { id: 1 }],
      theme: { logoColor: '#0ff' },
    };
    const pts = mapPreviewPoints(custom);
    expect(pts).toHaveLength(2);
    expect(pts).toContainEqual({ x: 88, y: 88, color: '#f00' });
    // space with no color falls back to theme.logoColor
    expect(pts).toContainEqual({ x: 74, y: 88, color: '#0ff' });
  });
  test('coordless map -> [] (no throw)', () => {
    expect(mapPreviewPoints({})).toEqual([]);
  });
  test('deterministic', () => {
    expect(mapPreviewPoints(atlasGeo)).toEqual(mapPreviewPoints(atlasGeo));
  });
});

describe('miniMapSvg', () => {
  const atlasGeo = { movementMode: 'atlas', places: [{ id: 'a', geo: { lat: 0, lng: 0 } }], theme: {} };
  const square = { layout: { type: 'square', params: {} }, spaceCount: 40, spaces: [], theme: { logoColor: '#0f0' } };
  test('atlas -> svg with a globe circle', () => {
    const svg = miniMapSvg(atlasGeo);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('<circle');
  });
  test('square -> svg with dots', () => {
    expect(miniMapSvg(square)).toContain('<svg');
  });
  test('coordless -> placeholder svg (no throw)', () => {
    const svg = miniMapSvg({ layout: { type: 'mystery' }, spaceCount: 0, theme: {} });
    expect(svg).toContain('<svg');
  });
  test('deterministic', () => {
    expect(miniMapSvg(atlasGeo)).toBe(miniMapSvg(atlasGeo));
  });
});
