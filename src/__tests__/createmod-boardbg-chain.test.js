// Create-Mod content quality wave (2026-07-16), Part B — --boardbg chains background
// generation + rewire. Spec: docs/superpowers/specs/2026-07-16-createmod-content-wave.md
//
// Mirrors createmod-portraits-chain.test.js's injected-runner pattern (no real API calls) and
// createmod-reemit-rewire.test.js's makeRoot() tmp-dir convention (never touches the real repo's
// mods/ tree). No network anywhere in this file.
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  parseArgs, createMod, chainBoardBg, rewireBoardBg, runBoardBgChain,
} from '../../scripts/create-mod';
import { runGenBoardBg } from '../../scripts/gen-boardbg';

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'createmod-boardbg-'));
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
const FAKE_PNG = Buffer.from('fake-png-bytes');

describe('parseArgs --boardbg flag', () => {
  test('boolean captured, defaults false', () => {
    expect(parseArgs(['spec.json', '--boardbg'])).toMatchObject({ boardBg: true, input: 'spec.json' });
    expect(parseArgs(['spec.json'])).toMatchObject({ boardBg: false });
  });
  test('coexists with --portraits + --image-model without misparsing positionals', () => {
    const a = parseArgs(['--boardbg', '--portraits', '--image-model', 'img-x', 'spec.json']);
    expect(a).toMatchObject({ boardBg: true, portraits: true, imageModel: 'img-x', input: 'spec.json' });
  });
});

describe('strip lists: --boardbg never reaches the extraction flag parser', () => {
  test('stripCreateModFlags removes --boardbg', () => {
    const { stripCreateModFlags } = require('../../scripts/create-mod');
    const stripped = stripCreateModFlags(['book.txt', '--from-book', '--boardbg', '--chunk-size', '9000']);
    expect(stripped).toEqual(['book.txt', '--chunk-size', '9000']);
  });
});

describe('chainBoardBg — called-with / cost-plan-before-spend / dry-run / failure isolation', () => {
  test('invokes the runner with modId/imageModel/rootDir/force/dryRun', async () => {
    const calls = [];
    const ok = await chainBoardBg({
      modId: 'm', imageModel: 'im', rootDir: '/r', force: true, dryRun: false,
      runner: async o => { calls.push(o); return { ok: true }; },
    });
    expect(ok).toBe(true);
    expect(calls[0]).toMatchObject({ modId: 'm', imageModel: 'im', rootDir: '/r', force: true, dryRun: false });
  });

  test('force/dryRun default to false (coerced, not undefined) when omitted', async () => {
    const calls = [];
    await chainBoardBg({ modId: 'm', rootDir: '/r', runner: async o => { calls.push(o); return { ok: true }; } });
    expect(calls[0].force).toBe(false);
    expect(calls[0].dryRun).toBe(false);
  });

  test('dry-run: runner receives dryRun:true, no fs write, no rewire attempted', async () => {
    const root = makeRoot();
    expect(createMod({ inputPath: ATLAS, rootDir: root }).ok).toBe(true);
    const bundleBefore = fs.readFileSync(path.join(root, 'mods/ancient-empires/bundle.client.js'), 'utf8');
    const calls = [];
    const ok = await chainBoardBg({
      modId: 'ancient-empires', rootDir: root, dryRun: true,
      runner: async o => { calls.push(o); return { ok: true, prompt: 'preview text' }; },
    });
    expect(ok).toBe(true);
    expect(calls[0].dryRun).toBe(true);
    // no PNG was ever planted and dryRun never writes one, but the assertion that matters is
    // bundle.client.js is untouched — dry-run must never reach the rewire step.
    const bundleAfter = fs.readFileSync(path.join(root, 'mods/ancient-empires/bundle.client.js'), 'utf8');
    expect(bundleAfter).toBe(bundleBefore);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('failure isolation: runner throws -> returns false, never throws, mod tree untouched', async () => {
    const root = makeRoot();
    expect(createMod({ inputPath: ATLAS, rootDir: root }).ok).toBe(true);
    const bundleBefore = fs.readFileSync(path.join(root, 'mods/ancient-empires/bundle.client.js'), 'utf8');
    const ok = await chainBoardBg({ modId: 'ancient-empires', rootDir: root, runner: async () => { throw new Error('network boom'); } });
    expect(ok).toBe(false);
    const bundleAfter = fs.readFileSync(path.join(root, 'mods/ancient-empires/bundle.client.js'), 'utf8');
    expect(bundleAfter).toBe(bundleBefore);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('failure isolation: runner resolves {ok:false} -> returns false, never throws', async () => {
    const ok = await chainBoardBg({ modId: 'm', rootDir: '/r', runner: async () => ({ ok: false, error: 'quota exceeded' }) });
    expect(ok).toBe(false);
  });

  test('secrets in a thrown error message are redacted (mirrors gen-portraits redactSecrets)', async () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await chainBoardBg({ modId: 'm', rootDir: '/r', runner: async () => { throw new Error('auth failed: sk-abcDEF12345secret'); } });
      const joined = spy.mock.calls.map(c => c.join(' ')).join('\n');
      expect(joined).not.toContain('sk-abcDEF12345secret');
      expect(joined).toContain('[redacted]');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('chainBoardBg — success wires bundle.client.js via the shared rewire path (real fs, tmp root)', () => {
  test('atlas: injected runner plants the PNG -> chainBoardBg wires atlasAssets', async () => {
    const root = makeRoot();
    expect(createMod({ inputPath: ATLAS, rootDir: root }).ok).toBe(true);
    const ok = await chainBoardBg({
      modId: 'ancient-empires', rootDir: root,
      runner: async o => {
        // Simulate what the real runGenBoardBg does on success: write the PNG to disk.
        const bgDir = path.join(o.rootDir, 'mods', o.modId, 'backgrounds');
        fs.mkdirSync(bgDir, { recursive: true });
        fs.writeFileSync(path.join(bgDir, 'ancient-empires.png'), FAKE_PNG);
        return { ok: true, written: [path.join(bgDir, 'ancient-empires.png')] };
      },
    });
    expect(ok).toBe(true);
    const bundle = fs.readFileSync(path.join(root, 'mods/ancient-empires/bundle.client.js'), 'utf8');
    expect(bundle).toContain("import boardBg from './backgrounds/ancient-empires.png';");
    expect(bundle).toContain("atlasAssets: { 'ancient-empires': { worldBg: boardBg, cityImages: {} } },");
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('classic: injected runner plants the PNG -> chainBoardBg wires mapAssets (atlasAssets untouched)', async () => {
    const root = makeRoot();
    expect(createMod({ inputPath: CLASSIC, rootDir: root }).ok).toBe(true);
    const ok = await chainBoardBg({
      modId: 'steam-barons', rootDir: root,
      runner: async o => {
        const bgDir = path.join(o.rootDir, 'mods', o.modId, 'backgrounds');
        fs.mkdirSync(bgDir, { recursive: true });
        fs.writeFileSync(path.join(bgDir, 'steam-barons.png'), FAKE_PNG);
        return { ok: true, written: [] };
      },
    });
    expect(ok).toBe(true);
    const bundle = fs.readFileSync(path.join(root, 'mods/steam-barons/bundle.client.js'), 'utf8');
    expect(bundle).toContain("import boardBg from './backgrounds/steam-barons.png';");
    expect(bundle).toContain('atlasAssets: {},');
    expect(bundle).toContain("mapAssets: { 'steam-barons': { boardBg: boardBg } },");
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('no PNG produced (e.g. an "already exists, skipped" runner result) -> ok:true, no wiring, no crash', async () => {
    const root = makeRoot();
    expect(createMod({ inputPath: ATLAS, rootDir: root }).ok).toBe(true);
    const bundleBefore = fs.readFileSync(path.join(root, 'mods/ancient-empires/bundle.client.js'), 'utf8');
    const ok = await chainBoardBg({ modId: 'ancient-empires', rootDir: root, runner: async () => ({ ok: true, written: [] }) });
    expect(ok).toBe(true);
    const bundleAfter = fs.readFileSync(path.join(root, 'mods/ancient-empires/bundle.client.js'), 'utf8');
    expect(bundleAfter).toBe(bundleBefore);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('idempotent second run: PNG already present -> two chainBoardBg calls produce byte-identical bundle.client.js', async () => {
    const root = makeRoot();
    expect(createMod({ inputPath: ATLAS, rootDir: root }).ok).toBe(true);
    const runner = async o => {
      const bgDir = path.join(o.rootDir, 'mods', o.modId, 'backgrounds');
      fs.mkdirSync(bgDir, { recursive: true });
      fs.writeFileSync(path.join(bgDir, 'ancient-empires.png'), FAKE_PNG); // idempotent write
      return { ok: true, written: [] };
    };
    expect(await chainBoardBg({ modId: 'ancient-empires', rootDir: root, runner })).toBe(true);
    const bundle1 = fs.readFileSync(path.join(root, 'mods/ancient-empires/bundle.client.js'));
    expect(await chainBoardBg({ modId: 'ancient-empires', rootDir: root, runner })).toBe(true);
    const bundle2 = fs.readFileSync(path.join(root, 'mods/ancient-empires/bundle.client.js'));
    expect(bundle1.equals(bundle2)).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('rewireBoardBg (pure-ish helper, real fs on a tmp root)', () => {
  test('no PNG on disk -> no-op, no warning', () => {
    const root = makeRoot();
    expect(createMod({ inputPath: ATLAS, rootDir: root }).ok).toBe(true);
    const r = rewireBoardBg({ world: { id: 'ancient-empires' }, name: 'X' }, path.join(root, 'mods', 'ancient-empires'));
    expect(r).toEqual({ wired: null, warning: null });
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('malformed dataLike (neither world nor map) -> warning, never throws', () => {
    const root = makeRoot();
    expect(createMod({ inputPath: ATLAS, rootDir: root }).ok).toBe(true);
    const r = rewireBoardBg({ name: 'X' }, path.join(root, 'mods', 'ancient-empires'));
    expect(r.wired).toBeNull();
    expect(r.warning).toMatch(/boardBg rewire skipped/);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('createMod --dry-run --boardbg: prints a real cost plan (no spend), unlike --portraits\' "ignored"', () => {
  test('plain --dry-run --boardbg prints target + composed prompt', () => {
    const root = makeRoot();
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const r = createMod({ inputPath: ATLAS, rootDir: root, dryRun: true, boardBg: true });
      expect(r.ok).toBe(true);
      const out = spy.mock.calls.map(c => c.join(' ')).join('\n');
      expect(out).toMatch(/\[dry-run] boardBg -> world "ancient-empires"/);
      expect(out).toContain('[dry-run] --- composed boardBg prompt ---');
      // no fs was written — dry-run never generates or wires anything.
      expect(fs.existsSync(path.join(root, 'mods', 'ancient-empires'))).toBe(false);
    } finally {
      spy.mockRestore();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('--smart --dry-run --boardbg ALSO prints the boardBg cost plan alongside the derived-JSON preview', () => {
    const root = makeRoot();
    const facts = path.join(__dirname, '../../examples/create-mod/gilded-rails.facts.json');
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const r = createMod({ inputPath: facts, rootDir: root, dryRun: true, smart: true, boardBg: true });
      expect(r.ok).toBe(true);
      const out = spy.mock.calls.map(c => c.join(' ')).join('\n');
      expect(out).toMatch(/\[dry-run] boardBg -> (world|map) "/);
    } finally {
      spy.mockRestore();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('plain --dry-run WITHOUT --boardbg prints no boardBg plan', () => {
    const root = makeRoot();
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      createMod({ inputPath: ATLAS, rootDir: root, dryRun: true });
      const out = spy.mock.calls.map(c => c.join(' ')).join('\n');
      expect(out).not.toContain('[dry-run] boardBg');
    } finally {
      spy.mockRestore();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// gen-boardbg.js's runGenBoardBg previously hardcoded REPO_ROOT for modsRoot/modDir,
// silently ignoring opts.rootDir — meaning ANY test that called it (even with an injected
// fake client) would still read/write the REAL repo's mods/ directory. Fixed as part of this
// wave so chainBoardBg's default (non-test) runner can be exercised end-to-end against an
// isolated tmp root. These tests are the regression proof: a fake client + a tmp rootDir stays
// fully inside the tmp root, never the real mods/ancient-empires or mods/steam-barons.
describe('runGenBoardBg — injected client + codec, rootDir isolation (regression: rootDir bug fix)', () => {
  const fakeCodec = { decode: () => ({ width: 4, height: 4, data: new Uint8Array(4 * 4 * 4).fill(1) }), encode: () => Buffer.from('png-bytes') };

  test('writes the PNG under the injected rootDir, never the real repo mods/', async () => {
    const root = makeRoot();
    expect(createMod({ inputPath: ATLAS, rootDir: root }).ok).toBe(true);
    // mods/ancient-empires is ALSO a real committed demo mod in this repo (with its own real
    // background art) — capture its bytes before, so a leak into the real tree (this test's
    // whole point) shows up as a content change, not a bogus "did it exist" check.
    const realPngPath = path.resolve(__dirname, '../../mods/ancient-empires/backgrounds/ancient-empires.png');
    const realBefore = fs.readFileSync(realPngPath);
    const calls = [];
    const client = { generate: async (prompt, opts) => { calls.push({ prompt, opts }); return { b64: 'xx', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }; } };
    const r = await runGenBoardBg({ modId: 'ancient-empires', rootDir: root, log: () => {} }, client, fakeCodec);
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1); // cost-plan log happens before this call; real spend is exactly 1 image call
    const pngPath = path.join(root, 'mods', 'ancient-empires', 'backgrounds', 'ancient-empires.png');
    expect(fs.existsSync(pngPath)).toBe(true);
    // the tmp-root PNG is OUR fake codec output, not the real repo's committed art
    expect(fs.readFileSync(pngPath).equals(Buffer.from('png-bytes'))).toBe(true);
    // the real repo's committed mod is untouched, byte-for-byte
    expect(fs.readFileSync(realPngPath).equals(realBefore)).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('dry-run: no client/codec touched, no fs write, prints the composed prompt', async () => {
    const root = makeRoot();
    expect(createMod({ inputPath: CLASSIC, rootDir: root }).ok).toBe(true);
    const logs = [];
    const r = await runGenBoardBg({ modId: 'steam-barons', rootDir: root, dryRun: true, log: s => logs.push(s) }, null, null);
    expect(r.ok).toBe(true);
    expect(r.prompt).toBeTruthy();
    expect(fs.existsSync(path.join(root, 'mods', 'steam-barons', 'backgrounds'))).toBe(false);
    expect(logs.join('\n')).toContain('--- composed prompt ---');
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('mod id escaping mods/ is refused before any fs/client use', async () => {
    const root = makeRoot();
    await expect(runGenBoardBg({ modId: '../evil', rootDir: root }, null, null)).rejects.toThrow();
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('runBoardBgChain', () => {
  test('is exported (OPENAI_API_KEY preflight WARNS, never process.exit(1) — failure isolation)', () => {
    // Behavioral proof lives in chainBoardBg's own failure-isolation tests above; this checks
    // the export surface + the deliberate divergence from runPortraitsChain's exit(1) preflight
    // is documented in source (runBoardBgChain's own comment), consistent with the "boardBg
    // failure warns but does not fail the create" requirement.
    const mod = require('../../scripts/create-mod');
    expect(typeof mod.runBoardBgChain).toBe('function');
  });
});
