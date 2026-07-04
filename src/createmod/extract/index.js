// SP2 orchestrator: PURE — no fs/network. The llm client and cached chunk results are
// injected by the CLI. Task-7 adds the section-scoped repair machinery; the shared pieces
// (gate, degrade, assemble, offline check) live here.
import { chunkBook } from './chunk';
import { detectLang } from './language';
import { mergeCandidates, cutToTargets, fold } from './merge';
import {
  buildMapPrompt, buildWorldPrompt, buildBoardPrompt, buildRosterPrompt, buildLorePrompt,
  buildRepairPrompt,
} from './prompts';
import { expandFacts } from '../smart/index';
import { validateModInput } from '../validate';
import { ARCHETYPES } from '../../../mods/dominion/atlas/archetypes';
import { CHANCE_CARDS, COMMUNITY_CARDS } from '../../../mods/dominion/cards';

const SP1_OPTS = { ARCHETYPES, reusedCards: { chance: CHANCE_CARDS, community: COMMUNITY_CARDS } };
const KEBAB = /^[a-z0-9-]+$/;

export function kebabAscii(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// tiny promise pool
async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function extractFacts(bookText, opts, llm) {
  const usage = { prompt_tokens: 0, completion_tokens: 0 };
  const addUsage = u => { usage.prompt_tokens += u.prompt_tokens || 0; usage.completion_tokens += u.completion_tokens || 0; };
  const warnings = [];
  const lang = opts.lang === 'auto' || !opts.lang ? detectLang(bookText) : opts.lang;

  // 1) chunk + 2) map (concurrency 4; cached chunks skipped; failures skip+warn)
  const chunks = chunkBook(bookText, { chunkSize: opts.chunkSize, overlap: opts.overlap, maxChunks: opts.maxChunks });
  const cached = opts.cachedChunks || {};
  const chunksSkipped = [];
  const chunkResults = await pool(chunks, 4, async (chunk, i) => {
    if (cached[i]) return cached[i];
    try {
      const { data, usage: u } = await llm.map(buildMapPrompt(chunk.text, lang));
      addUsage(u);
      if (opts.onChunkResult) opts.onChunkResult(i, data);
      return data;
    } catch (e) {
      chunksSkipped.push(i);
      warnings.push(`chunk ${i} skipped after retries: ${e.message}`);
      return null;
    }
  });

  // 3) reduce + shortfall fail-fast (never fabricate)
  const merged = mergeCandidates(chunkResults);
  const minChars = 2;
  const minPlaces = opts.mapType === 'classic' ? 4 : 3;
  if (merged.characters.length < minChars) {
    throw new Error(`book yields only ${merged.characters.length} character(s); need >= ${minChars} — try a longer excerpt or lower targets`);
  }
  if (merged.places.length < minPlaces) {
    throw new Error(`book yields only ${merged.places.length} place(s); need >= ${minPlaces} — try a longer excerpt or lower targets`);
  }
  const cut = cutToTargets(merged, { chars: opts.chars, places: opts.places });

  // 4) synthesis
  const synth = async (prompt, o) => { const r = await llm.synth(prompt, o); addUsage(r.usage); return r.data; };

  let worldData = null;
  let boardData = null;
  if (opts.mapType === 'classic') {
    boardData = await synth(buildBoardPrompt(cut, cut.themes, lang));
  } else {
    worldData = await synth(
      buildWorldPrompt(cut, cut.themes, lang, { mapImage: !!opts.mapImageDataUrl }),
      opts.mapImageDataUrl ? { imageDataUrl: opts.mapImageDataUrl } : undefined,
    );
  }

  let rosterData = await synth(buildRosterPrompt(cut.characters, lang, cut.characters.length));
  let roster = rosterData.roster || [];

  // Roster-id integrity GATE (kebab + uniqueness) BEFORE any lore call. Gate repair counts
  // toward the roster call's max-2-runs-per-run budget.
  let rosterGateRepairUsed = false;
  const gateErrors = rosterIdErrors(roster);
  if (gateErrors.length > 0) {
    rosterGateRepairUsed = true;
    const rep = buildRepairPrompt(buildRosterPrompt(cut.characters, lang, cut.characters.length), gateErrors);
    rosterData = await synth(rep);
    roster = rosterData.roster || [];
  }
  const stillDirty = rosterIdErrors(roster);
  let loreSkippedForDirtyRoster = false;
  const lore = {};
  const degradedLore = [];
  if (stillDirty.length > 0) {
    // clean-final-roster invariant: never run lore against a dirty roster; fall through to
    // assemble+validate and take the exit-1 path there.
    loreSkippedForDirtyRoster = true;
    warnings.push('roster ids still invalid after the gate repair; lore skipped: ' + stillDirty.join('; '));
  } else {
    // 5) per-character lore, concurrency 2, DEGRADE on failure
    const names = roster.map(r => r.name);
    await pool(roster, 2, async member => {
      const evidence = evidenceFor(member, cut.characters);
      try {
        const data = await synth(buildLorePrompt(member, evidence, names.filter(n => n !== member.name), lang));
        lore[member.id] = data;
      } catch (e) {
        degradedLore.push(member.id);
        warnings.push(`lore for ${member.id} failed after retries; SP1 will stub it — hand-edit facts.json for real lore (synthesis re-runs are uncached): ${e.message}`);
      }
    });
  }

  // 6) assemble
  const synthMeta = worldData || boardData;
  const id = opts.id
    || (kebabAscii(opts.bookBasename) || null)
    || synthMeta.modId;
  const facts = {
    id,
    name: synthMeta.modTitle,
    tagline: synthMeta.tagline,
    version: '1.0.0',
    mapType: opts.mapType === 'classic' ? 'classic' : 'atlas',
    seed: id,
    roster,
    lore,
  };
  if (boardData) {
    facts.board = { groups: boardData.groups };
  } else {
    const places = worldData.places.map(p => {
      const out = { ...p };
      if (out.pos && !out.geo) {
        // UNCONDITIONAL pseudo-geo backfill (SP4 topology derefs geo)
        out.geo = { lat: 90 - out.pos.y / 100 * 180, lng: out.pos.x / 100 * 360 - 180 };
      }
      return out;
    });
    facts.world = {
      renderMode: opts.mapImageDataUrl ? 'flat' : worldData.renderMode,
      winPaths: ['dominion', 'wealth', 'survival'],
      victory: worldData.victory,
      places,
    };
    if (opts.mapImageRelPath) {
      facts.world.mapImage = String(opts.mapImageRelPath).replace(/\\/g, '/');
    }
  }

  // 7) offline validation + ONE section-scoped repair round (Task 7 wires repairs)
  const validationErrors = await validateAndRepair(facts, {
    llm, addUsage, lang, cut, opts, degradedLore, rosterGateRepairUsed, lore, warnings,
  });

  const report = {
    chunksTotal: chunks.length,
    chunksSkipped,
    candidates: { characters: merged.characters.length, places: merged.places.length },
    cut: {
      characters: cut.characters.map(c => c.canonicalName),
      places: cut.places.map(p => p.canonicalName),
      droppedCharacters: cut.cutCharacters.map(c => c.canonicalName),
      droppedPlaces: cut.cutPlaces.map(p => p.canonicalName),
    },
    warnings,
    validationErrors,
    degradedLore,
    interpolatedPlaces: facts.world
      ? facts.world.places.filter(p => p.interpolated).map(p => p.realName)
      : [],
    usage,
    lang,
  };
  return { facts, report };
}

function rosterIdErrors(roster) {
  const errors = [];
  const seen = new Set();
  roster.forEach(r => {
    if (!KEBAB.test(r.id || '')) errors.push(`roster (${r.id}): id must match ^[a-z0-9-]+$`);
    if (seen.has(r.id)) errors.push(`roster: duplicate id "${r.id}"`);
    seen.add(r.id);
  });
  return errors;
}

function evidenceFor(member, cutCharacters) {
  const hit = cutCharacters.find(c => fold(c.canonicalName) === fold(member.name))
    || cutCharacters.find(c => c.aliases.some(a => fold(a) === fold(member.name)));
  if (!hit) return 'No direct evidence collected.';
  return `traits: ${hit.traits.join(', ')}\nroles: ${hit.roleHints.join('; ')}\n`
    + `relationships: ${hit.relationships.map(r => `${r.target} (${r.nature})`).join('; ')}`;
}

// Explicit routing table (spec step 6). Real error strings don't share one prefix scheme:
//  - lore CONTENT errors  -> that character's lore call  (capture [^)]+ — the id may be malformed)
//  - lore KEY charset / orphan-key errors -> ROSTER call (keys derive from roster ids)
//  - "missing a non-degraded lore entry"  -> that character's LORE call (only route that can fix it)
//  - roster-family -> roster call
//  - EVERYTHING ELSE -> world|board call (default bucket; never dropped)
export function routeErrors(errors, rosterIds) {
  const out = { world: [], roster: [], loreByChar: {}, unroutable: [] };
  for (const e of errors) {
    const lore = e.match(/^lore \(([^)]+)\):/);
    if (lore) {
      const id = lore[1];
      if (/key must match|orphan key/.test(e)) out.roster.push(e);
      else (out.loreByChar[id] = out.loreByChar[id] || []).push(e);
      continue;
    }
    if (/^(roster|facts\.roster)/.test(e)) { out.roster.push(e); continue; }
    out.world.push(e);
  }
  return out;
}

export async function validateAndRepair(facts, ctx) {
  let errors = runOfflineChecks(facts, ctx);
  if (errors.length === 0) return [];

  const { llm, addUsage, lang, cut, opts, warnings } = ctx;
  const synth = async (prompt, o) => { const r = await llm.synth(prompt, o); addUsage(r.usage); return r.data; };
  const routed = routeErrors(errors, facts.roster.map(r => r.id));

  // world|board section
  if (routed.world.length > 0) {
    try {
      if (facts.board) {
        const rep = await synth(buildRepairPrompt(buildBoardPrompt(cut, cut.themes, lang), routed.world));
        facts.board = { groups: rep.groups };
        facts.name = facts.name || rep.modTitle;
      } else {
        const base = buildWorldPrompt(cut, cut.themes, lang, { mapImage: !!opts.mapImageDataUrl });
        const rep = await synth(buildRepairPrompt(base, routed.world),
          opts.mapImageDataUrl ? { imageDataUrl: opts.mapImageDataUrl } : undefined);
        const places = rep.places.map(p => {
          const o = { ...p };
          if (o.pos && !o.geo) o.geo = { lat: 90 - o.pos.y / 100 * 180, lng: o.pos.x / 100 * 360 - 180 };
          return o;
        });
        facts.world = { ...facts.world, renderMode: opts.mapImageDataUrl ? 'flat' : rep.renderMode, victory: rep.victory, places };
      }
    } catch (e) {
      warnings.push('world/board repair failed: ' + e.message);
    }
  }

  // roster section — the spec's budget is "at most TWICE per run: once at the step-4 gate,
  // once HERE" — so this repair runs regardless of whether the gate fired (each has its own
  // single-use budget).
  if (routed.roster.length > 0) {
    try {
      const oldRoster = facts.roster;
      const rep = await synth(buildRepairPrompt(buildRosterPrompt(cut.characters, lang, cut.characters.length), routed.roster));
      const newRoster = rep.roster || [];
      // reconciliation: name-first diff (position fallback); re-key lore + degraded set;
      // re-run lore for genuinely new ids; drop orphans. Never silently stub.
      const oldByName = new Map(oldRoster.map((r, i) => [fold(r.name), { r, i }]));
      const newLore = {};
      const newDegraded = [];
      for (let i = 0; i < newRoster.length; i++) {
        const nr = newRoster[i];
        const hit = oldByName.get(fold(nr.name)) || (oldRoster[i] ? { r: oldRoster[i], i } : null);
        const oldId = hit ? hit.r.id : null;
        if (oldId && ctx.lore[oldId]) newLore[nr.id] = ctx.lore[oldId];
        else if (oldId && ctx.degradedLore.includes(oldId)) {
          newDegraded.push(nr.id);
          warnings.push(`lore for ${nr.id} (renamed from ${oldId}) remains degraded; SP1 will stub it`);
        } else {
          // genuinely new character: run its lore call now (degrade on failure)
          try {
            const data = await synth(buildLorePrompt(nr, evidenceFor(nr, cut.characters), newRoster.map(x => x.name).filter(n => n !== nr.name), lang));
            newLore[nr.id] = data;
          } catch (e) {
            newDegraded.push(nr.id);
            warnings.push(`lore for ${nr.id} failed after retries; SP1 will stub it — hand-edit facts.json for real lore: ${e.message}`);
          }
        }
      }
      facts.roster = newRoster;
      // replace lore map contents in place (facts.lore === ctx.lore reference)
      Object.keys(ctx.lore).forEach(k => delete ctx.lore[k]);
      Object.assign(ctx.lore, newLore);
      ctx.degradedLore.length = 0;
      ctx.degradedLore.push(...newDegraded);
    } catch (e) {
      warnings.push('roster repair failed: ' + e.message);
    }
  }

  // per-character lore sections (degrade on failure)
  for (const [id, errs] of Object.entries(routed.loreByChar)) {
    const member = facts.roster.find(r => r.id === id);
    if (!member) continue; // orphan handled via roster route
    try {
      const data = await synth(buildLorePrompt(member, evidenceFor(member, cut.characters), facts.roster.map(x => x.name).filter(n => n !== member.name), lang));
      ctx.lore[member.id] = data;
    } catch (e) {
      if (!ctx.degradedLore.includes(member.id)) ctx.degradedLore.push(member.id);
      delete ctx.lore[member.id];
      warnings.push(`lore repair for ${member.id} failed; SP1 will stub it: ${e.message}`);
    }
  }

  // re-validate once; remaining errors go to the report (facts still written; exit 1 at CLI)
  return runOfflineChecks(facts, ctx);
}

export function runOfflineChecks(facts, ctx) {
  const errors = [];
  // (a) SP2's own id + membership + cut-fidelity checks
  facts.roster.forEach(r => { if (!KEBAB.test(r.id || '')) errors.push(`roster (${r.id}): id must match ^[a-z0-9-]+$`); });
  if (facts.world) {
    facts.world.places.forEach(p => { if (!KEBAB.test(p.id || '')) errors.push(`place "${p.id}": id must match ^[a-z0-9-]+$`); });
  }
  const rosterIds = new Set(facts.roster.map(r => r.id));
  Object.keys(facts.lore).forEach(k => {
    if (!KEBAB.test(k)) errors.push(`lore (${k}): key must match ^[a-z0-9-]+$`);
    if (!rosterIds.has(k)) errors.push(`lore (${k}): orphan key — no matching roster id`);
  });
  facts.roster.forEach(r => {
    if (!facts.lore[r.id] && !ctx.degradedLore.includes(r.id)) {
      errors.push(`lore (${r.id}): roster id missing a non-degraded lore entry`);
    }
  });
  // cut fidelity: 1:1 by folded canonical name (atlas world + roster)
  if (facts.world) {
    const want = new Set(ctx.cut.places.map(p => fold(p.canonicalName)));
    const got = new Set(facts.world.places.map(p => fold(p.realName)));
    ctx.cut.places.forEach(p => { if (!got.has(fold(p.canonicalName))) errors.push(`place "${p.canonicalName}": missing from world output (cut fidelity)`); });
    facts.world.places.forEach(p => { if (!want.has(fold(p.realName))) errors.push(`place "${p.realName}": not in the cut list (cut fidelity)`); });
  }
  {
    const want = new Set(ctx.cut.characters.map(c => fold(c.canonicalName)));
    const got = new Set(facts.roster.map(r => fold(r.name)));
    ctx.cut.characters.forEach(c => { if (!got.has(fold(c.canonicalName))) errors.push(`roster (${kebabAscii(c.canonicalName)}): missing from roster output (cut fidelity)`); });
    facts.roster.forEach(r => { if (!want.has(fold(r.name))) errors.push(`roster (${r.id}): not in the cut list (cut fidelity)`); });
  }
  // (b) expandFacts inside try/catch, (c) validateModInput
  try {
    const input = expandFacts(facts, { ARCHETYPES });
    const r = validateModInput(input, SP1_OPTS);
    errors.push(...r.errors);
  } catch (e) {
    errors.push('smart-build failed: ' + String((e && e.message) || e));
  }
  return errors;
}
