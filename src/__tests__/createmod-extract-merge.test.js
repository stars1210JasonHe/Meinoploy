import { mergeCandidates, cutToTargets, fold } from '../createmod/extract/merge';

const chunk = (chars, places = [], themes = []) => ({
  characters: chars.map(c => ({ aliases: [], roleHints: '', traits: [], relationships: [], mentions: 1, ...c })),
  places: places.map(p => ({ aliases: [], kind: 'city', regionHints: '', mentions: 1, ...p })),
  themes,
});

describe('fold', () => {
  test('case + whitespace folding', () => {
    expect(fold('  Cao   Cao ')).toBe('cao cao');
  });
});

describe('mergeCandidates — union-find', () => {
  test('same folded name merges; mentions sum; aliases union', () => {
    const m = mergeCandidates([
      chunk([{ canonicalName: 'Cao Cao', mentions: 3, aliases: ['Mengde'] }]),
      chunk([{ canonicalName: 'cao  cao', mentions: 2, aliases: ['the Chancellor'] }]),
    ]);
    expect(m.characters).toHaveLength(1);
    expect(m.characters[0].mentions).toBe(5);
    expect(m.characters[0].aliases).toEqual(expect.arrayContaining(['Mengde', 'the Chancellor']));
  });
  test('LATE BRIDGE: a candidate aliasing two existing entries unifies all three', () => {
    const m = mergeCandidates([
      chunk([{ canonicalName: 'Lord Guan', mentions: 2 }]),
      chunk([{ canonicalName: 'Guan Yu', mentions: 5 }]),
      chunk([{ canonicalName: 'Yunchang', mentions: 1, aliases: ['Guan Yu', 'Lord Guan'] }]),
    ]);
    expect(m.characters).toHaveLength(1);
    expect(m.characters[0].canonicalName).toBe('Guan Yu'); // highest mentions wins
    expect(m.characters[0].mentions).toBe(8);
  });
  test('ranking: mentions desc, then first appearance', () => {
    const m = mergeCandidates([
      chunk([{ canonicalName: 'A', mentions: 2 }, { canonicalName: 'B', mentions: 5 }]),
      chunk([{ canonicalName: 'C', mentions: 2 }]),
    ]);
    expect(m.characters.map(c => c.canonicalName)).toEqual(['B', 'A', 'C']);
  });
  test('themes frequency-ranked', () => {
    const m = mergeCandidates([
      chunk([], [], ['war', 'loyalty']),
      chunk([], [], ['loyalty']),
    ]);
    expect(m.themes[0]).toBe('loyalty');
  });
  test('relationships dedupe by (target, nature) content across chunks', () => {
    const m = mergeCandidates([
      chunk([{ canonicalName: 'A', mentions: 1, relationships: [{ target: 'B', nature: 'brother' }] }]),
      chunk([{ canonicalName: 'A', mentions: 1, relationships: [{ target: 'b', nature: 'Brother' }, { target: 'C', nature: 'rival' }] }]),
    ]);
    expect(m.characters[0].relationships).toHaveLength(2);
  });
  test('canonicalName mention-tie breaks on first appearance, even via a late bridge', () => {
    const m = mergeCandidates([
      chunk([{ canonicalName: 'Lord Guan', mentions: 5 }]),
      chunk([{ canonicalName: 'Guan Yu', mentions: 5 }]),
      chunk([{ canonicalName: 'Bridge', mentions: 1, aliases: ['Guan Yu', 'Lord Guan'] }]),
    ]);
    expect(m.characters[0].canonicalName).toBe('Lord Guan'); // first seen wins the tie
  });
});

describe('cutToTargets', () => {
  test('cuts to targets and reports the cut lists', () => {
    const merged = mergeCandidates([
      chunk(
        [{ canonicalName: 'A', mentions: 5 }, { canonicalName: 'B', mentions: 4 }, { canonicalName: 'C', mentions: 1 }],
        [{ canonicalName: 'X', mentions: 9 }, { canonicalName: 'Y', mentions: 2 }],
      ),
    ]);
    const cut = cutToTargets(merged, { chars: 2, places: 1 });
    expect(cut.characters.map(c => c.canonicalName)).toEqual(['A', 'B']);
    expect(cut.cutCharacters.map(c => c.canonicalName)).toEqual(['C']);
    expect(cut.places.map(p => p.canonicalName)).toEqual(['X']);
    expect(cut.cutPlaces.map(p => p.canonicalName)).toEqual(['Y']);
  });
});
