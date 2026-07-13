// Board background layer (reskin R2) — pure helpers for the .board__bg layer.
// Resolution order (spec §2): atlas world art > classic map art > null, where
// null means the caller paints the engine-default starfield.

export function resolveBoardBg({ isAtlas, atlasAssets, mapAssets, mapId }) {
  if (isAtlas && atlasAssets && atlasAssets.worldBg) {
    return { url: atlasAssets.worldBg, source: 'world' };
  }
  if (mapAssets && mapAssets.boardBg) {
    return { url: mapAssets.boardBg, source: 'map' };
  }
  return { url: null, source: null };
}

// Deterministic hash noise (same recipe as the B2 mockup's terrain grain) —
// no Math.random, so tests and repeated sessions get byte-identical output.
function hash2(x, y) {
  const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

const STARFIELD_W = 240;
const STARFIELD_H = 150;

let starfieldCache = null;

function defaultCanvasFactory() {
  return document.createElement('canvas');
}

/** Engine-default backdrop: banded void with sparse pixel stars (memoized). */
export function starfieldDataUri(canvasFactory = defaultCanvasFactory) {
  if (starfieldCache) return starfieldCache;
  const w = STARFIELD_W, h = STARFIELD_H;
  const canvas = canvasFactory();
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      // banded vertical void: three hard steps, no smooth wash
      const band = y < h * 0.35 ? [8, 19, 39] : y < h * 0.7 ? [5, 12, 26] : [1, 2, 5];
      let [r, g, b] = band;
      const n = hash2(x, y);
      if (n > 0.9975) { r = 143; g = 240; b = 255; }        // bright cyan star
      else if (n > 0.994) { r = 90; g = 130; b = 170; }      // dim steel star
      else if (n > 0.988) { r = band[0] + 10; g = band[1] + 14; b = band[2] + 20; } // faint grain
      img.data[idx] = r; img.data[idx + 1] = g; img.data[idx + 2] = b; img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  starfieldCache = canvas.toDataURL();
  return starfieldCache;
}

export function _resetStarfieldCache() {
  starfieldCache = null;
}
