import fs from 'fs';
import os from 'os';
import path from 'path';
import { createMod, parseArgs } from '../../scripts/create-mod';

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'createmod-smart-'));
  fs.mkdirSync(path.join(root, 'mods'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'mods', 'index.js'),
    `import { dominionData } from './dominion/bundle.data';\nexport const MODS = {\n  dominion: dominionData,\n};\n`);
  fs.writeFileSync(path.join(root, 'src', 'App.js'),
    `import dominionMod from '../mods/dominion/bundle.client';\nconst MODS = [dominionMod];\n`);
  return root;
}
const ATLAS_FACTS = path.join(__dirname, '../../examples/create-mod/silk-road.facts.json');
const CLASSIC_FACTS = path.join(__dirname, '../../examples/create-mod/gilded-rails.facts.json');

describe('parseArgs --smart/--seed', () => {
  test('flags parse', () => {
    expect(parseArgs(['f.json', '--smart', '--seed', 'abc']))
      .toMatchObject({ input: 'f.json', smart: true, seed: 'abc' });
    expect(parseArgs(['f.json'])).toMatchObject({ smart: false, seed: null });
  });
});

describe('createMod smart mode (fs round-trip)', () => {
  test('atlas facts: writes tree + patches registries', () => {
    const root = makeRoot();
    const r = createMod({ inputPath: ATLAS_FACTS, rootDir: root, smart: true });
    expect(r.ok).toBe(true);
    expect(fs.existsSync(path.join(root, 'mods', 'silk-road', 'bundle.data.js'))).toBe(true);
    expect(fs.readFileSync(path.join(root, 'mods', 'index.js'), 'utf8')).toContain("'silk-road': silkRoadData,");
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('classic facts: writes tree', () => {
    const root = makeRoot();
    const r = createMod({ inputPath: CLASSIC_FACTS, rootDir: root, smart: true });
    expect(r.ok).toBe(true);
    expect(fs.existsSync(path.join(root, 'mods', 'gilded-rails', 'gilded-rails.data.json'))).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('smart dry-run: writes nothing, returns the derived input', () => {
    const root = makeRoot();
    const r = createMod({ inputPath: ATLAS_FACTS, rootDir: root, smart: true, dryRun: true });
    expect(r.ok).toBe(true);
    expect(r.input.world.hubs.length).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(path.join(root, 'mods', 'silk-road'))).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('impossible derivation returns {ok:false} with no input (dry-run included)', () => {
    const root = makeRoot();
    const badPath = path.join(root, 'bad.facts.json');
    fs.writeFileSync(badPath, JSON.stringify({ id: 'bad', name: 'Bad', mapType: 'classic', board: { groups: [] }, roster: [{ id: 'a', name: 'A', passive: 'enforcer' }] }));
    const r = createMod({ inputPath: badPath, rootDir: root, smart: true, dryRun: true });
    expect(r.ok).toBe(false);
    expect(r.input).toBeUndefined();
    expect(r.errors.join(' ')).toMatch(/>=2 groups/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('null facts file returns clean {ok:false}, no raw TypeError', () => {
    const root = makeRoot();
    const nullPath = path.join(root, 'null.facts.json');
    fs.writeFileSync(nullPath, 'null');
    const r = createMod({ inputPath: nullPath, rootDir: root, smart: true });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/smart-build failed/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('non-smart path is untouched (near-final json still works)', () => {
    const root = makeRoot();
    const r = createMod({
      inputPath: path.join(__dirname, '../../examples/create-mod/ancient-empires.atlas.json'),
      rootDir: root,
    });
    expect(r.ok).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
