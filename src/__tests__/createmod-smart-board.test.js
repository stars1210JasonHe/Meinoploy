import { deriveClassicBoard } from '../createmod/smart/board';
import { makeRng } from '../createmod/smart/index';
import { validateMap } from '../map-loader';

function facts(sizes) {
  const colors = ['red', 'blue', 'green', 'gold', 'teal'];
  return {
    groups: sizes.map((count, g) => ({
      name: 'G' + g,
      color: colors[g],
      places: Array.from({ length: count }, (_, i) => `G${g} Prop ${i}`),
    })),
  };
}

// validateMap needs id/name (SP1 fills them in the real pipeline) — add for direct validation.
function withMeta(map) { return { ...map, id: 't', name: 'T' }; }

describe('deriveClassicBoard', () => {
  // [3,3,3] (M=9) reaches the 3rd rotation slot -> exercises the tax/taxAmount path.
  [[2, 2], [3, 2], [3, 3], [3, 2, 2], [3, 3, 2], [3, 3, 3]].forEach(sizes => {
    test(`groups ${JSON.stringify(sizes)}: passes validateMap; jail typed at floor(N/2)`, () => {
      const map = deriveClassicBoard(facts(sizes), { rng: makeRng('b') });
      expect(validateMap(withMeta(map))).toEqual([]);
      expect(map.layout).toEqual({ type: 'circle' });
      expect(map.spaces.length).toBe(map.spaceCount);
      expect(map.spaceCount).toBeGreaterThanOrEqual(10);
      const jail = Math.floor(map.spaceCount / 2);
      expect(map.specialSpaces).toEqual({ go: 0, jail });
      expect(map.spaces[0].type).toBe('go');
      expect(map.spaces[jail].type).toBe('jail');
      // no property dropped: every input property name appears exactly once
      const wantNames = sizes.flatMap((c, g) => Array.from({ length: c }, (_, i) => `G${g} Prop ${i}`));
      const gotNames = map.spaces.filter(s => s.type === 'property').map(s => s.name);
      expect(gotNames.sort()).toEqual(wantNames.sort());
    });
  });

  test('colorGroups reference final placed ids with matching colors', () => {
    const map = deriveClassicBoard(facts([3, 2]), { rng: makeRng('b') });
    Object.entries(map.colorGroups).forEach(([color, group]) => {
      expect(group.spaces.length).toBeGreaterThanOrEqual(2);
      group.spaces.forEach(id => {
        expect(map.spaces[id].type).toBe('property');
        expect(map.spaces[id].color).toBe(color);
      });
    });
  });

  test('default cards contain no positional moveTo other than 0', () => {
    const map = deriveClassicBoard(facts([2, 2]), { rng: makeRng('b') });
    [...map.cards.chance, ...map.cards.community].forEach(card => {
      if (card.action === 'moveTo') expect(card.value).toBe(0);
    });
  });

  test('author cards pass through untouched', () => {
    const cards = { chance: [{ text: 'x', action: 'gain', value: 1 }], community: [{ text: 'y', action: 'gain', value: 1 }] };
    const map = deriveClassicBoard({ ...facts([2, 2]), cards }, { rng: makeRng('b') });
    expect(map.cards).toBe(cards);
  });

  test('guards: <2 groups, group <2 properties, duplicate colors all throw', () => {
    expect(() => deriveClassicBoard(facts([3]), { rng: makeRng('b') })).toThrow(/>=2 groups/);
    expect(() => deriveClassicBoard(facts([3, 1]), { rng: makeRng('b') })).toThrow(/>=2 properties/);
    const dup = facts([2, 2]);
    dup.groups[1].color = dup.groups[0].color;
    expect(() => deriveClassicBoard(dup, { rng: makeRng('b') })).toThrow(/unique colors/);
  });

  test('deterministic: same input -> deep-equal', () => {
    expect(deriveClassicBoard(facts([3, 2]), { rng: makeRng('d') }))
      .toEqual(deriveClassicBoard(facts([3, 2]), { rng: makeRng('d') }));
  });
});
