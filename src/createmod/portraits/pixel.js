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
