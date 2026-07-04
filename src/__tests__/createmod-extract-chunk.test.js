import { chunkBook } from '../createmod/extract/chunk';

const CS = 1000, OV = 100; // small sizes for tests (flags enforce >=1000 at the CLI)

describe('chunkBook', () => {
  test('splits at blank-line boundaries near chunkSize', () => {
    const para = 'x'.repeat(400);
    const text = Array.from({ length: 10 }, () => para).join('\n\n');
    const chunks = chunkBook(text, { chunkSize: CS, overlap: OV });
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c, i) => {
      expect(c.index).toBe(i);
      expect(c.text.length).toBeGreaterThan(0);
      expect(c.text.length).toBeLessThanOrEqual(CS * 1.15 + OV);
    });
  });
  test('single-newline zh-style text (no blank lines) still chunks', () => {
    const line = '行'.repeat(80);
    const text = Array.from({ length: 60 }, () => line).join('\n');
    const chunks = chunkBook(text, { chunkSize: CS, overlap: OV });
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach(c => expect(c.text.length).toBeLessThanOrEqual(CS * 1.15 + OV));
  });
  test('one paragraph larger than chunkSize hard-splits', () => {
    const text = 'y'.repeat(CS * 3);
    const chunks = chunkBook(text, { chunkSize: CS, overlap: OV });
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    chunks.forEach(c => expect(c.text.length).toBeLessThanOrEqual(CS * 1.15 + OV));
  });
  test('CRLF input is normalized', () => {
    const text = ('z'.repeat(400) + '\r\n\r\n').repeat(5);
    const chunks = chunkBook(text, { chunkSize: CS, overlap: OV });
    expect(chunks.every(c => !c.text.includes('\r'))).toBe(true);
  });
  test('overlap: each chunk after the first begins with the tail of the previous', () => {
    const text = Array.from({ length: 40 }, (_, i) => `para-${i}-` + 'a'.repeat(200)).join('\n\n');
    const chunks = chunkBook(text, { chunkSize: CS, overlap: OV });
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].text.startsWith(chunks[i - 1].text.slice(-OV))).toBe(true);
    }
  });
  test('maxChunks exceeded throws', () => {
    expect(() => chunkBook('q'.repeat(CS * 10), { chunkSize: CS, overlap: 0, maxChunks: 3 }))
      .toThrow(/book too large/);
  });
  test('chunkSize < 1 throws defensively', () => {
    expect(() => chunkBook('abc', { chunkSize: 0 })).toThrow(/chunkSize/);
  });
});
