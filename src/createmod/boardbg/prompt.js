// Create-Mod board backgrounds — era-driven prompt composer (pure).
// Spec: docs/superpowers/specs/2026-07-13-visual-reskin-design.md §2 (amended):
// world.story does NOT exist on generated mods — the composition aggregates what
// exists everywhere: character lore themeSummary/background first-sentences,
// story/tagline WHEN present, place names, and a FIXED hi-bit style suffix
// (mirroring the portrait pipeline's style discipline).
import { firstSentence } from '../portraits/prompt';

export const PROMPT_MAX = 30000;
export const PLACES_MAX = 12;

export const BOARDBG_STYLE =
  'Hi-bit pixel-art night map background, top-down terrain viewed from high above, ' +
  'ordered-dither banded gradients (never smooth washes), dark deep-space palette ' +
  '(navy/void base) with cyan and amber glow accents, chunky visible pixels, ' +
  'limited palette (~32 colors), atmospheric night-lights mood. ' +
  'NO text, NO labels, NO UI elements, NO borders, NO characters or figures — ' +
  'pure environment art that reads as a game-board backdrop.';

// mod: { kind:'world'|'map', name?, story?, tagline?, places?, mapName?, roster?, lore? }
export function composeBoardBgPrompt(mod) {
  const warnings = [];
  const lines = [];
  const title = mod.kind === 'map' ? mod.mapName : mod.name;
  lines.push(`A single pixel-art game-board background for "${title || 'an unnamed world'}".`);

  if (mod.story) lines.push(`World story: ${mod.story}`);
  if (mod.tagline) lines.push(`Tagline: ${mod.tagline}`);

  // Era flavor from character lore — themeSummary AND the biography's first
  // sentence (spec §2: aggregate both; present across all mods incl. generated).
  const themes = [];
  for (const c of mod.roster || []) {
    const l = (mod.lore || {})[c.id] || {};
    if (l.themeSummary) themes.push(firstSentence(l.themeSummary));
    if (l.background) themes.push(firstSentence(l.background));
    if (!l.themeSummary && !l.background && c.title) themes.push(`${c.name} — ${c.title}`);
  }
  if (themes.length) lines.push(`Era and tone, drawn from the cast: ${themes.join(' ')}`);

  const places = (mod.places || []).map(p => p.realName || p.name).filter(Boolean);
  if (places.length > PLACES_MAX) {
    warnings.push(`places capped at ${PLACES_MAX} of ${places.length}`);
  }
  if (places.length) {
    lines.push(`Geography flavor — the region spans: ${places.slice(0, PLACES_MAX).join(', ')}.`);
  }

  lines.push(BOARDBG_STYLE);
  const prompt = lines.join('\n');
  if (prompt.length > PROMPT_MAX) {
    throw new Error(`board-bg prompt exceeds ${PROMPT_MAX} chars (${prompt.length})`);
  }
  return { prompt, warnings };
}
