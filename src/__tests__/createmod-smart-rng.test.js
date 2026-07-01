import { makeRng } from '../createmod/smart/index';

describe('makeRng', () => {
  test('same seed -> identical sequence', () => {
    const a = makeRng('silk-road');
    const b = makeRng('silk-road');
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
  });
  test('different seeds -> different sequences', () => {
    const a = makeRng('silk-road');
    const b = makeRng('gilded-rails');
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });
  test('values are floats in [0,1)', () => {
    const rng = makeRng('x');
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
