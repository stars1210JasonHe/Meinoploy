import { deriveRoster, DEFAULT_PALETTE, PASSIVE_DEFAULTS } from '../createmod/smart/roster';
import { makeRng } from '../createmod/smart/index';

const KEYS = ['capital', 'luck', 'negotiation', 'charisma', 'tech', 'stamina'];
const sum = s => KEYS.reduce((t, k) => t + s[k], 0);
const inRange = s => KEYS.every(k => Number.isInteger(s[k]) && s[k] >= 1 && s[k] <= 10);

describe('deriveRoster — rough-stats mode', () => {
  test.each([
    ['already 34', { capital: 6, luck: 3, negotiation: 6, charisma: 5, tech: 5, stamina: 9 }],
    ['all zeros', { capital: 0, luck: 0, negotiation: 0, charisma: 0, tech: 0, stamina: 0 }],
    ['all 10s', { capital: 10, luck: 10, negotiation: 10, charisma: 10, tech: 10, stamina: 10 }],
    ['one huge value', { capital: 100, luck: 1, negotiation: 1, charisma: 1, tech: 1, stamina: 1 }],
  ])('%s -> sum exactly 34, each in [1,10]', (_label, stats) => {
    const [c] = deriveRoster(
      [{ id: 'a', name: 'A', passive: 'enforcer', stats }],
      { rng: makeRng('r') }
    );
    expect(sum(c.stats)).toBe(34);
    expect(inRange(c.stats)).toBe(true);
  });

  test('already-34 in-range stats are preserved exactly', () => {
    const stats = { capital: 6, luck: 3, negotiation: 6, charisma: 5, tech: 5, stamina: 9 };
    const [c] = deriveRoster([{ id: 'a', name: 'A', passive: 'enforcer', stats }], { rng: makeRng('r') });
    expect(c.stats).toEqual(stats);
  });
});

describe('deriveRoster — concept mode', () => {
  test('passive lean: enforcer leans negotiation/stamina, sum 34 in range', () => {
    const [c] = deriveRoster([{ id: 'a', name: 'A', passive: 'enforcer' }], { rng: makeRng('c') });
    expect(sum(c.stats)).toBe(34);
    expect(inRange(c.stats)).toBe(true);
    const others = KEYS.filter(k => k !== 'negotiation' && k !== 'stamina');
    const maxOther = Math.max(...others.map(k => c.stats[k]));
    expect(c.stats.negotiation).toBeGreaterThanOrEqual(maxOther - 1); // primary +3 vs jitter ±1
  });
  test('emphasis overrides the passive lean', () => {
    const [c] = deriveRoster(
      [{ id: 'a', name: 'A', passive: 'enforcer', emphasis: 'tech' }],
      { rng: makeRng('c') }
    );
    expect(sum(c.stats)).toBe(34);
    expect(c.stats.tech).toBeGreaterThanOrEqual(Math.max(...KEYS.map(k => c.stats[k])) - 1);
  });
  test('unknown passive + no emphasis does NOT throw (flat-base fallback, passive intact)', () => {
    const [c] = deriveRoster([{ id: 'a', name: 'A', passive: 'wizardry' }], { rng: makeRng('c') });
    expect(sum(c.stats)).toBe(34);
    expect(c.passive.id).toBe('wizardry'); // SP1's validator will reject it with the clear error
  });
});

describe('deriveRoster — passives & colors', () => {
  test('string passive is filled from PASSIVE_DEFAULTS', () => {
    const [c] = deriveRoster([{ id: 'a', name: 'A', passive: 'financier' }], { rng: makeRng('p') });
    expect(c.passive.id).toBe('financier');
    expect(c.passive.name).toBe(PASSIVE_DEFAULTS.financier.name);
    expect(c.passive.description.length).toBeGreaterThan(0);
  });
  test('authored color kept; auto colors unique and never collide with authored', () => {
    const authored = DEFAULT_PALETTE[0];
    const roster = deriveRoster(
      [
        { id: 'a', name: 'A', passive: 'enforcer', color: authored },
        { id: 'b', name: 'B', passive: 'pioneer' },
        { id: 'c', name: 'C', passive: 'merchant' },
      ],
      { rng: makeRng('col') }
    );
    const colors = roster.map(c => c.color);
    expect(colors[0]).toBe(authored);
    expect(new Set(colors).size).toBe(3);
  });
  test('palette exhaustion throws', () => {
    const chars = Array.from({ length: 3 }, (_, i) => ({ id: 'c' + i, name: 'C' + i, passive: 'enforcer' }));
    expect(() => deriveRoster(chars, { rng: makeRng('x'), palette: ['#111', '#222'] }))
      .toThrow(/unique colors/);
  });
  test('portrait passes through; title defaults to empty string', () => {
    const [c] = deriveRoster(
      [{ id: 'a', name: 'A', passive: 'enforcer', portrait: 'portraits/a.png' }],
      { rng: makeRng('p') }
    );
    expect(c.portrait).toBe('portraits/a.png');
    expect(c.title).toBe('');
  });
  test('deterministic: same input + seed -> deep-equal', () => {
    const chars = [{ id: 'a', name: 'A', passive: 'speculator' }, { id: 'b', name: 'B', passive: 'breaker' }];
    expect(deriveRoster(chars, { rng: makeRng('s') })).toEqual(deriveRoster(chars, { rng: makeRng('s') }));
  });
});
