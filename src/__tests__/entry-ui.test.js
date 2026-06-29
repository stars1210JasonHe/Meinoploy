const { pluralize, breadcrumbSteps, mapPreviewPoints } = require('../entry-ui');

describe('pluralize', () => {
  test('singular for 1', () => expect(pluralize(1, 'MAP')).toBe('1 MAP'));
  test('plural for 4', () => expect(pluralize(4, 'MAP')).toBe('4 MAPS'));
  test('plural for 0', () => expect(pluralize(0, 'MAP')).toBe('0 MAPS'));
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
  test('coordless map -> [] (no throw)', () => {
    expect(mapPreviewPoints({})).toEqual([]);
  });
  test('deterministic', () => {
    expect(mapPreviewPoints(atlasGeo)).toEqual(mapPreviewPoints(atlasGeo));
  });
});
