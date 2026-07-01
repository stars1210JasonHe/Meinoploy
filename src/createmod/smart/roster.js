// Smart-builder roster: passive fill-in, concept/rough-stat derivation normalized to
// sum EXACTLY 34 (each stat an integer in [1,10]), unique color assignment.

export const STAT_KEYS = ['capital', 'luck', 'negotiation', 'charisma', 'tech', 'stamina'];

// Generic name/description per implemented passive — filled when the author gives only an id.
// Descriptions match each id's REAL engine behaviour (see mods/dominion rules/passives).
export const PASSIVE_DEFAULTS = {
  financier: { name: 'Financier', description: 'Property purchase price -10%. Financial negative-event losses -20%.' },
  pioneer: { name: 'Pioneer', description: 'Property upgrade cost -20%.' },
  speculator: { name: 'Speculator', description: 'Re-draw an event card you do not like. Negative event duration -1 turn.' },
  enforcer: { name: 'Enforcer', description: 'Designate one owned property as regulated; opponents pay +20% rent there.' },
  idealist: { name: 'Idealist', description: 'Gain +$50 each time you pass GO (stacks with the salary).' },
  breaker: { name: 'Breaker', description: "Reduce rent you pay on opponents' monopoly properties by 25%." },
  arbitrageur: { name: 'Arbitrageur', description: 'Gain $100 whenever any player goes bankrupt. Rebuild cost -30%.' },
  merchant: { name: 'Merchant', description: 'Preview the next event card before drawing. Conceal your assets during trades.' },
};

// Concept-mode stat lean per passive (flavor only — traits do not affect gameplay yet).
export const PASSIVE_STAT_LEAN = {
  financier: { primary: 'capital', secondary: 'negotiation' },
  pioneer: { primary: 'tech', secondary: 'capital' },
  speculator: { primary: 'luck', secondary: 'tech' },
  enforcer: { primary: 'negotiation', secondary: 'stamina' },
  idealist: { primary: 'charisma', secondary: 'stamina' },
  breaker: { primary: 'negotiation', secondary: 'luck' },
  arbitrageur: { primary: 'capital', secondary: 'luck' },
  merchant: { primary: 'tech', secondary: 'negotiation' },
};

export const DEFAULT_PALETTE = [
  '#b5651d', '#7e57c2', '#ff8f00', '#212121', '#c2185b', '#1565c0', '#b71c1c', '#fbc02d',
  '#2e7d32', '#5d4037', '#0277bd', '#37474f', '#f57f17', '#00695c', '#6a1b9a', '#ffd54f',
];

// Clamp to [1,10] then walk to sum 34: +1 the highest-weight eligible (<10) stat, or
// -1 the lowest-weight eligible (>1). Ties break on lowest STAT_KEYS index (first wins).
// Terminates: sum is bounded in [6,60] which brackets 34, and each step moves it by 1.
function normalizeTo34(raw, weights) {
  const out = {};
  STAT_KEYS.forEach(k => {
    const v = Number.isFinite(raw[k]) ? Math.round(raw[k]) : 5;
    out[k] = Math.min(10, Math.max(1, v));
  });
  let total = STAT_KEYS.reduce((t, k) => t + out[k], 0);
  while (total !== 34) {
    let pick = null;
    if (total < 34) {
      STAT_KEYS.forEach(k => {
        if (out[k] < 10 && (pick === null || weights[k] > weights[pick])) pick = k;
      });
      out[pick]++;
      total++;
    } else {
      STAT_KEYS.forEach(k => {
        if (out[k] > 1 && (pick === null || weights[k] < weights[pick])) pick = k;
      });
      out[pick]--;
      total--;
    }
  }
  return out;
}

function normalizePassive(passive) {
  if (typeof passive === 'string') {
    const d = PASSIVE_DEFAULTS[passive];
    return d ? { id: passive, name: d.name, description: d.description } : { id: passive };
  }
  const p = Object.assign({}, passive);
  const d = PASSIVE_DEFAULTS[p.id];
  if (d) {
    if (!p.name) p.name = d.name;
    if (!p.description) p.description = d.description;
  }
  return p;
}

function conceptStats(char, passive, rng) {
  const base = {};
  STAT_KEYS.forEach(k => { base[k] = 5; });
  const emphasis = char.emphasis
    ? (Array.isArray(char.emphasis) ? char.emphasis : [char.emphasis]).filter(k => STAT_KEYS.includes(k))
    : [];
  const lean = PASSIVE_STAT_LEAN[passive && passive.id];
  if (emphasis.length > 0) {
    base[emphasis[0]] += 3;
    if (emphasis[1]) base[emphasis[1]] += 1;
  } else if (lean) {
    base[lean.primary] += 3;
    base[lean.secondary] += 1;
  }
  // Guard: unknown passive + no emphasis -> flat base (no lean deref); SP1 still reports
  // the clear passive.id error downstream.
  const j1 = STAT_KEYS[Math.floor(rng() * STAT_KEYS.length)];
  const j2 = STAT_KEYS[Math.floor(rng() * STAT_KEYS.length)];
  base[j1] += 1;
  base[j2] -= 1;
  return normalizeTo34(base, Object.assign({}, base));
}

export function deriveRoster(chars, opts) {
  const rng = opts.rng;
  const palette = opts.palette || DEFAULT_PALETTE;
  const used = new Set(chars.filter(c => c.color).map(c => c.color));
  const offset = Math.floor(rng() * palette.length);
  let cursor = 0;
  const nextColor = charId => {
    while (cursor < palette.length) {
      const c = palette[(offset + cursor) % palette.length];
      cursor++;
      if (!used.has(c)) { used.add(c); return c; }
    }
    throw new Error(
      `roster needs ${chars.length} unique colors; palette + authored supply too few (failed at "${charId}")`
    );
  };
  return chars.map(char => {
    const passive = normalizePassive(char.passive);
    const stats = char.stats
      ? normalizeTo34(char.stats, Object.assign({}, char.stats))
      : conceptStats(char, passive, rng);
    const out = {
      id: char.id,
      name: char.name,
      title: char.title || '',
      stats,
      passive,
      color: char.color || nextColor(char.id),
    };
    if (char.portrait) out.portrait = char.portrait;
    return out;
  });
}
