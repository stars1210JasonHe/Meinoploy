import fs from 'fs';
import os from 'os';
import path from 'path';
import { PNG } from 'pngjs';
import { runGenPortraits, resolveImageModel } from '../../scripts/gen-portraits';
import { gridGeometry } from '../createmod/portraits/prompt';

const codec = {
  decode: b64 => { const p = PNG.sync.read(Buffer.from(b64, 'base64')); return { width: p.width, height: p.height, data: new Uint8Array(p.data) }; },
  encode: img => { const p = new PNG({ width: img.width, height: img.height }); p.data = Buffer.from(img.data); return PNG.sync.write(p); },
};
function gridPngB64(n) {
  const { cols, rows, width, height } = gridGeometry(n);
  const png = new PNG({ width, height });
  const cw = Math.floor(width / cols), ch = Math.floor(height / rows);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const k = Math.min(rows - 1, Math.floor(y / ch)) * cols + Math.min(cols - 1, Math.floor(x / cw));
    const o = (y * width + x) * 4;
    png.data[o] = k + 1; png.data[o + 3] = 255;
  }
  return PNG.sync.write(png).toString('base64');
}
const okClient = () => ({ calls: 0, generate: async function (prompt) { this.calls++; const n = Number((prompt.match(/grid of (\d+)/) || [, '1'])[1]); return { b64: gridPngB64(n), usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } }; } });
const failClient = () => ({ calls: 0, generate: async function () { this.calls++; const e = new Error('boom sk-NOPE'); e.status = 500; throw e; } });

function makeMod(rootDir, id, n = 2, extra = {}) {
  const dir = path.join(rootDir, 'mods', id);
  fs.mkdirSync(dir, { recursive: true });
  const roster = Array.from({ length: n }, (_, i) => ({ id: `hero-${i}`, name: `H${i}`, title: `T${i}`, stats: {}, passive: 'pioneer', color: '#fff' }));
  const lore = Object.fromEntries(roster.map(r => [r.id, { identity: 'id', background: 'bg。rest' }]));
  fs.writeFileSync(path.join(dir, `${id}.data.json`), JSON.stringify({ name: extra.name, roster, lore, world: {} }));
  fs.writeFileSync(path.join(dir, 'characters.js'), '// placeholder characters.js\n');
  if (extra.bundleName) fs.writeFileSync(path.join(dir, 'bundle.data.js'), `// x\nexport const y = {\n  name: ${JSON.stringify(extra.bundleName)},\n};\n`);
  return dir;
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'genport-'));

describe('runGenPortraits', () => {
  test('happy path: PNGs written, characters.js re-rendered, report written', async () => {
    const root = tmp(); makeMod(root, 'my-mod', 2, { name: 'My "Mod"' });
    const client = okClient();
    const logs = []; const r = await runGenPortraits({ modId: 'my-mod', rootDir: root, log: m => logs.push(m) }, client, codec);
    expect(r.ok).toBe(true);
    for (const i of [0, 1]) {
      const png = PNG.sync.read(fs.readFileSync(path.join(root, 'mods/my-mod/portraits', `hero-${i}.png`)));
      expect([png.width, png.height]).toEqual([341, 341]);
    }
    const chars = fs.readFileSync(path.join(root, 'mods/my-mod/characters.js'), 'utf8');
    expect(chars).toContain("from './portraits/hero-0.png'");
    expect(chars).toContain("from './portraits/hero-1.png'");
    expect(chars).toContain('PORTRAIT_MAP');
    expect(chars.split('\n')[0]).toContain('My "Mod"');
    expect(fs.existsSync(r.reportPath)).toBe(true);
    expect(logs.join('\n')).toMatch(/2 character\(s\).*1 image call/);
  });
  test('name fallback: bundle.data.js parse, then mod id', async () => {
    const root = tmp(); makeMod(root, 'old-mod', 1, { name: undefined, bundleName: 'Bundle "Named"' });
    await runGenPortraits({ modId: 'old-mod', rootDir: root }, okClient(), codec);
    expect(fs.readFileSync(path.join(root, 'mods/old-mod/characters.js'), 'utf8').split('\n')[0]).toContain('Bundle "Named"');
    const root2 = tmp(); makeMod(root2, 'bare-mod', 1, {});
    await runGenPortraits({ modId: 'bare-mod', rootDir: root2 }, okClient(), codec);
    expect(fs.readFileSync(path.join(root2, 'mods/bare-mod/characters.js'), 'utf8').split('\n')[0]).toContain('bare-mod');
  });
  test('no-op when all portraits exist; --force regenerates; partial set regenerates without force', async () => {
    const root = tmp(); makeMod(root, 'm', 2);
    await runGenPortraits({ modId: 'm', rootDir: root }, okClient(), codec);
    const c2 = okClient();
    const r2 = await runGenPortraits({ modId: 'm', rootDir: root }, c2, codec);
    expect(r2.ok).toBe(true); expect(c2.calls).toBe(0); // no-op
    fs.rmSync(path.join(root, 'mods/m/portraits/hero-1.png')); // partial
    const c3 = okClient();
    await runGenPortraits({ modId: 'm', rootDir: root }, c3, codec);
    expect(c3.calls).toBe(1);
    const c4 = okClient();
    await runGenPortraits({ modId: 'm', rootDir: root, force: true }, c4, codec);
    expect(c4.calls).toBe(1);
  });
  test('failure preserves existing portraits byte-identical (force AND partial paths), report written key-free', async () => {
    const root = tmp(); makeMod(root, 'm', 2);
    await runGenPortraits({ modId: 'm', rootDir: root }, okClient(), codec);
    const before = fs.readFileSync(path.join(root, 'mods/m/portraits/hero-0.png'));
    const rf = await runGenPortraits({ modId: 'm', rootDir: root, force: true }, failClient(), codec);
    expect(rf.ok).toBe(false);
    expect(fs.readFileSync(path.join(root, 'mods/m/portraits/hero-0.png')).equals(before)).toBe(true);
    const report = fs.readFileSync(rf.reportPath, 'utf8');
    expect(report).toContain('boom'); expect(report).not.toContain('sk-NOPE');
    fs.rmSync(path.join(root, 'mods/m/portraits/hero-1.png'));
    const rp = await runGenPortraits({ modId: 'm', rootDir: root }, failClient(), codec);
    expect(rp.ok).toBe(false);
    expect(fs.readFileSync(path.join(root, 'mods/m/portraits/hero-0.png')).equals(before)).toBe(true);
  });
  test('stale kebab PNGs pruned on success, listed in plan log; non-matching files untouched', async () => {
    const root = tmp(); makeMod(root, 'm', 1);
    const pdir = path.join(root, 'mods/m/portraits'); fs.mkdirSync(pdir, { recursive: true });
    fs.writeFileSync(path.join(pdir, 'gone-hero.png'), 'x');
    fs.writeFileSync(path.join(pdir, 'NOTES.txt'), 'keep');
    const logs = [];
    await runGenPortraits({ modId: 'm', rootDir: root, log: m => logs.push(m) }, okClient(), codec);
    expect(fs.existsSync(path.join(pdir, 'gone-hero.png'))).toBe(false);
    expect(fs.existsSync(path.join(pdir, 'NOTES.txt'))).toBe(true);
    expect(logs.join('\n')).toContain('gone-hero.png');
  });
  test('dry-run: zero calls, zero writes, prune preview printed', async () => {
    const root = tmp(); makeMod(root, 'm', 1);
    const pdir = path.join(root, 'mods/m/portraits'); fs.mkdirSync(pdir, { recursive: true });
    fs.writeFileSync(path.join(pdir, 'stale-one.png'), 'x');
    const client = okClient(); const logs = [];
    const r = await runGenPortraits({ modId: 'm', rootDir: root, dryRun: true, log: m => logs.push(m) }, client, codec);
    expect(r.ok).toBe(true); expect(client.calls).toBe(0);
    expect(fs.existsSync(path.join(pdir, 'hero-0.png'))).toBe(false);
    expect(logs.join('\n')).toContain('stale-one.png');
    expect(logs.join('\n')).toMatch(/UNIFORM|single pixel-art/);
  });
  test('style cap enforced through the shared CLI entry (spec §9 chained-path coverage)', async () => {
    const root = tmp(); makeMod(root, 'm', 1);
    const client = okClient();
    await expect(runGenPortraits({ modId: 'm', rootDir: root, style: 'x'.repeat(601) }, client, codec)).rejects.toThrow(/600/);
    expect(client.calls).toBe(0);
  });
  test('guards: hostile mod id, missing mod, portraits-as-file, hostile roster id', async () => {
    const root = tmp();
    await expect(runGenPortraits({ modId: '../evil', rootDir: root }, okClient(), codec)).rejects.toThrow(/mod id/);
    await expect(runGenPortraits({ modId: 'nope', rootDir: root }, okClient(), codec)).rejects.toThrow(/not found/);
    makeMod(root, 'm', 1);
    fs.writeFileSync(path.join(root, 'mods/m/portraits'), 'a file!');
    await expect(runGenPortraits({ modId: 'm', rootDir: root }, okClient(), codec)).rejects.toThrow(/portraits.*file/i);
    const root2 = tmp(); const dir2 = makeMod(root2, 'm2', 1);
    const dj = JSON.parse(fs.readFileSync(path.join(dir2, 'm2.data.json'), 'utf8'));
    dj.roster[0].id = '../../evil';
    fs.writeFileSync(path.join(dir2, 'm2.data.json'), JSON.stringify(dj));
    const client = okClient();
    await expect(runGenPortraits({ modId: 'm2', rootDir: root2 }, client, codec)).rejects.toThrow(/evil/);
    expect(client.calls).toBe(0);
  });
});

describe('resolveImageModel', () => {
  test('flag > env > default', () => {
    expect(resolveImageModel({ imageModel: 'x' })).toBe('x');
    const old = process.env.IMAGE_MODEL;
    process.env.IMAGE_MODEL = 'env-model';
    expect(resolveImageModel({})).toBe('env-model');
    if (old === undefined) delete process.env.IMAGE_MODEL; else process.env.IMAGE_MODEL = old;
    expect(resolveImageModel({})).toBe('gpt-image-1');
  });
});
