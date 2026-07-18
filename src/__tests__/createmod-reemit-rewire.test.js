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
import { createMod, rewireBoardBg } from '../../scripts/create-mod';
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

// Ticket (open item from the reemit-rewire final review, tickets3-report.md): no test previously
// proved a PARTIALLY-portrait-wired generated mod is actually buildable — coverage above is
// string-level only (`.toContain(...)` on import lines). A real `npx parcel build` can't run
// against these tmp roots as-is: makeRoot() deliberately seeds only the two registry anchor files
// (see its own comment — "createMod only READS the two registry files + WRITES the mod tree; it
// never builds"), not a full repo checkout, and tmp roots live outside the project tree entirely
// (no reachable node_modules for Parcel to walk up to). Copying/symlinking node_modules and a full
// mods/dominion/ tree into every tmp root per test run would make this suite slow and fragile for
// what is fundamentally a "does every import specifier point at a real file" question. Chosen
// instead — the cheaper proof this ticket's own text names as acceptable: parse the generated
// files with @babel/core and resolve every relative import specifier against the filesystem,
// asserting each one exists. This catches exactly the failure class a Parcel build would report as
// "Cannot resolve dependency": a wired-but-missing portrait file, or (the original all-or-nothing
// bug) an import emitted for a character whose PNG was never generated.
function collectRelativeImportSpecifiers(source) {
  const ast = require('@babel/core').parseSync(source, { sourceType: 'module' });
  return ast.program.body
    .filter(n => (n.type === 'ImportDeclaration' || n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration') && n.source)
    .map(n => n.source.value)
    .filter(spec => spec.startsWith('.')); // bare/package specifiers resolve via node_modules — out of scope here
}
// Resolves one relative specifier from `fromFile` the way Node/Parcel's CJS-style resolver would:
// exact path, then + '.js'. Generated-mod imports are always either an explicit-extension asset
// (portraits/*.png, *.data.json) or an extensionless local module (./characters-data).
function resolveRelativeSpecifier(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  if (fs.existsSync(base + '.js')) return base + '.js';
  return null;
}
// Parses `filePath` and asserts every relative import specifier it emits resolves to a real file
// on disk. Returns { specifiers, resolved } for the caller's own content assertions (e.g. proving
// a specific missing roster member produced NO import at all, not a dangling one).
function assertImportsResolve(filePath) {
  const specifiers = collectRelativeImportSpecifiers(fs.readFileSync(filePath, 'utf8'));
  const resolved = specifiers.map(spec => {
    const target = resolveRelativeSpecifier(filePath, spec);
    if (!target) throw new Error(`import "${spec}" in ${filePath} does not resolve to a real file (parcel would fail to build this)`);
    return target;
  });
  return { specifiers, resolved };
}

describe('partial-portrait mod is buildable (parcel-build-equivalent proof, not just string-shaped)', () => {
  test('minimal entry -> characters.js: every emitted import specifier resolves to a real file; the un-wired character has NO import at all', () => {
    const root = makeRoot();
    expect(createMod({ inputPath: ATLAS, rootDir: root }).ok).toBe(true);

    // PARTIAL: only 2 of the 3 roster ids get a portrait — same scenario as the string-level test
    // above, but this time we prove the output is actually buildable.
    plantPortraits(root, 'ancient-empires', ['hammurabi', 'cyrus-the-great']);
    const r = createMod({ inputPath: ATLAS, rootDir: root, force: true });
    expect(r.ok).toBe(true);
    expect(r.rewire.portraits).toBe(2);

    // A minimal entry file, exactly as the ticket describes: something that imports the mod's
    // characters.js (the way bundle.client.js — and ultimately App.js — really does).
    const entryPath = path.join(root, 'entry.js');
    fs.writeFileSync(entryPath, `import { CHARACTERS } from './mods/ancient-empires/characters.js';\nexport { CHARACTERS };\n`);

    const charsPath = path.join(root, 'mods', 'ancient-empires', 'characters.js');
    const { resolved: entryResolved } = assertImportsResolve(entryPath);
    expect(entryResolved).toEqual([charsPath]); // the entry itself resolves to the real generated file

    const { specifiers, resolved } = assertImportsResolve(charsPath);
    expect(resolved).toEqual(expect.arrayContaining([
      path.join(root, 'mods', 'ancient-empires', 'characters-data.js'),
      path.join(root, 'mods', 'ancient-empires', 'portraits', 'hammurabi.png'),
      path.join(root, 'mods', 'ancient-empires', 'portraits', 'cyrus-the-great.png'),
    ]));
    // the un-wired roster member (no portrait planted) must produce NO import at all — a
    // dangling import pointing at a missing file is exactly the regression this test guards.
    expect(specifiers.some(s => s.includes('alexander-the-great'))).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

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

  // Review follow-up ticket (b): roster ADDITION without a new portrait used to un-wire the
  // WHOLE roster (all-or-nothing gate) — softened to wire whichever roster members have a
  // portrait.png present and warn about the rest.
  test('partial portraits (roster addition without a new portrait) -> present ones wired, missing one warned, not all-or-nothing', () => {
    const root = makeRoot();
    expect(createMod({ inputPath: ATLAS, rootDir: root }).ok).toBe(true);

    // Only 2 of the 3 roster ids have a portrait on disk — simulates a roster addition
    // (alexander-the-great) that hasn't had gen-portraits run for it yet.
    plantPortraits(root, 'ancient-empires', ['hammurabi', 'cyrus-the-great']);

    const r = createMod({ inputPath: ATLAS, rootDir: root, force: true });
    expect(r.ok).toBe(true);
    expect(r.rewire.portraits).toBe(2); // present ones wired, not 0
    expect(r.warnings.some(w => w.includes('2/3') && w.includes('alexander-the-great'))).toBe(true);

    const chars = fs.readFileSync(path.join(root, 'mods/ancient-empires/characters.js'), 'utf8');
    expect(chars).toContain("from './portraits/hammurabi.png'");
    expect(chars).toContain("from './portraits/cyrus-the-great.png'");
    expect(chars).not.toContain('alexander-the-great'); // no import/map entry for the missing one
    fs.rmSync(root, { recursive: true, force: true });
  });

  // Review follow-up ticket (a): dominion is hand-authored (never created via createMod()) and
  // its bundle.client.js already hand-wires backgrounds/classic.png into a bespoke shape — a
  // hypothetical rewire targeting it must not silently no-op; it should explicitly skip with a
  // logged warning naming dominion, distinct from the generic "unrecognized shape" tolerance.
  test('rewireBoardBg explicitly (and loudly) skips dominion instead of silently no-opping', () => {
    const root = makeRoot();
    const dominionDir = path.join(root, 'mods', 'dominion');
    fs.mkdirSync(path.join(dominionDir, 'backgrounds'), { recursive: true });
    fs.writeFileSync(path.join(dominionDir, 'backgrounds', 'classic.png'), FAKE_PNG);
    fs.writeFileSync(path.join(dominionDir, 'bundle.client.js'), 'export default {};\n');

    const r = rewireBoardBg({ map: { id: 'classic' }, name: 'Dominion' }, dominionDir);
    expect(r.wired).toBeNull();
    expect(r.warning).toMatch(/dominion/i);
    expect(r.warning).toMatch(/hand-wired/i);
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

  // Review follow-up ticket (c): this precedence used to be silent — surface it via a `warning`
  // string on the (pure) result, distinct from the other no-op cases (already-wired,
  // unrecognized shape) which stay silent because they are not surprising.
  test('atlasAssets-already-populated no-op now carries a warning (world.mapImage-vs-boardBg precedence)', () => {
    const alreadyWired = PLAIN_ATLAS.replace('atlasAssets: {},', "atlasAssets: { 'x': { worldBg, cityImages: {} } },");
    const r = patchBundleClientBoardBg(alreadyWired, { kind: 'world', targetId: 'x' });
    expect(r.changed).toBe(false);
    expect(r.warning).toMatch(/atlasAssets/i);
    expect(r.warning).toMatch(/not wired/i);
  });

  test('already-wired and unrecognized-shape no-ops stay warning-free (not surprising)', () => {
    const target = { kind: 'world', targetId: 'my-world' };
    const first = patchBundleClientBoardBg(PLAIN_ATLAS, target);
    const second = patchBundleClientBoardBg(first.contents, target); // already wired
    expect(second.warning).toBeNull();

    const hostile = 'export default {};\n';
    const r = patchBundleClientBoardBg(hostile, { kind: 'world', targetId: 'x' });
    expect(r.warning).toBeNull();
  });
});

describe('boardBgTarget resolution mirrored by the rewire pass', () => {
  test('atlas normalized shape -> world target; classic normalized shape -> map target', () => {
    expect(boardBgTarget({ world: { id: 'w' }, roster: [] })).toMatchObject({ kind: 'world', targetId: 'w' });
    expect(boardBgTarget({ map: { id: 'm' }, roster: [] })).toMatchObject({ kind: 'map', targetId: 'm' });
  });
});
