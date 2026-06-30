// Create-Mod — pure mod emitter. Returns a file list + a portrait copy list; the CLI does fs.
import { dataJson, charactersDataJs, loreJs, bundleDataJs, charactersJs, bundleClientJs } from './templates';

export function emitMod(normalized) {
  const id = normalized.id;
  const base = `mods/${id}`;
  const files = [
    { path: `${base}/${id}.data.json`, contents: dataJson(normalized) },
    { path: `${base}/characters-data.js`, contents: charactersDataJs(normalized) },
    { path: `${base}/lore.js`, contents: loreJs(normalized) },
    { path: `${base}/bundle.data.js`, contents: bundleDataJs(normalized) },
    { path: `${base}/characters.js`, contents: charactersJs(normalized) },
    { path: `${base}/bundle.client.js`, contents: bundleClientJs(normalized) },
  ];
  const copies = (normalized.portraits || []).map(p => {
    const ext = p.path.slice(p.path.lastIndexOf('.'));
    return { from: p.path, to: `${base}/portraits/${p.id}${ext}` };
  });
  return { files, copies };
}
