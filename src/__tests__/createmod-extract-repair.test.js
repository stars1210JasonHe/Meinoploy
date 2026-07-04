import { routeErrors } from '../createmod/extract/index';

describe('routeErrors — explicit routing table', () => {
  const rosterIds = ['cao-cao', 'liu-bei'];
  test('lore CONTENT errors route to that character (non-kebab id still captured)', () => {
    const r = routeErrors([
      'lore (cao-cao): background required (non-empty string)',
      'lore (lü-bu): style[] required (non-empty)',
    ], rosterIds);
    expect(Object.keys(r.loreByChar)).toEqual(expect.arrayContaining(['cao-cao', 'lü-bu']));
  });
  test('lore KEY charset/orphan violations route to ROSTER', () => {
    const r = routeErrors([
      'lore (lü-bu): key must match ^[a-z0-9-]+$',
      'lore (ghost): orphan key — no matching roster id',
    ], rosterIds);
    expect(r.roster.length).toBe(2);
    expect(Object.keys(r.loreByChar)).toEqual([]);
  });
  test('missing NON-DEGRADED lore entry routes to that character LORE call', () => {
    const r = routeErrors(['lore (cao-cao): roster id missing a non-degraded lore entry'], rosterIds);
    expect(r.loreByChar['cao-cao']).toBeDefined();
    expect(r.roster).toEqual([]);
  });
  test('roster-family errors route to roster', () => {
    const r = routeErrors(['roster: duplicate id "x"', 'roster (x): passive.id "z" not one of the 8 implemented'], rosterIds);
    expect(r.roster.length).toBe(2);
  });
  test('everything else defaults to world|board — never dropped', () => {
    const r = routeErrors([
      'place "x": requires pos.{x,y} or geo.{lat,lng}',
      'expansion failed: boom',
      'classic board: groups must have unique colors (duplicate "red" used by "A" and "B")',
      'atlas smart-build needs >=3 places (got 2)',
      'loadWorld failed: whatever',
      'smart-build failed: color palette exhausted',
      'space 4 (X) cannot reach a hub within 14 steps',
    ], rosterIds);
    expect(r.world.length).toBe(7);
    expect(r.unroutable).toEqual([]);
  });
});
