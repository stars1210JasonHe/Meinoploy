/**
 * wr-bloom — dithered radial bloom sprites (R1a foundation).
 * Reference algorithm: docs/superpowers/design/mockup-b2-pixel-nightlights.html (ditherGlow).
 */
import {
  BLOOM_CONTEXTS,
  bayerMatrix,
  bloomAlphaAt,
  bloomSprite,
  _cacheSize,
  _resetCache,
} from '../wr-bloom';

// Canvas stub factory — records creations, captures written pixels, returns fake URIs.
function makeCanvasFactory() {
  const created = [];
  const factory = () => {
    const canvas = {
      width: 0,
      height: 0,
      lastImage: null,
      getContext() {
        const c = canvas;
        return {
          createImageData(w, h) {
            return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
          },
          putImageData(img) {
            c.lastImage = img;
          },
        };
      },
      toDataURL() {
        return `data:fake/${created.indexOf(canvas)}`;
      },
    };
    created.push(canvas);
    return canvas;
  };
  factory.created = created;
  return factory;
}

describe('bayerMatrix', () => {
  test('returns the canonical 4x4 Bayer matrix', () => {
    expect(bayerMatrix(4)).toEqual([
      [0, 8, 2, 10],
      [12, 4, 14, 6],
      [3, 11, 1, 9],
      [15, 7, 13, 5],
    ]);
  });

  test('rejects unsupported sizes', () => {
    expect(() => bayerMatrix(3)).toThrow(/unsupported/i);
    expect(() => bayerMatrix(8)).toThrow(/unsupported/i);
  });
});

describe('bloomAlphaAt', () => {
  const cfg = BLOOM_CONTEXTS.node;

  test('is brightest at the center and zero outside the radius', () => {
    const mid = Math.floor(cfg.res / 2);
    expect(bloomAlphaAt(mid, mid, cfg)).toBeGreaterThan(0);
    expect(bloomAlphaAt(0, 0, cfg)).toBe(0); // corner is outside the circle
    expect(bloomAlphaAt(mid, mid, cfg)).toBeGreaterThanOrEqual(
      bloomAlphaAt(Math.floor(cfg.res * 0.85), mid, cfg)
    );
  });

  test('quantizes to at most levels-1 distinct non-zero steps', () => {
    const seen = new Set();
    for (let y = 0; y < cfg.res; y++) {
      for (let x = 0; x < cfg.res; x++) {
        const a = bloomAlphaAt(x, y, cfg);
        if (a > 0) seen.add(a.toFixed(6));
      }
    }
    expect(seen.size).toBeGreaterThan(1);
    expect(seen.size).toBeLessThanOrEqual(cfg.levels - 1);
    // every step is a multiple of alpha/(levels-1)
    const step = cfg.alpha / (cfg.levels - 1);
    for (const v of seen) {
      const k = Number(v) / step;
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-6);
    }
  });

  test('never exceeds the context alpha ceiling', () => {
    for (let y = 0; y < cfg.res; y++) {
      for (let x = 0; x < cfg.res; x++) {
        expect(bloomAlphaAt(x, y, cfg)).toBeLessThanOrEqual(cfg.alpha + 1e-9);
      }
    }
  });
});

describe('BLOOM_CONTEXTS', () => {
  test('is a frozen enum of frozen configs', () => {
    expect(Object.isFrozen(BLOOM_CONTEXTS)).toBe(true);
    for (const key of Object.keys(BLOOM_CONTEXTS)) {
      const cfg = BLOOM_CONTEXTS[key];
      expect(Object.isFrozen(cfg)).toBe(true);
      expect(cfg.res).toBeGreaterThan(0);
      expect(cfg.levels).toBeGreaterThanOrEqual(2);
      expect(cfg.alpha).toBeGreaterThan(0);
      expect(cfg.alpha).toBeLessThanOrEqual(1);
    }
    expect(() => {
      BLOOM_CONTEXTS.node = {};
    }).toThrow(TypeError);
  });

  test('mirrors the mockup parameterizations', () => {
    expect(BLOOM_CONTEXTS.node).toMatchObject({ res: 22, levels: 5, alpha: 0.55 });
    expect(BLOOM_CONTEXTS.nodeOwned).toMatchObject({ res: 22, levels: 5, alpha: 0.85 });
    expect(BLOOM_CONTEXTS.start).toMatchObject({ res: 30, levels: 6 });
  });
});

describe('bloomSprite', () => {
  beforeEach(() => _resetCache());

  test('returns a data URI and caches by color|context', () => {
    const factory = makeCanvasFactory();
    const a = bloomSprite('#00e5ff', 'node', factory);
    expect(a).toMatch(/^data:/);
    const b = bloomSprite('#00e5ff', 'node', factory);
    expect(b).toBe(a);
    expect(factory.created.length).toBe(1);
    expect(_cacheSize()).toBe(1);
  });

  test('different context or color produces a new sprite', () => {
    const factory = makeCanvasFactory();
    bloomSprite('#00e5ff', 'node', factory);
    bloomSprite('#00e5ff', 'nodeOwned', factory);
    bloomSprite('#ff4d6d', 'node', factory);
    expect(factory.created.length).toBe(3);
    expect(_cacheSize()).toBe(3);
  });

  test('throws on unknown context', () => {
    const factory = makeCanvasFactory();
    expect(() => bloomSprite('#00e5ff', 'nope', factory)).toThrow(/unknown bloom context/i);
  });

  test('writes the requested color into the sprite pixels', () => {
    const factory = makeCanvasFactory();
    bloomSprite('#00e5ff', 'node', factory);
    const img = factory.created[0].lastImage;
    const { res } = BLOOM_CONTEXTS.node;
    expect(img.width).toBe(res);
    const mid = Math.floor(res / 2);
    const idx = (mid * res + mid) * 4;
    expect(img.data[idx]).toBe(0x00);
    expect(img.data[idx + 1]).toBe(0xe5);
    expect(img.data[idx + 2]).toBe(0xff);
    expect(img.data[idx + 3]).toBeGreaterThan(0);
  });

  test('canvas is sized to the context res', () => {
    const factory = makeCanvasFactory();
    bloomSprite('#ffb648', 'start', factory);
    expect(factory.created[0].width).toBe(BLOOM_CONTEXTS.start.res);
    expect(factory.created[0].height).toBe(BLOOM_CONTEXTS.start.res);
  });
});
