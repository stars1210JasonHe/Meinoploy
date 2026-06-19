// Atlas real-city background assets — one-time acquisition script (documents provenance).
//   node mods/dominion/atlas/assets/fetch-assets.mjs
// Downloads a license-clean lead photo per city (Wikipedia REST summary API → the
// page's Commons lead image, CC-BY-SA / PD) plus a public-domain equirectangular world
// map. Images are bundled into the repo so the build needs no network; re-run to refresh
// or swap. Attribution lives in CREDITS.md next to the images.
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CITY_DIR = join(HERE, 'cities');
mkdirSync(CITY_DIR, { recursive: true });

const UA = 'MeinopolyDev/1.0 (atlas city backgrounds; contact: dev)';
const WIDTH = 1024; // board-usable width via Special:FilePath (handles sizing reliably)

// placeId → prioritized Wikipedia article titles. The plain city article often has a
// FLAG or a fair-use lead image (Singapore→flag, Dubai→non-free), so we try skyline-
// specific titles first and reject unusable leads.
const CITIES = {
  tokyo: ['Tokyo'],
  shanghai: ['Shanghai'],
  singapore: ['Marina Bay', 'Downtown Core, Singapore', 'Singapore'],
  mumbai: ['Mumbai'],
  dubai: ['Downtown Dubai', 'Dubai Marina', 'Dubai'],
  newyork: ['New York City'],
  london: ['London'],
};

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}
async function download(url, dest) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(dest, buf);
  return buf.length;
}
// Extract the Commons filename from a thumbnail URL: .../commons/thumb/a/ab/<FILE>/<n>px-...
function commonsFile(thumbUrl) {
  const m = thumbUrl.match(/\/commons\/thumb\/[^/]+\/[^/]+\/([^/]+)\//);
  return m ? m[1] : null;
}
// A lead image is unusable as a cityscape if it's a flag/logo (svg) or a local
// fair-use file (/wikipedia/en/ rather than Commons).
function usable(thumbUrl) {
  if (!thumbUrl) return false;
  if (/\/wikipedia\/en\//.test(thumbUrl)) return false;      // non-free / local
  if (/\.svg/i.test(thumbUrl)) return false;                  // flag/logo
  return /\/commons\/thumb\//.test(thumbUrl);
}

const credits = ['# Atlas city background image credits', '',
  'Fetched by fetch-assets.mjs from Wikipedia/Wikimedia Commons (CC-BY-SA / public domain).', ''];

for (const [id, titles] of Object.entries(CITIES)) {
  let done = false;
  for (const title of titles) {
    try {
      const j = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
      const thumb = j.thumbnail && j.thumbnail.source;
      if (!usable(thumb)) continue;
      const file = commonsFile(thumb);
      if (!file) continue;
      const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${file}?width=${WIDTH}`;
      const bytes = await download(url, join(CITY_DIR, `${id}.jpg`));
      console.log(`✓ ${id}  ${(bytes / 1024).toFixed(0)}KB  [${title}] ${file}`);
      credits.push(`- **${id}** (${id}.jpg): "${decodeURIComponent(file)}" via ${title} (Wikimedia Commons)`);
      done = true;
      break;
    } catch (e) {
      console.log(`  …${id}/${title}: ${e.message}`);
    }
  }
  if (!done) console.log(`✗ ${id}: no usable image from ${titles.join(', ')}`);
}

// Public-domain equirectangular world map (Commons Special:FilePath → original file).
try {
  const mapUrl = 'https://commons.wikimedia.org/wiki/Special:FilePath/Equirectangular_projection_SW.jpg?width=2000';
  const bytes = await download(mapUrl, join(HERE, 'world.jpg'));
  console.log(`✓ world.jpg  ${(bytes / 1024).toFixed(0)}KB`);
  credits.push('', `- **World map** (world.jpg): Equirectangular_projection_SW.jpg (Commons, public domain)`);
} catch (e) {
  console.log(`✗ world map: ${e.message}`);
}

writeFileSync(join(HERE, 'CREDITS.md'), credits.join('\n') + '\n');
console.log('done.');
