import {
  planBatches, gridGeometry, firstSentence, buildGridPrompt,
  DEFAULT_STYLE, STYLE_MAX, BRIEF_MAX, PROMPT_MAX,
} from '../createmod/portraits/prompt';

describe('planBatches', () => {
  test.each([
    [1, [1]], [8, [8]], [16, [16]], [17, [9, 8]], [20, [10, 10]], [33, [11, 11, 11]],
  ])('n=%i -> %j', (n, expected) => expect(planBatches(n)).toEqual(expected));
  test('never exceeds 16 per batch for 1..200', () => {
    for (let n = 1; n <= 200; n++) {
      const b = planBatches(n);
      expect(b.reduce((a, x) => a + x, 0)).toBe(n);
      for (const x of b) expect(x).toBeLessThanOrEqual(16);
    }
  });
});

describe('gridGeometry (spec §3 table)', () => {
  test.each([
    [1, 1, 1, '1024x1024'], [2, 2, 1, '1536x1024'], [3, 2, 2, '1024x1024'],
    [4, 2, 2, '1024x1024'], [5, 3, 2, '1536x1024'], [8, 3, 3, '1024x1024'],
    [9, 3, 3, '1024x1024'], [12, 4, 3, '1536x1024'], [16, 4, 4, '1024x1024'],
  ])('n=%i -> %ix%i %s', (n, cols, rows, size) => {
    const g = gridGeometry(n);
    expect([g.cols, g.rows, g.size]).toEqual([cols, rows, size]);
    expect(`${g.width}x${g.height}`).toBe(size);
    expect(g.rows).toBeLessThanOrEqual(g.cols); // two-canvas invariant
  });
});

describe('firstSentence (CJK-aware)', () => {
  test('splits on 。', () => {
    expect(firstSentence('劉備，字玄德，乃漢室宗親。自幼便以仁慈著稱。')).toBe('劉備，字玄德，乃漢室宗親。');
  });
  test('splits on ASCII period and !?', () => {
    expect(firstSentence('A hero. More text.')).toBe('A hero.');
    expect(firstSentence('What a man! Then.')).toBe('What a man!');
  });
  test('no terminator -> whole text', () => expect(firstSentence('no ending here')).toBe('no ending here'));
  test('null-safe', () => expect(firstSentence(undefined)).toBe(''));
});

const mkChar = (i, extra = {}) => ({
  id: `char-${i}`, name: `Name${i}`, title: `Title${i}`,
  identity: `identity ${i}`, background: `Background sentence ${i}。 Second sentence.`, ...extra,
});

describe('buildGridPrompt', () => {
  test('n>1: grid header, row-major cells, default style, first-sentence appearance', () => {
    const batch = [1, 2, 3].map(i => mkChar(i));
    const { prompt, warnings } = buildGridPrompt(batch, {});
    expect(prompt).toContain('UNIFORM 2x2 grid of 3');
    expect(prompt).toContain(DEFAULT_STYLE);
    expect(prompt).toContain('Cell 1 (1,1): Name1 — Title1');
    expect(prompt).toContain('Cell 3 (2,1): Name3');
    expect(prompt).toContain('Background sentence 1。');
    expect(prompt).not.toContain('Second sentence');
    expect(prompt).toContain('plain dark background'); // 3 chars on a 2x2 grid -> empty-cell clause
    expect(warnings).toEqual([]);
  });
  test('n=1: dedicated single-portrait template, no grid vocabulary', () => {
    const { prompt } = buildGridPrompt([mkChar(1)], {});
    expect(prompt).not.toMatch(/grid/i);
    expect(prompt).toContain('Name1');
  });
  test('custom style replaces the default', () => {
    const { prompt } = buildGridPrompt([mkChar(1), mkChar(2)], { style: 'watercolor sketch' });
    expect(prompt).toContain('watercolor sketch');
    expect(prompt).not.toContain(DEFAULT_STYLE);
  });
  test('over-long brief is truncated to BRIEF_MAX with a warning; floor is kept', () => {
    const long = mkChar(1, { background: ('长'.repeat(500)) + '。' });
    const { prompt, warnings } = buildGridPrompt([long, mkChar(2)], {});
    const line = prompt.split('\n').find(l => l.startsWith('Cell 1'));
    expect(line.length).toBeLessThanOrEqual(BRIEF_MAX);
    expect(line).toContain('Name1 — Title1');
    expect(warnings.some(w => /truncated/.test(w))).toBe(true);
  });
  test('no truncation: very long floor with no identity/background returns full floor, no warning', () => {
    const longName = 'The ' + 'Extraordinarily '.repeat(15) + 'Long Character Name';
    const char = mkChar(1, {
      identity: '',
      background: '',
      name: longName,
      title: 'Title1'
    });
    const { prompt, warnings } = buildGridPrompt([char, mkChar(2)], {});
    const line = prompt.split('\n').find(l => l.startsWith('Cell 1'));
    expect(line.length).toBeGreaterThan(BRIEF_MAX);
    expect(line).toContain('Extraordinarily');
    expect(warnings).toEqual([]);
  });
  test('n=1: prompt exceeds PROMPT_MAX throws with message mentioning 30000/PROMPT_MAX', () => {
    const hugeStyle = 'y'.repeat(31000);
    const char = mkChar(1);
    expect(() => buildGridPrompt([char], { style: hugeStyle }))
      .toThrow(/30000|PROMPT_MAX|exceeds/);
  });
  test('exports the pinned caps', () => {
    expect(STYLE_MAX).toBe(600);
    expect(PROMPT_MAX).toBe(30000);
  });
});
