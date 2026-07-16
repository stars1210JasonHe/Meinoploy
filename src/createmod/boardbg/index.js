// Create-Mod board backgrounds — pure orchestrator (reskin R2). No fs/network:
// the images client and PNG codec are injected, mirroring portraits/index.js.
import { composeBoardBgPrompt } from './prompt';
import { downscaleNearest, quantizeMedianCut } from '../portraits/pixel';

export const BG_SOURCE_SIZE = '1536x1024';
// Stored small (hi-bit chunky) — the .board__bg layer upscales with
// image-rendering:pixelated, so 512-wide reads as deliberate fat pixels.
export const BG_OUT_W = 512;
export const BG_OUT_H = 341;
export const BG_COLORS = 32;

// dataJson is a create-mod <id>.data.json: atlas mods carry `world`,
// classic mods carry `map`. Returns the generation target + prompt input.
export function boardBgTarget(dataJson, opts) {
  const modName = opts && opts.modName;
  if (dataJson.world) {
    const w = dataJson.world;
    if (!w.id) throw new Error('world has no id');
    return {
      kind: 'world', targetId: w.id,
      promptInput: {
        kind: 'world', name: w.name || modName, story: w.story, tagline: w.tagline,
        places: w.places || [], roster: dataJson.roster || [], lore: dataJson.lore || {},
      },
    };
  }
  if (dataJson.map) {
    const m = dataJson.map;
    if (!m.id) throw new Error('map has no id');
    return {
      kind: 'map', targetId: m.id,
      promptInput: {
        kind: 'map', mapName: m.name || modName, story: m.description,
        places: [], roster: dataJson.roster || [], lore: dataJson.lore || {},
      },
    };
  }
  throw new Error('mod data has neither world nor map');
}

export async function generateBoardBg(promptInput, opts, imagesClient, codec) {
  const { prompt, warnings } = composeBoardBgPrompt(promptInput);
  if (opts && opts.dryRun) return { prompt, warnings, png: null, usage: null };
  const { b64, usage } = await imagesClient.generate(prompt, { size: BG_SOURCE_SIZE });
  const img = codec.decode(b64);
  const small = downscaleNearest(img, BG_OUT_W, BG_OUT_H);
  const quant = quantizeMedianCut(small, BG_COLORS);
  return { prompt, warnings, png: codec.encode(quant), usage };
}

// Idempotent string-patch of a freshly emitted bundle.client.js (see templates.js's
// bundleClientJs — the plain template always emits `atlasAssets: {},` with no `mapAssets`
// line unless `world.mapImage` was supplied at creation time). Wires a generated board
// background (mods/<id>/backgrounds/<targetId>.png, from gen-boardbg) into atlasAssets
// (world/atlas mods) or a new mapAssets entry (classic mods) — the exact shapes hand-wired
// into mods/silk-road/bundle.client.js and mods/gilded-rails/bundle.client.js respectively.
// Pure (string-in/out); the CLI does the fs existence check + read/write. Mirrors
// registry-patch.js's check-then-patch idiom: safe to call on an already-wired file (no-op)
// or on a hand-edited file that doesn't match the known template shape (no-op, never guesses).
const GLOBE_IMPORT_LINE = "import { getGlobe } from '../dominion/atlas/globe-lib';\n";
const ATLAS_EMPTY_LINE = '  atlasAssets: {},\n';

export function patchBundleClientBoardBg(contents, target) {
  // targetId comes from world.id/map.id, which world-loader/map-loader only check for
  // non-empty string — unlike the kebab-case-validated top-level input.id. Guard before
  // interpolating into generated source (same threat model as templates.js headerSafe).
  if (!/^[a-z0-9-]+$/.test(target.targetId)) return { contents, changed: false };
  const importLine = `import boardBg from './backgrounds/${target.targetId}.png';\n`;
  if (contents.includes(importLine)) return { contents, changed: false }; // already wired

  if (!contents.includes(GLOBE_IMPORT_LINE)) return { contents, changed: false }; // unrecognized shape
  if (!contents.includes(ATLAS_EMPTY_LINE)) return { contents, changed: false }; // atlasAssets already non-empty (e.g. world.mapImage) or edited

  const withImport = contents.replace(GLOBE_IMPORT_LINE, GLOBE_IMPORT_LINE + importLine);

  if (target.kind === 'world') {
    const wired = withImport.replace(ATLAS_EMPTY_LINE,
      `  atlasAssets: { '${target.targetId}': { worldBg: boardBg, cityImages: {} } },\n`);
    return { contents: wired, changed: true };
  }
  // classic (kind === 'map'): atlasAssets stays `{}`; add a sibling mapAssets entry.
  if (withImport.includes('  mapAssets:')) return { contents, changed: false }; // already has one
  const wired = withImport.replace(ATLAS_EMPTY_LINE,
    ATLAS_EMPTY_LINE + `  mapAssets: { '${target.targetId}': { boardBg: boardBg } },\n`);
  return { contents: wired, changed: true };
}
