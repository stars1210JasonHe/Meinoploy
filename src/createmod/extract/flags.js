// SP2 shared flag spec — consumed by BOTH scripts/extract-facts.js and scripts/create-mod.js
// (--from-book). Validation REJECTS with clear errors, never silently coerces (spec rule).
import { DEFAULT_PALETTE } from '../smart/roster';

export const EXTRACT_VALUE_FLAGS = [
  '--out', '--id', '--chars', '--places', '--lang', '--map-type', '--map-image',
  '--chunk-size', '--overlap', '--max-chunks', '--extract-model', '--synth-model',
];
export const EXTRACT_BOOL_FLAGS = ['--recache'];

export function resolveMapType(opts) {
  // --map-image implies atlas; explicit classic + image is a conflict (checked in parse).
  return opts.mapImage ? 'atlas' : (opts.mapType || 'atlas');
}

function intFlag(errors, name, raw, { min, max }) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || (max !== undefined && n > max)) {
    errors.push(`${name} must be an integer in [${min}, ${max !== undefined ? max : '∞'}] (got "${raw}")`);
    return null;
  }
  return n;
}

// A value flag is only "usable" when it was actually passed AND carried a
// non-empty value. Missing (argv ran out) or empty-string values REJECT with
// a clear error instead of silently falling back to the default (spec rule).
function valuePresent(errors, flag, raw) {
  if (!(flag in raw)) return false;
  if (raw[flag] === undefined || raw[flag] === '') {
    errors.push(`${flag} requires a value`);
    return false;
  }
  return true;
}

export function parseExtractArgs(argv) {
  const out = {
    book: null, out: null, id: null, chars: 10, places: 12, lang: 'auto',
    mapType: 'atlas', mapImage: null, chunkSize: 12000, overlap: 400, maxChunks: 200,
    extractModel: null, synthModel: null, recache: false, errors: [],
  };
  const errors = out.errors;
  const raw = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (EXTRACT_BOOL_FLAGS.includes(a)) out.recache = true;
    else if (EXTRACT_VALUE_FLAGS.includes(a)) raw[a] = argv[++i];
    else if (a.startsWith('--')) errors.push(`unrecognized flag: ${a}`);
    else out.book = a;
  }
  if (valuePresent(errors, '--out', raw)) out.out = raw['--out'];
  if (valuePresent(errors, '--extract-model', raw)) out.extractModel = raw['--extract-model'];
  if (valuePresent(errors, '--synth-model', raw)) out.synthModel = raw['--synth-model'];
  if (valuePresent(errors, '--map-image', raw)) out.mapImage = raw['--map-image'];
  if (valuePresent(errors, '--map-type', raw)) {
    if (raw['--map-type'] !== 'atlas' && raw['--map-type'] !== 'classic') {
      errors.push(`--map-type must be atlas|classic (got "${raw['--map-type']}")`);
    } else out.mapType = raw['--map-type'];
  }
  if (out.mapImage && raw['--map-type'] === 'classic') {
    errors.push('--map-image conflicts with --map-type classic (the image chain is flat-atlas only)');
  }
  if (valuePresent(errors, '--lang', raw)) {
    if (!['auto', 'en', 'zh'].includes(raw['--lang'])) errors.push(`--lang must be auto|en|zh (got "${raw['--lang']}")`);
    else out.lang = raw['--lang'];
  }
  if (valuePresent(errors, '--id', raw)) {
    if (!/^[a-z0-9-]+$/.test(raw['--id'])) errors.push(`--id must be kebab-ASCII [a-z0-9-]+ (got "${raw['--id']}")`);
    else out.id = raw['--id'];
  }
  if (valuePresent(errors, '--chunk-size', raw)) {
    const v = intFlag(errors, '--chunk-size', raw['--chunk-size'], { min: 1000 });
    if (v !== null) out.chunkSize = v;
  }
  if (valuePresent(errors, '--overlap', raw)) {
    const v = intFlag(errors, '--overlap', raw['--overlap'], { min: 0 });
    if (v !== null) out.overlap = v;
  }
  if (out.overlap > out.chunkSize / 2) {
    errors.push(`--overlap must be <= chunkSize/2 (${out.chunkSize / 2}), got ${out.overlap}`);
  }
  if (valuePresent(errors, '--max-chunks', raw)) {
    const v = intFlag(errors, '--max-chunks', raw['--max-chunks'], { min: 1 });
    if (v !== null) out.maxChunks = v;
  }
  if (valuePresent(errors, '--chars', raw)) {
    const v = intFlag(errors, '--chars', raw['--chars'], { min: 2, max: DEFAULT_PALETTE.length });
    if (v !== null) out.chars = v;
  }
  const resolved = resolveMapType(out);
  const placesMin = resolved === 'classic' ? 4 : 3;
  if (valuePresent(errors, '--places', raw)) {
    const v = intFlag(errors, '--places', raw['--places'], { min: placesMin });
    if (v !== null) out.places = v;
  }
  return out;
}
