// Create-Mod — thin-builder normalize + validation. Pure (reuses world/map loaders, no fs/images).
import { validateWorld, loadWorld } from '../world-loader';
import { validateMap, loadMap } from '../map-loader';

export const IMPLEMENTED_PASSIVES = ['financier', 'pioneer', 'speculator', 'enforcer', 'idealist', 'breaker', 'arbitrageur', 'merchant'];
export const STAT_KEYS = ['capital', 'luck', 'negotiation', 'charisma', 'tech', 'stamina'];

function deriveGeoPos(place, renderMode) {
  const p = Object.assign({}, place);
  if (p.geo && !p.pos) {
    p.pos = { x: (p.geo.lng + 180) / 360 * 100, y: (90 - p.geo.lat) / 180 * 100 };
  } else if (renderMode === 'globe' && p.pos && !p.geo) {
    p.geo = { lat: 90 - p.pos.y / 100 * 180, lng: p.pos.x / 100 * 360 - 180 };
  }
  return p;
}

export const FIT_PADDING = 12; // default board margin (%) for geo-derived layouts

// Regional worlds (e.g. all-China cities) collapse to a few percent of the board
// under the global equirectangular projection. When EVERY position was derived
// from geo (no author/vision-aligned pos anywhere), refit the layout to the
// board: uniform scale (aspect preserved) + center. Explicit pos is never
// touched — map-image alignment depends on it.
function fitDerivedPositions(originals, places, fitPadding) {
  if (!places.length) return places;
  if (originals.some(p => p && p.pos)) return places;
  if (places.some(p => !p.pos)) return places;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of places) {
    minX = Math.min(minX, p.pos.x); maxX = Math.max(maxX, p.pos.x);
    minY = Math.min(minY, p.pos.y); maxY = Math.max(maxY, p.pos.y);
  }
  const pad = typeof fitPadding === 'number' ? fitPadding : FIT_PADDING;
  const span = Math.max(maxX - minX, maxY - minY);
  const scale = span > 1e-9 ? (100 - 2 * pad) / span : 0;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  return places.map(p => Object.assign({}, p, {
    pos: { x: 50 + (p.pos.x - cx) * scale, y: 50 + (p.pos.y - cy) * scale },
  }));
}

export const MIN_SEPARATION = 8; // default minimum distance (%) between geo-derived places

// Books centered on one region stack many places at near-identical geo
// (a capital's gates/hills, twin names for one pass). After the refit,
// iteratively push pairs closer than minSep apart — deterministic, damped,
// clamped to the fit margin. Pairs already far enough never move.
function deOverlap(places, fitPadding, minSeparation) {
  const minSep = typeof minSeparation === 'number' ? minSeparation : MIN_SEPARATION;
  if (minSep <= 0 || places.length < 2) return places;
  const pad = typeof fitPadding === 'number' ? fitPadding : FIT_PADDING;
  const pts = places.map(p => ({ x: p.pos.x, y: p.pos.y }));
  for (let iter = 0; iter < 200; iter++) {
    let moved = false;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        let dx = pts[j].x - pts[i].x, dy = pts[j].y - pts[i].y;
        let dist = Math.hypot(dx, dy);
        if (dist >= minSep) continue;
        if (dist < 1e-6) { // identical points: split along a deterministic angle
          const a = ((i * 137.508 + j * 61) % 360) * Math.PI / 180;
          dx = Math.cos(a); dy = Math.sin(a); dist = 1;
        }
        const push = (minSep - Math.min(dist, minSep)) / 2 * 0.5; // damped half-step each
        const ux = dx / dist, uy = dy / dist;
        pts[i].x -= ux * push; pts[i].y -= uy * push;
        pts[j].x += ux * push; pts[j].y += uy * push;
        moved = true;
      }
    }
    for (const pt of pts) {
      pt.x = Math.min(100 - pad, Math.max(pad, pt.x));
      pt.y = Math.min(100 - pad, Math.max(pad, pt.y));
    }
    if (!moved) break;
  }
  return places.map((p, i) => Object.assign({}, p, { pos: { x: pts[i].x, y: pts[i].y } }));
}

export function normalizeAtlasWorld(world, archetypes) {
  const derived = (world.places || []).map(p => deriveGeoPos(p, world.renderMode));
  const original = world.places || [];
  let places = fitDerivedPositions(original, derived, world.fitPadding);
  if (places !== derived) { // refit ran → layout is fully geo-derived and ours to relax
    places = deOverlap(places, world.fitPadding, world.minSeparation);
  }
  let size = world.size;
  if (!size) {
    let maxSpaces = 0;
    for (const place of places) {
      for (const aid of (place.archetypes || [])) {
        const arch = archetypes[aid];
        if (arch && Array.isArray(arch.spaceSlots)) maxSpaces += arch.spaceSlots.length;
      }
    }
    size = { maxPlaces: places.length, maxSpaces };
  }
  return Object.assign({}, world, { places, size });
}

export function normalizeClassicMap(map, input, reusedCards) {
  const out = Object.assign({}, map);
  if (!out.id) out.id = input.id;
  if (!out.name) out.name = input.name;
  if (!out.cards) {
    const sc = out.spaceCount;
    const safe = deck => (deck || []).filter(c => c.action !== 'moveTo' || (c.value >= 0 && c.value < sc));
    out.cards = { chance: safe(reusedCards.chance), community: safe(reusedCards.community) };
  }
  return out;
}

function stubLore(char, roster) {
  const others = roster.filter(c => c.id !== char.id);
  const rel = others.length
    ? { target: others[0].name, description: 'A rival contesting the board.' }
    : { target: char.name, description: 'Stands alone on the board.' };
  const titlePart = char.title ? ', ' + char.title + ',' : '';
  return {
    nameZh: char.name,
    titleZh: char.title || '',
    identity: char.title || char.name,
    alignment: 'Strategy',
    background: `${char.name}${titlePart} contends for control of the board.`,
    joining: `On the board, ${char.name} plays to their strengths.`,
    styleIntro: `${char.name} plays by one rule:`,
    style: ['Press every advantage.'],
    styleOutro: 'They adapt to the board as it turns.',
    relationships: [rel],
    themeSummary: `${char.name}\nplays to win.`,
  };
}

export function normalizeRoster(roster, inputLore) {
  const lore = Object.assign({}, inputLore);
  const data = roster.map(c => ({
    id: c.id,
    name: c.name,
    title: c.title || '',
    stats: c.stats,
    passive: c.passive,
    color: c.color,
  }));
  const portraits = roster.filter(c => c.portrait).map(c => ({ id: c.id, path: c.portrait }));
  for (const c of data) {
    if (!lore[c.id]) lore[c.id] = stubLore(c, data);
  }
  return { data, portraits, lore };
}

export function normalizeInput(input, opts) {
  const archetypes = (opts && opts.ARCHETYPES) || {};
  const reusedCards = (opts && opts.reusedCards) || { chance: [], community: [] };
  const out = {
    id: input.id,
    name: input.name,
    tagline: input.tagline || '',
    version: input.version || '1.0.0',
    mapType: input.mapType,
    reuse: Object.assign({ rules: 'dominion', board: 'dominion', cards: 'dominion' }, input.reuse || {}),
    world: null,
    map: null,
  };
  if (input.mapType === 'atlas' && input.world) {
    const world = Object.assign({}, input.world);
    if (!world.id) world.id = input.id;
    if (!world.name) world.name = input.name;
    out.world = normalizeAtlasWorld(world, archetypes);
  } else if (input.mapType === 'classic' && input.map) {
    out.map = normalizeClassicMap(input.map, input, reusedCards);
  }
  const { data, portraits, lore } = normalizeRoster(input.roster || [], input.lore || {});
  out.roster = data;
  out.portraits = portraits;
  out.lore = lore;
  return out;
}

function validateRoster(normalized, errors, warnings) {
  const roster = normalized.roster || [];
  if (roster.length < 2) errors.push('roster must have >= 2 characters');
  if (roster.length > 24) warnings.push(`roster has ${roster.length} characters (unusually large)`);
  const ids = new Set(), colors = new Set();
  const wantKeys = JSON.stringify([...STAT_KEYS].sort());
  roster.forEach((c, i) => {
    if (!c.id) { errors.push(`roster[${i}]: id required`); return; }
    if (ids.has(c.id)) errors.push(`roster: duplicate id "${c.id}"`); else ids.add(c.id);
    if (!c.color) errors.push(`roster (${c.id}): color required`);
    else if (colors.has(c.color)) errors.push(`roster: duplicate color "${c.color}"`); else colors.add(c.color);
    const stats = c.stats || {};
    if (JSON.stringify(Object.keys(stats).sort()) !== wantKeys) {
      errors.push(`roster (${c.id}): stats must have exactly ${STAT_KEYS.join(', ')}`);
    } else {
      let sum = 0;
      for (const k of STAT_KEYS) {
        const v = stats[k];
        if (!Number.isInteger(v) || v < 1 || v > 10) errors.push(`roster (${c.id}): stat ${k} must be integer 1-10`);
        sum += v;
      }
      if (sum !== 34) warnings.push(`roster (${c.id}): stat sum ${sum} != 34 (Terra Titans convention)`);
    }
    const p = c.passive || {};
    if (!IMPLEMENTED_PASSIVES.includes(p.id)) errors.push(`roster (${c.id}): passive.id "${p.id}" not one of the 8 implemented (${IMPLEMENTED_PASSIVES.join(', ')})`);
    if (!p.name) errors.push(`roster (${c.id}): passive.name required`);
    if (!p.description) errors.push(`roster (${c.id}): passive.description required`);
    const lore = (normalized.lore || {})[c.id];
    if (!lore) { errors.push(`roster (${c.id}): missing lore entry`); return; }
    for (const f of ['background', 'joining', 'themeSummary']) {
      if (typeof lore[f] !== 'string' || !lore[f]) errors.push(`lore (${c.id}): ${f} required (non-empty string)`);
    }
    if (!Array.isArray(lore.style) || lore.style.length === 0) errors.push(`lore (${c.id}): style[] required (non-empty)`);
    if (!Array.isArray(lore.relationships) || lore.relationships.length === 0) errors.push(`lore (${c.id}): relationships[] required (non-empty)`);
  });
}

export function validateModInput(input, opts) {
  const archetypes = (opts && opts.ARCHETYPES) || {};
  const errors = [];
  const warnings = [];
  if (!input || typeof input !== 'object') return { ok: false, errors: ['input must be an object'], warnings, normalized: null };
  if (!input.id || !/^[a-z0-9-]+$/.test(input.id)) errors.push('id must be kebab-case [a-z0-9-]');
  if (!input.name) errors.push('name is required');
  if (input.mapType !== 'atlas' && input.mapType !== 'classic') errors.push('mapType must be "atlas" or "classic"');
  const reuse = input.reuse || {};
  for (const k of ['rules', 'board', 'cards']) {
    if (reuse[k] && reuse[k] !== 'dominion') errors.push(`reuse.${k} "${reuse[k]}" unsupported (only "dominion" this slice)`);
  }
  if (errors.length) return { ok: false, errors, warnings, normalized: null };

  const normalized = normalizeInput(input, opts);

  if (input.mapType === 'atlas') {
    if (!normalized.world) errors.push('atlas input requires a "world"');
    else {
      errors.push(...validateWorld(normalized.world, archetypes));
      (normalized.world.places || []).forEach(p => {
        const hasPos = p.pos && typeof p.pos.x === 'number' && typeof p.pos.y === 'number';
        const hasGeo = p.geo && typeof p.geo.lat === 'number' && typeof p.geo.lng === 'number';
        if (!hasPos && !hasGeo) errors.push(`place "${p.id}": requires pos.{x,y} or geo.{lat,lng}`);
        // Defensive backstop: normalizeAtlasWorld derives geo from pos for globe worlds, so a globe
        // place lacks geo here only if it had neither pos nor geo (already caught above). pos-only
        // globe places are intentionally accepted (geo is derived), which prevents a blank globe.
        if (normalized.world.renderMode === 'globe' && !hasGeo) errors.push(`place "${p.id}": renderMode "globe" requires geo.{lat,lng}`);
      });
      if (errors.length === 0) {
        try { loadWorld(normalized.world, archetypes); }
        catch (e) { errors.push('loadWorld failed: ' + e.message); }
      }
    }
  } else if (input.mapType === 'classic') {
    if (!normalized.map) errors.push('classic input requires a "map"');
    else {
      // Reused Dominion cards may reference spaces that don't exist / differ on a non-40-space
      // board (only out-of-range moveTo is dropped). Warn so the author supplies map.cards.
      if (!input.map.cards && normalized.map.spaceCount !== 40) {
        warnings.push(`classic map "${normalized.map.id}" omits cards on a ${normalized.map.spaceCount}-space board; injected Dominion cards may reference mismatched spaces — supply map.cards`);
      }
      errors.push(...validateMap(normalized.map));
      if (errors.length === 0) {
        try { loadMap(normalized.map); }
        catch (e) { errors.push('loadMap failed: ' + e.message); }
      }
    }
  }

  validateRoster(normalized, errors, warnings);
  return { ok: errors.length === 0, errors, warnings, normalized };
}
