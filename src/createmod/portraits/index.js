// Create-Mod portraits — pure orchestrator. No fs/network: the images client
// and PNG codec are injected. Spec §2/§7: id validation + style cap live HERE
// (shared by the standalone CLI and the create-mod --portraits chain).
import { planBatches, gridGeometry, buildGridPrompt, STYLE_MAX } from './prompt';
import { sliceCell, pixelizeCell } from './pixel';
// toCamelId is the SAME transform templates.js's charactersJs() uses to derive the JS import
// binding for each portrait (`import <camelId> from './portraits/<id>.png'`). Reusing it here
// (rather than replicating the regex) guarantees this validation catches exactly the cases that
// would otherwise produce a broken/duplicate import binding in the generated characters.js.
import { toCamelId } from '../templates';

export const KEBAB_ID = /^[a-z0-9-]+$/;

// Any camelId that isn't a legal JS identifier (e.g. a digit-leading id like "2pac") would be
// emitted as `import 2pac from ...` — a SyntaxError that breaks the whole app build.
const VALID_JS_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function validateRosterIds(roster) {
  const errors = [];
  const idsByCamel = new Map(); // camelId -> [raw ids that collide on it]
  for (const c of roster || []) {
    if (!c || typeof c.id !== 'string' || !KEBAB_ID.test(c.id)) {
      errors.push(`roster id must match ${KEBAB_ID}: ${c && c.id}`);
      continue;
    }
    const camel = toCamelId(c.id);
    if (!VALID_JS_IDENTIFIER.test(camel)) {
      errors.push(`roster id "${c.id}" produces an invalid JS import identifier "${camel}" (must start with a letter, "_" or "$")`);
      continue;
    }
    if (!idsByCamel.has(camel)) idsByCamel.set(camel, []);
    idsByCamel.get(camel).push(c.id);
  }
  // Two DIFFERENT kebab ids (e.g. "hero-1" and "hero1") can still collide once camelCased —
  // both would emit `import hero1 from ...` twice, a duplicate-binding SyntaxError.
  for (const [camel, ids] of idsByCamel) {
    if (ids.length > 1) {
      errors.push(`duplicate roster ids collide on the same JS import identifier "${camel}": ${ids.join(', ')}`);
    }
  }
  return errors;
}

function briefFor(char, lore) {
  const l = (lore && lore[char.id]) || {};
  return { id: char.id, name: char.name, title: char.title, identity: l.identity, background: l.background };
}

export async function generatePortraits(modData, opts, imagesClient, codec) {
  const roster = modData.roster || [];
  const idErrors = validateRosterIds(roster);
  if (idErrors.length) throw new Error(idErrors.join('; '));
  if (opts && opts.style && opts.style.length > STYLE_MAX) {
    throw new Error(`--style exceeds the ${STYLE_MAX}-char cap (${opts.style.length})`);
  }

  const warnings = [];
  const sizes = planBatches(roster.length);
  if (sizes.length > 1) warnings.push(`roster spans ${sizes.length} grid images — style drift between batches is possible`);

  const plan = [];
  let offset = 0;
  for (const count of sizes) {
    const batch = roster.slice(offset, offset + count).map(c => briefFor(c, modData.lore));
    const geometry = gridGeometry(count);
    const { prompt, warnings: w } = buildGridPrompt(batch, { style: opts && opts.style });
    warnings.push(...w);
    plan.push({ count, geometry, prompt, batch });
    offset += count;
  }

  if (opts && opts.dryRun) {
    return { portraits: [], usage: null, warnings, plan: plan.map(({ count, geometry, prompt }) => ({ count, geometry, prompt })) };
  }

  // generate + pixelize EVERYTHING in memory; any failure aborts with nothing produced
  const portraits = [];
  const usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  let sawUsage = false;
  for (const step of plan) {
    const { b64, usage: u } = await imagesClient.generate(step.prompt, { size: step.geometry.size });
    if (u) {
      sawUsage = true;
      usage.input_tokens += u.input_tokens || 0;
      usage.output_tokens += u.output_tokens || 0;
      usage.total_tokens += u.total_tokens || 0;
    }
    const img = codec.decode(b64);
    for (let k = 0; k < step.count; k++) {
      portraits.push({ id: step.batch[k].id, image: pixelizeCell(sliceCell(img, step.geometry, k)) });
    }
  }
  return {
    portraits, usage: sawUsage ? usage : null, warnings,
    plan: plan.map(({ count, geometry, prompt }) => ({ count, geometry, prompt })),
  };
}
