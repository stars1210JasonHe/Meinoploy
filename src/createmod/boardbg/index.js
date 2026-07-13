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
