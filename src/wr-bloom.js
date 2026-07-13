/**
 * wr-bloom — Bayer-ordered-dither radial bloom sprites for the B2 war-room shell.
 *
 * Reference algorithm: docs/superpowers/design/mockup-b2-pixel-nightlights.html
 * (ditherGlow). Sprites are tiny fixed-res canvases exported as data URIs and
 * stretched via CSS (background-size:100% + image-rendering:pixelated) so the
 * dither bands stay chunky.
 *
 * Params are a FIXED enum keyed by usage context — never continuous
 * per-instance values — which bounds the sprite cache at
 * (#player neons + type glows) × contexts.
 */

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

export const BLOOM_CONTEXTS = Object.freeze({
  // Mockup: haloSize = start ? 30 : 22; haloLevels = start ? 6 : 5; haloAlpha = owner ? 0.85 : 0.55
  node: Object.freeze({ res: 22, levels: 5, alpha: 0.55, falloff: 1.35 }),
  nodeOwned: Object.freeze({ res: 22, levels: 5, alpha: 0.85, falloff: 1.35 }),
  tokenTurn: Object.freeze({ res: 24, levels: 5, alpha: 0.9, falloff: 1.35 }),
  start: Object.freeze({ res: 30, levels: 6, alpha: 0.7, falloff: 1.35 }),
  hub: Object.freeze({ res: 26, levels: 5, alpha: 0.65, falloff: 1.35 }),
  contested: Object.freeze({ res: 22, levels: 4, alpha: 0.8, falloff: 1.35 }),
});

export function bayerMatrix(n) {
  if (n !== 4) throw new Error(`bayerMatrix: unsupported size ${n} (only 4)`);
  return BAYER4.map((row) => row.slice());
}

function ditherLevel(value, x, y, levels) {
  const v = Math.max(0, Math.min(1, value));
  const scaled = v * (levels - 1);
  const lower = Math.floor(scaled);
  const frac = scaled - lower;
  const threshold = (BAYER4[((y % 4) + 4) % 4][((x % 4) + 4) % 4] + 0.5) / 16;
  const level = frac > threshold ? lower + 1 : lower;
  return Math.max(0, Math.min(levels - 1, level)) / (levels - 1);
}

/** Final alpha (0..cfg.alpha) of the bloom at pixel (x,y) for a context config. */
export function bloomAlphaAt(x, y, cfg) {
  const R = cfg.res / 2;
  const dx = (x + 0.5 - R) / R;
  const dy = (y + 0.5 - R) / R;
  const dist = Math.sqrt(dx * dx + dy * dy);
  let raw = 1 - dist;
  if (raw <= 0) return 0;
  raw = Math.pow(raw, cfg.falloff);
  return ditherLevel(raw, x, y, cfg.levels) * cfg.alpha;
}

function hexToRgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

const cache = new Map();

function defaultCanvasFactory() {
  return document.createElement('canvas');
}

/** Dithered radial bloom sprite as a data URI, memoized per color|context. */
export function bloomSprite(color, context, canvasFactory = defaultCanvasFactory) {
  const cfg = BLOOM_CONTEXTS[context];
  if (!cfg) throw new Error(`bloomSprite: unknown bloom context "${context}"`);
  const key = `${color}|${context}`;
  if (cache.has(key)) return cache.get(key);

  const { res } = cfg;
  const canvas = canvasFactory();
  canvas.width = res;
  canvas.height = res;
  const ctx = canvas.getContext('2d');
  const rgb = hexToRgb(color);
  const img = ctx.createImageData(res, res);
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const a = bloomAlphaAt(x, y, cfg);
      if (a <= 0) continue;
      const idx = (y * res + x) * 4;
      img.data[idx] = rgb.r;
      img.data[idx + 1] = rgb.g;
      img.data[idx + 2] = rgb.b;
      img.data[idx + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const uri = canvas.toDataURL();
  cache.set(key, uri);
  return uri;
}

export function _cacheSize() {
  return cache.size;
}

export function _resetCache() {
  cache.clear();
}
