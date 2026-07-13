/**
 * boardbg prompt composer — era-driven per-mod background prompts (reskin R2).
 * Spec: docs/superpowers/specs/2026-07-13-visual-reskin-design.md §2.
 */
import { composeBoardBgPrompt, BOARDBG_STYLE, PROMPT_MAX } from '../createmod/boardbg/prompt';

const SANGUO_LIKE = {
  kind: 'world',
  name: '中原' ,
  places: [{ realName: '洛阳' }, { realName: '冀州' }, { name: '虎牢关' }],
  roster: [
    { id: 'dong-zhuo', name: '董卓', title: 'Tyrant' },
    { id: 'cao-cao', name: '曹操', title: 'Speculator' },
  ],
  lore: {
    'dong-zhuo': { themeSummary: '暴虐与恐惧统治朝纲。', background: '董卓出身西凉，以殘忍著稱。第二句不该出现。' },
    'cao-cao': { background: '曹操以權謀和果斷著稱。后面的句子应被截断。' },
  },
};

describe('composeBoardBgPrompt', () => {
  test('aggregates lore themes, places, and the fixed style suffix', () => {
    const { prompt } = composeBoardBgPrompt(SANGUO_LIKE);
    expect(prompt).toContain('暴虐与恐惧统治朝纲。');
    expect(prompt).toContain('董卓出身西凉，以殘忍著稱。');
    expect(prompt).not.toContain('第二句不该出现');
    expect(prompt).not.toContain('后面的句子应被截断');
    expect(prompt).toContain('洛阳');
    expect(prompt).toContain('虎牢关');
    expect(prompt).toContain(BOARDBG_STYLE);
  });

  test('world story/tagline included when present, no "undefined" when absent', () => {
    const withStory = composeBoardBgPrompt({ ...SANGUO_LIKE, story: 'A realm fractured.', tagline: 'Three kingdoms rise' });
    expect(withStory.prompt).toContain('A realm fractured.');
    expect(withStory.prompt).toContain('Three kingdoms rise');
    const without = composeBoardBgPrompt(SANGUO_LIKE);
    expect(without.prompt).not.toMatch(/undefined|null/);
  });

  test('classic map mods compose from map name + roster titles', () => {
    const { prompt } = composeBoardBgPrompt({
      kind: 'map',
      mapName: 'Council Classic',
      roster: [{ name: 'Albert Victor', title: 'Council Financier' }],
      lore: {},
    });
    expect(prompt).toContain('Council Classic');
    expect(prompt).toContain('Council Financier');
    expect(prompt).toContain(BOARDBG_STYLE);
  });

  test('caps places and enforces PROMPT_MAX', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ realName: `P${i}` }));
    const { prompt, warnings } = composeBoardBgPrompt({ ...SANGUO_LIKE, places: many });
    expect(prompt).toContain('P0');
    expect(prompt).not.toContain('P30');
    expect(Array.isArray(warnings)).toBe(true);
    const huge = { ...SANGUO_LIKE, story: 'x'.repeat(PROMPT_MAX) };
    expect(() => composeBoardBgPrompt(huge)).toThrow(/exceeds/);
  });

  test('forbids text/characters in the style constant (background art, not a poster)', () => {
    expect(BOARDBG_STYLE).toMatch(/NO text/i);
    expect(BOARDBG_STYLE).toMatch(/pixel/i);
  });
});
