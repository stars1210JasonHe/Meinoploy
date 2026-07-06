// Create-Mod portraits — pure RGBA pixel ops. Images are plain
// { width, height, data: Uint8Array } (RGBA); every op returns a NEW image.
// No codec here: PNG encode/decode lives in the CLI (pngjs).

function blank(width, height) {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

function copyRect(src, x0, y0, w, h) {
  const out = blank(w, h);
  for (let y = 0; y < h; y++) {
    const srcOff = ((y0 + y) * src.width + x0) * 4;
    out.data.set(src.data.subarray(srcOff, srcOff + w * 4), y * w * 4);
  }
  return out;
}

export function sliceCell(img, geom, k) {
  const cw = Math.floor(img.width / geom.cols);
  const ch = Math.floor(img.height / geom.rows);
  const col = k % geom.cols;
  const row = Math.floor(k / geom.cols);
  return copyRect(img, col * cw, row * ch, cw, ch);
}

export function centerCropSquare(img) {
  const side = Math.min(img.width, img.height);
  const x0 = Math.floor((img.width - side) / 2);
  const y0 = Math.floor((img.height - side) / 2);
  return copyRect(img, x0, y0, side, side);
}

function resampleNearest(img, w, h) {
  const out = blank(w, h);
  for (let y = 0; y < h; y++) {
    const sy = Math.floor((y + 0.5) * img.height / h);
    for (let x = 0; x < w; x++) {
      const sx = Math.floor((x + 0.5) * img.width / w);
      const so = (sy * img.width + sx) * 4;
      out.data.set(img.data.subarray(so, so + 4), (y * w + x) * 4);
    }
  }
  return out;
}

export function downscaleNearest(img, w, h) { return resampleNearest(img, w, h); }
export function upscaleNearest(img, w, h) { return resampleNearest(img, w, h); }

// Deterministic median cut (spec §6): boxes split largest channel range
// (range tie R>G>B, box tie lowest creation index / FIFO); split at
// floor(count/2) into the lower box; palette = per-box rounded mean;
// pixel -> nearest palette color by squared distance (tie lowest index).
// Alpha excluded from ranges/distances and forced to 255 in the output.
export function quantizeMedianCut(img, maxColors) {
  const n = img.width * img.height;
  const pixels = new Array(n);
  for (let i = 0; i < n; i++) pixels[i] = [img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]];

  const boxes = [{ pixels, created: 0 }];
  let createdCounter = 1;
  while (boxes.length < maxColors) {
    let best = -1, bestRange = 0, bestCh = 0;
    for (let b = 0; b < boxes.length; b++) {
      if (boxes[b].pixels.length < 2) continue;
      for (let ch = 0; ch < 3; ch++) {
        let lo = 255, hi = 0;
        for (const p of boxes[b].pixels) { if (p[ch] < lo) lo = p[ch]; if (p[ch] > hi) hi = p[ch]; }
        const range = hi - lo;
        // strictly-greater keeps: channel tie -> R>G>B (earlier ch wins),
        // box tie -> lowest creation index (earlier b wins)
        if (range > bestRange) { bestRange = range; best = b; bestCh = ch; }
      }
    }
    if (best < 0 || bestRange === 0) break; // nothing splittable
    const box = boxes[best];
    box.pixels.sort((a, b) => a[bestCh] - b[bestCh]); // V8 sort is stable
    const cut = Math.floor(box.pixels.length / 2);
    const lower = { pixels: box.pixels.slice(0, cut), created: createdCounter++ };
    const upper = { pixels: box.pixels.slice(cut), created: createdCounter++ };
    boxes.splice(best, 1, lower, upper);
  }

  const palette = boxes.map(box => {
    const sum = [0, 0, 0];
    for (const p of box.pixels) { sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2]; }
    const c = box.pixels.length || 1;
    return [Math.round(sum[0] / c), Math.round(sum[1] / c), Math.round(sum[2] / c)];
  });

  const out = { width: img.width, height: img.height, data: new Uint8Array(img.data.length) };
  for (let i = 0; i < n; i++) {
    const r = img.data[i * 4], g = img.data[i * 4 + 1], b = img.data[i * 4 + 2];
    let bestIdx = 0, bestDist = Infinity;
    for (let p = 0; p < palette.length; p++) {
      const dr = r - palette[p][0], dg = g - palette[p][1], db = b - palette[p][2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestDist) { bestDist = d; bestIdx = p; } // strict < -> lowest index wins ties
    }
    out.data[i * 4] = palette[bestIdx][0];
    out.data[i * 4 + 1] = palette[bestIdx][1];
    out.data[i * 4 + 2] = palette[bestIdx][2];
    out.data[i * 4 + 3] = 255;
  }
  return out;
}

export const PORTRAIT_SIZE = 341;
export const PIXEL_GRID = 52;
export const PALETTE_SIZE = 24;

export function pixelizeCell(cell) {
  const square = centerCropSquare(cell);
  const small = downscaleNearest(square, PIXEL_GRID, PIXEL_GRID);
  const quant = quantizeMedianCut(small, PALETTE_SIZE);
  return upscaleNearest(quant, PORTRAIT_SIZE, PORTRAIT_SIZE);
}
