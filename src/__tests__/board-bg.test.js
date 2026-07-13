/**
 * board-bg — resolution order + deterministic starfield fallback (reskin R2).
 */
import { resolveBoardBg, starfieldDataUri, _resetStarfieldCache } from '../board-bg';

function makeCanvasFactory() {
  const created = [];
  const factory = () => {
    const canvas = {
      width: 0, height: 0, ops: [],
      getContext() {
        const c = canvas;
        return {
          createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
          putImageData(img) { c.ops.push(img); },
        };
      },
      toDataURL() { return `data:starfield/${created.indexOf(canvas)}`; },
    };
    created.push(canvas);
    return canvas;
  };
  factory.created = created;
  return factory;
}

describe('resolveBoardBg', () => {
  test('atlas world bg wins', () => {
    expect(resolveBoardBg({
      isAtlas: true,
      atlasAssets: { worldBg: 'world.png', cityImages: {} },
      mapAssets: { boardBg: 'map.png' },
      mapId: 'x',
    })).toEqual({ url: 'world.png', source: 'world' });
  });

  test('classic map asset when no world bg', () => {
    expect(resolveBoardBg({
      isAtlas: false, atlasAssets: null,
      mapAssets: { boardBg: 'classic.png' }, mapId: 'classic',
    })).toEqual({ url: 'classic.png', source: 'map' });
  });

  test('null when nothing shipped (starfield fallback is the caller move)', () => {
    expect(resolveBoardBg({ isAtlas: true, atlasAssets: {}, mapAssets: null, mapId: 'y' }))
      .toEqual({ url: null, source: null });
    expect(resolveBoardBg({ isAtlas: false, atlasAssets: null, mapAssets: null, mapId: null }))
      .toEqual({ url: null, source: null });
  });
});

describe('starfieldDataUri', () => {
  beforeEach(() => _resetStarfieldCache());

  test('deterministic pixels, memoized', () => {
    const f1 = makeCanvasFactory();
    const a = starfieldDataUri(f1);
    expect(a).toMatch(/^data:/);
    expect(starfieldDataUri(f1)).toBe(a);
    expect(f1.created.length).toBe(1);

    _resetStarfieldCache();
    const f2 = makeCanvasFactory();
    starfieldDataUri(f2);
    // same seeded generator -> byte-identical image data on a fresh canvas
    expect(Array.from(f2.created[0].ops[0].data)).toEqual(Array.from(f1.created[0].ops[0].data));
  });

  test('has lit star pixels on a dark void (not a flat fill)', () => {
    const f = makeCanvasFactory();
    starfieldDataUri(f);
    const img = f.created[0].ops[0];
    let lit = 0, dark = 0;
    for (let i = 0; i < img.data.length; i += 4) {
      const lum = img.data[i] + img.data[i + 1] + img.data[i + 2];
      if (lum > 300) lit++; else dark++;
    }
    expect(lit).toBeGreaterThan(4);
    expect(dark).toBeGreaterThan(lit * 10); // stars are sparse
  });
});
