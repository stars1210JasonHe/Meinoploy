// Code-side reduce: union-find over the candidate match graph. Candidates link when their
// folded names are equal or either's folded name appears in the other's folded alias set —
// connected components merge into one entry, which correctly handles LATE BRIDGES (a later
// candidate aliasing two entries that were separate until then).
export function fold(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Relationships are objects — dedupe by folded (target, nature) content, not reference.
function dedupeRelationships(rels) {
  const seen = new Set();
  const out = [];
  for (const r of rels) {
    const k = fold(r.target) + '|' + fold(r.nature);
    if (!seen.has(k)) { seen.add(k); out.push(r); }
  }
  return out;
}

function mergeKind(items) {
  const seen = new Map();
  const out = [];
  for (const [ci, cand] of items) {
    const entry = {
      canonicalName: cand.canonicalName,
      aliases: (cand.aliases || []).slice(),
      mentions: cand.mentions || 1,
      firstChunk: ci,
      traits: (cand.traits || []).slice(),
      relationships: (cand.relationships || []).slice(),
      roleHints: cand.roleHints ? [cand.roleHints] : [],
      kind: cand.kind,
      regionHints: cand.regionHints ? [cand.regionHints] : [],
      _bestName: { name: cand.canonicalName, mentions: cand.mentions || 1, firstChunk: ci },
    };
    // Keys this candidate answers to; merging via a shared key map gives transitive unions.
    const keys = [fold(entry.canonicalName), ...entry.aliases.map(fold)].filter(Boolean);
    let target = null;
    for (const k of keys) {
      const hit = seen.get(k);
      if (hit && hit !== target) {
        if (!target) target = hit;
        else {
          // late bridge: absorb `hit` into `target`
          absorb(target, hit);
          out[out.indexOf(hit)] = null;
          for (const [kk, vv] of seen) if (vv === hit) seen.set(kk, target);
        }
      }
    }
    if (target) absorb(target, entry);
    else { target = entry; out.push(entry); }
    for (const k of keys) seen.set(k, target);
  }
  return out
    .filter(Boolean)
    .map(e => {
      return {
        canonicalName: e._bestName.name,
        aliases: [...new Set([e.canonicalName, ...e.aliases])].filter(a => fold(a) !== fold(e._bestName.name)),
        mentions: e.mentions,
        firstChunk: e.firstChunk,
        traits: [...new Set(e.traits)],
        relationships: dedupeRelationships(e.relationships),
        roleHints: [...new Set(e.roleHints)],
        kind: e.kind,
        regionHints: [...new Set(e.regionHints)],
      };
    })
    .sort((a, b) => b.mentions - a.mentions || a.firstChunk - b.firstChunk || (fold(a.canonicalName) < fold(b.canonicalName) ? -1 : 1));
}

function absorb(target, src) {
  target.mentions += src.mentions;
  target.firstChunk = Math.min(target.firstChunk, src.firstChunk);
  target.aliases.push(src.canonicalName, ...src.aliases);
  target.traits.push(...src.traits);
  target.relationships.push(...src.relationships);
  target.roleHints.push(...src.roleHints);
  target.regionHints.push(...src.regionHints);
  if (src.kind && !target.kind) target.kind = src.kind;
  const srcBest = src._bestName || { name: src.canonicalName, mentions: src.mentions, firstChunk: src.firstChunk };
  if (srcBest.mentions > target._bestName.mentions
      || (srcBest.mentions === target._bestName.mentions && srcBest.firstChunk < target._bestName.firstChunk)) {
    target._bestName = srcBest;
  }
}

export function mergeCandidates(chunkResults) {
  const chars = [];
  const places = [];
  const themeCount = new Map();
  chunkResults.forEach((r, ci) => {
    if (!r) return;
    (r.characters || []).forEach(c => chars.push([ci, c]));
    (r.places || []).forEach(p => places.push([ci, p]));
    (r.themes || []).forEach(t => {
      const k = fold(t);
      const cur = themeCount.get(k) || { name: t, n: 0 };
      cur.n++;
      themeCount.set(k, cur);
    });
  });
  return {
    characters: mergeKind(chars),
    places: mergeKind(places),
    themes: [...themeCount.values()].sort((a, b) => b.n - a.n).map(t => t.name),
  };
}

export function cutToTargets(merged, { chars, places }) {
  return {
    characters: merged.characters.slice(0, chars),
    cutCharacters: merged.characters.slice(chars),
    places: merged.places.slice(0, places),
    cutPlaces: merged.places.slice(places),
    themes: merged.themes,
  };
}
