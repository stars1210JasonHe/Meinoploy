import { toCamelId } from '../createmod/templates';

describe('toCamelId', () => {
  test('hyphenated id becomes camelCase', () => {
    expect(toCamelId('terra-titans')).toBe('terraTitans');
    expect(toCamelId('ancient-empires')).toBe('ancientEmpires');
  });
  test('single-word id is unchanged', () => {
    expect(toCamelId('dominion')).toBe('dominion');
  });
  test('multi-segment and digit segments', () => {
    expect(toCamelId('a-b-c')).toBe('aBC');
    expect(toCamelId('mod-2-x')).toBe('mod2X');
  });
});
