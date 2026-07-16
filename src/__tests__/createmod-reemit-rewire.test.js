// Ticket 2026-07-14 (ROADMAP "create-mod balance integration" + ledger): `create-mod --force`
// re-emits a mod's files from the input, which CLOBBERS two post-creation enrichments that
// don't round-trip through the input JSON: gen-portraits' portraits/*.png -> characters.js
// PORTRAIT_MAP wiring, and gen-boardbg's backgrounds/*.png -> bundle.client.js atlasAssets/
// mapAssets wiring. createMod() now runs a zero-API post-write REWIRE pass that re-derives
// both from whatever survives on disk. These tests exercise that pass end-to-end through the
// real createMod() fs round-trip (same makeRoot() convention as createmod-fs-smoke.test.js) —
// never touching the real committed mods/dominion, mods/silk-road, mods/gilded-rails trees.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createMod } from '../../scripts/create-mod';
import { patchBundleClientBoardBg, boardBgTarget } from '../createmod/boardbg';

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'createmod-rewire-'));
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
const ATLAS_ROSTER = ['hammurabi', 'cyrus-the-great', 'alexander-the-great'];
const CLASSIC_ROSTER = ['ada-ironwright', 'silas-vance'];

// Nothing in the rewire pass decodes these — createMod only checks file EXISTENCE (a PNG for
// every roster id / a backgrounds/<targetId>.png) — so arbitrary bytes are enough here.
const FAKE_PNG = Buffer.from('fake-png-bytes');

function plantPortraits(root, modId, ids) {
  const dir = path.join(root, 'mods', modId, 'portraits');
  fs.mkdirSync(dir, { recursive: true });
  for (const id of ids) fs.writeFileSync(path.join(dir, `${id}.png`), FAKE_PNG);
}
function plantBackground(root, modId, targetId) {
  const dir = path.join(root, 'mods', modId, 'backgrounds');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${targetId}.png`), FAKE_PNG);
}

describe('createMod --force rewire pass: portraits + boardBg survive re-emit', () => {
  test('atlas: enrichments present -> characters.js + bundle.client.js re-wired (atlasAssets)', () => {
    const root = makeRoot();
    expect(createMod({ inputPath: ATLAS, rootDir: root }).ok).toBe(true);

    plantPortraits(root, 'ancient-empires', ATLAS_ROSTER);
    plantBackground(root, 'ancient-empires', 'ancient-empires');

    const r = createMod({ inputPath: ATLAS, rootDir: root, force: true });
    expect(r.ok).toBe(true);
    expect(r.rewire.portraits).toBe(3);
    expect(r.rewire.boardBg).toEqual({ kind: 'world', targetId: 'ancient-empires' });

    const chars = fs.readFileSync(path.join(root, 'mods/ancient-empires/characters.js'), 'utf8');
    expect(chars).toContain('PORTRAIT_MAP');
    for (const id of ATLAS_ROSTER) expect(chars).toContain(`from './portraits/${id}.png'`);

    const bundle = fs.readFileSync(path.join(root, 'mods/ancient-empires/bundle.client.js'), 'utf8');
    expect(bundle).toContain("import boardBg from './backgrounds/ancient-empires.png';");
    expect(bundle).toContain("atlasAssets: { 'ancient-empires': { worldBg: boardBg, cityImages: {} } },");
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('classic: enrichments present -> characters.js + bundle.client.js re-wired (mapAssets, atlasAssets untouched)', () => {
    const root = makeRoot();
    expect(createMod({ inputPath: CLASSIC, rootDir: root }).ok).toBe(true);

    plantPortraits(root, 'steam-barons', CLASSIC_ROSTER);
    plantBackground(root, 'steam-barons', 'steam-barons');

    const r = createMod({ inputPath: CLASSIC, rootDir: root, force: true });
    expect(r.ok).toBe(true);
    expect(r.rewire.portraits).toBe(2);
    expect(r.rewire.boardBg).toEqual({ kind: 'map', targetId: 'steam-barons' });

    const chars = fs.readFileSync(path.join(root, 'mods/steam-barons/characters.js'), 'utf8');
    for (const id of CLASSIC_ROSTER) expect(chars).toContain(`from './portraits/${id}.png'`);

    const bundle = fs.readFileSync(path.join(root, 'mods/steam-barons/bundle.client.js'), 'utf8');
    expect(bundle).toContain("import boardBg from './backgrounds/steam-barons.png';");
    expect(bundle).toContain('atlasAssets: {},'); // untouched — classic mods never populate it
    expect(bundle).toContain("mapAssets: { 'steam-barons': { boardBg: boardBg } },");
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('re-emit WITHOUT enrichments present -> plain template, no bogus wiring', () => {
    const root = makeRoot();
    expect(createMod({ inputPath: ATLAS, rootDir: root }).ok).toBe(true);
    const before = fs.readFileSync(path.join(root, 'mods/ancient-empires/characters.js'), 'utf8');

    // Force re-emit with NOTHING planted on disk (no portraits/, no backgrounds/).
    const r = createMod({ inputPath: ATLAS, rootDir: root, force: true });
    expect(r.ok).toBe(true);
    expect(r.rewire.portraits).toBe(0);
    expect(r.rewire.boardBg).toBeNull();

    const chars = fs.readFileSync(path.join(root, 'mods/ancient-empires/characters.js'), 'utf8');
    expect(chars).toBe(before); // identical plain (un-wired) template both times
    expect(chars).not.toContain("from './portraits/");

    const bundle = fs.readFileSync(path.join(root, 'mods/ancient-empires/bundle.client.js'), 'utf8');
    expect(bundle).toContain('atlasAssets: {},');
    expect(bundle).not.toContain('backgrounds/');
    expect(bundle).not.toContain('mapAssets');
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('idempotency: two --force re-emits with the same enrichments on disk produce byte-identical files', () => {
    const root = makeRoot();
    expect(createMod({ inputPath: ATLAS, rootDir: root }).ok).toBe(true);
    plantPortraits(root, 'ancient-empires', ATLAS_ROSTER);
    plantBackground(root, 'ancient-empires', 'ancient-empires');

    const r1 = createMod({ inputPath: ATLAS, rootDir: root, force: true });
    const chars1 = fs.readFileSync(path.join(root, 'mods/ancient-empires/characters.js'));
    const bundle1 = fs.readFileSync(path.join(root, 'mods/ancient-empires/bundle.client.js'));

    const r2 = createMod({ inputPath: ATLAS, rootDir: root, force: true });
    const chars2 = fs.readFileSync(path.join(root, 'mods/ancient-empires/characters.js'));
    const bundle2 = fs.readFileSync(path.join(root, 'mods/ancient-empires/bundle.client.js'));

    expect(r1.rewire).toEqual(r2.rewire);
    expect(chars1.equals(chars2)).toBe(true);
    expect(bundle1.equals(bundle2)).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('patchBundleClientBoardBg (pure): idempotent + tolerant of both template variants', () => {
  const PLAIN_ATLAS = `// X — Tier-B bundle (CLIENT only). Layers images over Tier-A. Generated by create-mod.
// NEVER import from Game.js / server.js / the sim / tests (pulls the keyArt PNG + globe lib).
import { xData } from './bundle.data';
import { CHARACTERS } from './characters';
import keyArt from '../dominion/keyart.png';
import { getGlobe } from '../dominion/atlas/globe-lib';

export const xClient = Object.assign({}, xData, {
  characters: CHARACTERS,
  portraits: {},
  keyArt: keyArt,
  atlasAssets: {},
  getGlobe: getGlobe,
});

export default xClient;
`;
  const PLAIN_CLASSIC = PLAIN_ATLAS; // classic template's default shape (no worldBg/mapImage) is identical

  test('world target wires atlasAssets + import, once', () => {
    const target = { kind: 'world', targetId: 'my-world' };
    const first = patchBundleClientBoardBg(PLAIN_ATLAS, target);
    expect(first.changed).toBe(true);
    expect(first.contents).toContain("import boardBg from './backgrounds/my-world.png';");
    expect(first.contents).toContain("atlasAssets: { 'my-world': { worldBg: boardBg, cityImages: {} } },");

    const second = patchBundleClientBoardBg(first.contents, target); // already wired
    expect(second.changed).toBe(false);
    expect(second.contents).toBe(first.contents);
  });

  test('map target wires mapAssets alongside untouched atlasAssets: {}, once', () => {
    const target = { kind: 'map', targetId: 'my-map' };
    const first = patchBundleClientBoardBg(PLAIN_CLASSIC, target);
    expect(first.changed).toBe(true);
    expect(first.contents).toContain("import boardBg from './backgrounds/my-map.png';");
    expect(first.contents).toContain('atlasAssets: {},');
    expect(first.contents).toContain("mapAssets: { 'my-map': { boardBg: boardBg } },");

    const second = patchBundleClientBoardBg(first.contents, target);
    expect(second.changed).toBe(false);
  });

  test('non-kebab targetId is refused (never interpolated into generated source)', () => {
    for (const bad of ["o'brien", 'a b', 'UPPER', '', "x'; alert(1); '"]) {
      const r = patchBundleClientBoardBg(PLAIN_ATLAS, { kind: 'world', targetId: bad });
      expect(r.changed).toBe(false);
      expect(r.contents).toBe(PLAIN_ATLAS);
    }
  });

  test('tolerant: unrecognized/hand-edited shape (no getGlobe import) is left untouched', () => {
    const hostile = 'export default {};\n';
    const r = patchBundleClientBoardBg(hostile, { kind: 'world', targetId: 'x' });
    expect(r.changed).toBe(false);
    expect(r.contents).toBe(hostile);
  });

  test('tolerant: atlasAssets already populated (e.g. world.mapImage SP1 wiring) is left untouched', () => {
    const alreadyWired = PLAIN_ATLAS.replace('atlasAssets: {},', "atlasAssets: { 'x': { worldBg, cityImages: {} } },");
    const r = patchBundleClientBoardBg(alreadyWired, { kind: 'world', targetId: 'x' });
    expect(r.changed).toBe(false);
    expect(r.contents).toBe(alreadyWired);
  });
});

describe('boardBgTarget resolution mirrored by the rewire pass', () => {
  test('atlas normalized shape -> world target; classic normalized shape -> map target', () => {
    expect(boardBgTarget({ world: { id: 'w' }, roster: [] })).toMatchObject({ kind: 'world', targetId: 'w' });
    expect(boardBgTarget({ map: { id: 'm' }, roster: [] })).toMatchObject({ kind: 'map', targetId: 'm' });
  });
});
