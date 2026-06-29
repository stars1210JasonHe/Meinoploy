const { pluralize, breadcrumbSteps } = require('../entry-ui');

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
