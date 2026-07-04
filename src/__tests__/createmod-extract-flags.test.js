import { parseExtractArgs, EXTRACT_VALUE_FLAGS } from '../createmod/extract/flags';
import { DEFAULT_PALETTE } from '../createmod/smart/roster';

const P = argv => parseExtractArgs(argv);

describe('parseExtractArgs — defaults & shape', () => {
  test('positional book + defaults', () => {
    const o = P(['book.txt']);
    expect(o.errors).toEqual([]);
    expect(o).toMatchObject({
      book: 'book.txt', chars: 10, places: 12, lang: 'auto', mapType: 'atlas',
      chunkSize: 12000, overlap: 400, maxChunks: 200, recache: false, mapImage: null,
    });
  });
  test('EXTRACT_VALUE_FLAGS lists every value-consuming flag', () => {
    expect(EXTRACT_VALUE_FLAGS).toEqual(expect.arrayContaining(
      ['--out', '--id', '--chars', '--places', '--lang', '--map-type', '--map-image',
       '--chunk-size', '--overlap', '--max-chunks', '--extract-model', '--synth-model']));
  });
});

describe('parseExtractArgs — REJECT semantics (never coerce)', () => {
  test('--chars bounds imported from the palette', () => {
    expect(P(['b.txt', '--chars', '1']).errors.join(' ')).toMatch(/--chars/);
    expect(P(['b.txt', '--chars', String(DEFAULT_PALETTE.length + 1)]).errors.join(' ')).toMatch(/--chars/);
    expect(P(['b.txt', '--chars', String(DEFAULT_PALETTE.length)]).errors).toEqual([]);
  });
  test('--places validated against the RESOLVED map type', () => {
    expect(P(['b.txt', '--map-type', 'classic', '--places', '3']).errors.join(' ')).toMatch(/--places/);
    expect(P(['b.txt', '--places', '3']).errors).toEqual([]); // atlas default
    expect(P(['b.txt', '--map-image', 'm.png', '--places', '3']).errors).toEqual([]); // image implies atlas
  });
  test('--map-image conflicts with --map-type classic', () => {
    expect(P(['b.txt', '--map-image', 'm.png', '--map-type', 'classic']).errors.join(' ')).toMatch(/map-image.*classic|classic.*map-image/);
  });
  test('--id must be kebab-ASCII', () => {
    expect(P(['b.txt', '--id', 'Bad_Id']).errors.join(' ')).toMatch(/--id/);
    expect(P(['b.txt', '--id', 'good-id-2']).errors).toEqual([]);
  });
  test('numeric flags reject non-numeric and out-of-range', () => {
    expect(P(['b.txt', '--chunk-size', 'abc']).errors.join(' ')).toMatch(/--chunk-size/);
    expect(P(['b.txt', '--chunk-size', '500']).errors.join(' ')).toMatch(/--chunk-size/);
    expect(P(['b.txt', '--overlap', '9000']).errors.join(' ')).toMatch(/--overlap/); // > chunkSize/2
    expect(P(['b.txt', '--max-chunks', '0']).errors.join(' ')).toMatch(/--max-chunks/);
  });
  test('--lang accepts only auto|en|zh', () => {
    expect(P(['b.txt', '--lang', 'fr']).errors.join(' ')).toMatch(/--lang/);
  });
});
