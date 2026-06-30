// Create-Mod — idempotent registry patcher (pure, string-in/out). Bindings use camelId;
// kebab id only for paths + the quoted MODS object key. The CLI does the file read/write.
import { toCamelId } from './templates';

function hasIndexEntry(indexSrc, id, camel) {
  return indexSrc.includes(`{ ${camel}Data }`) || indexSrc.includes(`'${id}':`) || indexSrc.includes(`"${id}":`);
}

export function patchRegistries(id, src) {
  const camel = toCamelId(id);
  let indexSrc = src.indexSrc;
  let appSrc = src.appSrc;
  let changed = false;

  // --- mods/index.js ---
  if (!hasIndexEntry(indexSrc, id, camel)) {
    const anchor = 'export const MODS = {';
    if (!indexSrc.includes(anchor)) throw new Error('mods/index.js: MODS object anchor not found');
    const importLine = `import { ${camel}Data } from './${id}/bundle.data';\n`;
    indexSrc = indexSrc.replace(anchor, importLine + anchor);
    indexSrc = indexSrc.replace(anchor, `${anchor}\n  '${id}': ${camel}Data,`);
    changed = true;
  }

  // --- src/App.js (single-line MODS array) ---
  if (!appSrc.includes(`${camel}Mod`)) {
    const arrMatch = appSrc.match(/const MODS = \[([^\]]*)\];/);
    if (!arrMatch) throw new Error('src/App.js: MODS array anchor not found');
    const importLine = `import ${camel}Mod from '../mods/${id}/bundle.client';\n`;
    appSrc = appSrc.replace('const MODS = [', importLine + 'const MODS = [');
    const inner = arrMatch[1].trim();
    appSrc = appSrc.replace(arrMatch[0], `const MODS = [${inner}, ${camel}Mod];`);
    changed = true;
  }

  return { indexSrc, appSrc, changed };
}

export function unpatchRegistries(id, src) {
  const camel = toCamelId(id);
  let indexSrc = src.indexSrc;
  let appSrc = src.appSrc;
  let changed = false;

  const before1 = indexSrc;
  indexSrc = indexSrc
    .replace(new RegExp(`import \\{ ${camel}Data \\} from '\\./${id}/bundle\\.data';\\n`), '')
    .replace(new RegExp(`\\n  ['"]${id}['"]: ${camel}Data,`), '');
  if (indexSrc !== before1) changed = true;

  const before2 = appSrc;
  appSrc = appSrc
    .replace(new RegExp(`import ${camel}Mod from '\\.\\./mods/${id}/bundle\\.client';\\n`), '')
    .replace(new RegExp(`, ${camel}Mod`), '')
    .replace(new RegExp(`${camel}Mod, `), '');
  if (appSrc !== before2) changed = true;

  return { indexSrc, appSrc, changed };
}
