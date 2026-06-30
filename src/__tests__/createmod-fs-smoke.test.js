import fs from 'fs';
import os from 'os';
import path from 'path';
import { createMod, removeMod, parseArgs } from '../../scripts/create-mod';

// Minimal stand-in registries (same anchors as the real files) in a temp root that also
// contains a real `mods/dominion` symlink-free copy is NOT needed: createMod only READS the
// two registry files + WRITES the mod tree; it never builds. We seed the two anchor files.
function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'createmod-'));
  fs.mkdirSync(path.join(root, 'mods'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'mods', 'index.js'),
    `import { dominionData } from './dominion/bundle.data';\nexport const MODS = {\n  dominion: dominionData,\n};\n`);
  fs.writeFileSync(path.join(root, 'src', 'App.js'),
    `import dominionMod from '../mods/dominion/bundle.client';\nconst MODS = [dominionMod];\n`);
  return root;
}
const ATLAS = path.join(__dirname, '../../examples/create-mod/ancient-empires.atlas.json');
const CLASSIC = path.join(__dirname, '../../examples/create-mod/steam-barons.classic.json');

describe('parseArgs', () => {
  test('positional input + flags', () => {
    expect(parseArgs(['in.json', '--dry-run', '--force'])).toMatchObject({ input: 'in.json', dryRun: true, force: true });
    expect(parseArgs(['--remove', 'foo'])).toMatchObject({ remove: 'foo' });
  });
});

describe('createMod / removeMod fs round-trip', () => {
  test('atlas: writes tree + patches registries; remove reverts byte-identical', () => {
    const root = makeRoot();
    const idx0 = fs.readFileSync(path.join(root, 'mods', 'index.js'), 'utf8');
    const app0 = fs.readFileSync(path.join(root, 'src', 'App.js'), 'utf8');
    const r = createMod({ inputPath: ATLAS, rootDir: root });
    expect(r.ok).toBe(true);
    expect(fs.existsSync(path.join(root, 'mods', 'ancient-empires', 'bundle.data.js'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'mods', 'ancient-empires', 'ancient-empires.data.json'))).toBe(true);
    expect(fs.readFileSync(path.join(root, 'mods', 'index.js'), 'utf8')).toContain("'ancient-empires': ancientEmpiresData,");
    expect(fs.readFileSync(path.join(root, 'src', 'App.js'), 'utf8')).toContain('ancientEmpiresMod');

    const rm = removeMod({ id: 'ancient-empires', rootDir: root });
    expect(rm.ok).toBe(true);
    expect(fs.existsSync(path.join(root, 'mods', 'ancient-empires'))).toBe(false);
    expect(fs.readFileSync(path.join(root, 'mods', 'index.js'), 'utf8')).toBe(idx0);
    expect(fs.readFileSync(path.join(root, 'src', 'App.js'), 'utf8')).toBe(app0);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('classic: writes tree + patches registries', () => {
    const root = makeRoot();
    const r = createMod({ inputPath: CLASSIC, rootDir: root });
    expect(r.ok).toBe(true);
    expect(fs.existsSync(path.join(root, 'mods', 'steam-barons', 'bundle.data.js'))).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('dry-run writes nothing', () => {
    const root = makeRoot();
    const r = createMod({ inputPath: ATLAS, rootDir: root, dryRun: true });
    expect(r.ok).toBe(true);
    expect(fs.existsSync(path.join(root, 'mods', 'ancient-empires'))).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('removeMod refuses an invalid id', () => {
    const root = makeRoot();
    const r = removeMod({ id: '../evil', rootDir: root });
    expect(r.ok).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('dup id without --force errors; --force overrides', () => {
    const root = makeRoot();
    expect(createMod({ inputPath: ATLAS, rootDir: root }).ok).toBe(true);
    const dup = createMod({ inputPath: ATLAS, rootDir: root });
    expect(dup.ok).toBe(false);
    expect(dup.errors.join(' ')).toMatch(/already registered/);
    expect(createMod({ inputPath: ATLAS, rootDir: root, force: true }).ok).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('missing portrait source returns {ok:false} and writes no mod tree', () => {
    const root = makeRoot();
    const badInput = path.join(root, 'bad.atlas.json');
    const spec = JSON.parse(fs.readFileSync(ATLAS, 'utf8'));
    spec.id = 'ghost-mod';
    spec.roster[0].portrait = 'portraits/does-not-exist.png';
    fs.writeFileSync(badInput, JSON.stringify(spec));
    const r = createMod({ inputPath: badInput, rootDir: root });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/portrait source not found/);
    expect(fs.existsSync(path.join(root, 'mods', 'ghost-mod'))).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
