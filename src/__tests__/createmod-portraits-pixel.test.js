import { sliceCell, centerCropSquare, downscaleNearest, upscaleNearest } from '../createmod/portraits/pixel';

// Build a solid-color RGBA image with optional per-pixel painter fn
function makeImage(width, height, painter) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [r, g, b] = painter(x, y);
    const o = (y * width + x) * 4;
    data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
  }
  return { width, height, data };
}
const px = (img, x, y) => Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

describe('sliceCell', () => {
  // 3x2 grid on a 31x21 canvas: cell = floor(31/3) x floor(21/2) = 10x10; remainder col/row never read
  const grid = makeImage(31, 21, (x, y) => {
    const col = Math.min(2, Math.floor(x / 10)), row = Math.min(1, Math.floor(y / 10));
    return [row * 3 + col + 1, 0, 0]; // cell k+1 encoded in red channel
  });
  test('row-major cells with floor sizing', () => {
    for (let k = 0; k < 6; k++) {
      const cell = sliceCell(grid, { cols: 3, rows: 2 }, k);
      expect([cell.width, cell.height]).toEqual([10, 10]);
      expect(px(cell, 0, 0)[0]).toBe(k + 1);
      expect(px(cell, 9, 9)[0]).toBe(k + 1); // stays inside its cell
    }
  });
  test('does not mutate the source', () => {
    const before = Array.from(grid.data);
    sliceCell(grid, { cols: 3, rows: 2 }, 5);
    expect(Array.from(grid.data)).toEqual(before);
  });
});

describe('centerCropSquare', () => {
  test('crops a 768x1024 cell to centered 768x768', () => {
    // stripe rows: y<128 red, 128<=y<896 green, y>=896 blue → crop keeps only green
    const img = makeImage(768, 1024, (x, y) => (y < 128 ? [255, 0, 0] : y >= 896 ? [0, 0, 255] : [0, 255, 0]));
    const sq = centerCropSquare(img);
    expect([sq.width, sq.height]).toEqual([768, 768]);
    expect(px(sq, 0, 0)).toEqual([0, 255, 0, 255]);
    expect(px(sq, 767, 767)).toEqual([0, 255, 0, 255]);
  });
  test('square input is returned unchanged in content', () => {
    const img = makeImage(5, 5, (x, y) => [x * 10, y * 10, 0]);
    const sq = centerCropSquare(img);
    expect([sq.width, sq.height]).toEqual([5, 5]);
    expect(Array.from(sq.data)).toEqual(Array.from(img.data));
  });
});

describe('nearest scaling', () => {
  test('downscale picks the pinned sample point floor((i+0.5)*src/dst)', () => {
    // 4x4 quadrant image → 2x2: sample points are (1,1),(3,1),(1,3),(3,3)
    const img = makeImage(4, 4, (x, y) => [x < 2 ? 10 : 20, y < 2 ? 30 : 40, 0]);
    const d = downscaleNearest(img, 2, 2);
    expect(px(d, 0, 0)).toEqual([10, 30, 0, 255]);
    expect(px(d, 1, 0)).toEqual([20, 30, 0, 255]);
    expect(px(d, 0, 1)).toEqual([10, 40, 0, 255]);
    expect(px(d, 1, 1)).toEqual([20, 40, 0, 255]);
  });
  test('upscale 2x2 → 5x5 produces exact nearest blocks', () => {
    const img = makeImage(2, 2, (x, y) => [x, y, 0]);
    const u = upscaleNearest(img, 5, 5);
    expect([u.width, u.height]).toEqual([5, 5]);
    // sample point for dst x=2 is floor(2.5*2/5)=1 → right column
    expect(px(u, 1, 1)).toEqual([0, 0, 0, 255]);
    expect(px(u, 2, 2)).toEqual([1, 1, 0, 255]);
    expect(px(u, 4, 4)).toEqual([1, 1, 0, 255]);
  });
  test('round-trip 52 → 341 → dimensions only', () => {
    const img = makeImage(52, 52, (x, y) => [x, y, 0]);
    const u = upscaleNearest(img, 341, 341);
    expect([u.width, u.height]).toEqual([341, 341]);
    expect(u.data.length).toBe(341 * 341 * 4);
  });
});
