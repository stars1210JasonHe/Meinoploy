import { PNG } from 'pngjs';
import { generatePortraits, validateRosterIds, KEBAB_ID } from '../createmod/portraits';
import { gridGeometry } from '../createmod/portraits/prompt';

// programmatic grid PNG: cell k gets solid color (k+1, 0, 0)
function gridPngB64(n) {
  const { cols, rows, width, height } = gridGeometry(n);
  const png = new PNG({ width, height });
  const cw = Math.floor(width / cols), ch = Math.floor(height / rows);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const k = Math.min(rows - 1, Math.floor(y / ch)) * cols + Math.min(cols - 1, Math.floor(x / cw));
    const o = (y * width + x) * 4;
    png.data[o] = k + 1; png.data[o + 1] = 0; png.data[o + 2] = 0; png.data[o + 3] = 255;
  }
  return PNG.sync.write(png).toString('base64');
}
const codec = { decode: b64 => { const p = PNG.sync.read(Buffer.from(b64, 'base64')); return { width: p.width, height: p.height, data: new Uint8Array(p.data) }; } };
const roster = n => Array.from({ length: n }, (_, i) => ({ id: `char-${i}`, name: `N${i}`, title: `T${i}` }));
const lore = n => Object.fromEntries(roster(n).map(r => [r.id, { identity: 'x', background: 'y。z' }]));
const mockClient = (fail = {}) => {
  const calls = [];
  return {
    calls,
    generate: async (prompt, opts) => {
      const idx = calls.length; calls.push({ prompt, opts });
      if (fail[idx]) { const e = new Error('boom'); e.status = 500; throw e; }
      const n = (prompt.match(/grid of (\d+)/) || [, '1'])[1];
      return { b64: gridPngB64(Number(n)), usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } };
    },
  };
};

describe('validateRosterIds', () => {
  test('kebab ok, hostile rejected', () => {
    expect(validateRosterIds([{ id: 'liu-bei' }])).toEqual([]);
    const errs = validateRosterIds([{ id: '../../evil' }, { id: "x'};" }]);
    expect(errs).toHaveLength(2);
    expect(errs[0]).toContain('../../evil');
  });
  test('KEBAB_ID anchors both ends', () => {
    expect(KEBAB_ID.test('a b')).toBe(false);
    expect(KEBAB_ID.test('ok-id-9')).toBe(true);
  });
});

describe('generatePortraits', () => {
  test('single batch: one call, per-char 341x341 portraits in roster order', async () => {
    const client = mockClient();
    const r = await generatePortraits({ roster: roster(8), lore: lore(8) }, {}, client, codec);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].opts.size).toBe('1024x1024'); // n=8 -> 3x3
    expect(r.portraits.map(p => p.id)).toEqual(roster(8).map(c => c.id));
    for (const p of r.portraits) expect([p.image.width, p.image.height]).toEqual([341, 341]);
    // cell colors made it through the pipeline in order (red channel k+1 survives quantize of a solid cell)
    expect(r.portraits[0].image.data[0]).toBe(1);
    expect(r.portraits[7].image.data[0]).toBe(8);
    expect(r.usage).toEqual({ input_tokens: 10, output_tokens: 20, total_tokens: 30 });
  });
  test('multi-batch 17 -> [9,8], two calls, usage summed', async () => {
    const client = mockClient();
    const r = await generatePortraits({ roster: roster(17), lore: lore(17) }, {}, client, codec);
    expect(client.calls).toHaveLength(2);
    expect(r.portraits).toHaveLength(17);
    expect(r.usage.total_tokens).toBe(60);
    expect(r.warnings.some(w => /style drift/i.test(w))).toBe(true);
  });
  test('ATOMIC: batch 2 failure rejects with no partial result', async () => {
    const client = mockClient({ 1: true });
    await expect(generatePortraits({ roster: roster(17), lore: lore(17) }, {}, client, codec))
      .rejects.toMatchObject({ status: 500 });
  });
  test('dryRun: plan only, zero client calls', async () => {
    const client = mockClient();
    const r = await generatePortraits({ roster: roster(3), lore: lore(3) }, { dryRun: true }, client, codec);
    expect(client.calls).toHaveLength(0);
    expect(r.portraits).toEqual([]);
    expect(r.plan).toHaveLength(1);
    expect(r.plan[0].count).toBe(3);
    expect(r.plan[0].prompt).toContain('UNIFORM 2x2 grid of 3');
  });
  test('style cap enforced here (shared entry): >600 chars throws', async () => {
    await expect(generatePortraits({ roster: roster(2), lore: {} }, { style: 'x'.repeat(601) }, mockClient(), codec))
      .rejects.toThrow(/--style.*600/);
  });
  test('hostile roster id rejected before any call', async () => {
    const client = mockClient();
    await expect(generatePortraits({ roster: [{ id: '../../evil', name: 'E' }], lore: {} }, {}, client, codec))
      .rejects.toThrow(/\.\.\/\.\.\/evil/);
    expect(client.calls).toHaveLength(0);
  });
});
