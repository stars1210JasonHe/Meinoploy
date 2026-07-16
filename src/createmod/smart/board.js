// Smart-builder classic board: lay a validateMap-legal ring from named property groups.
// Size N is computed FIRST (GO + Jail + M properties + interspersed specials, padded to
// >=10), then indices 0 and floor(N/2) are reserved, then everything else fills the
// remaining N-2 slots — so jail can never collide with GO or displace a property.

const SPECIAL_EVERY = 3;
const BASE_PRICE = 60;
const PRICE_STEP = 20;
const TAX_BASE = 100;
const DEFAULT_THEME = { boardBackground: '#1b1b2a', cellBackground: '#2c2c3e' };

// Board-safe default decks: no positional moveTo other than 0 (GO), so injected cards can
// never reference a space that does not exist or carries a different name.
const DEFAULT_CARDS = {
  chance: [
    { text: 'Advance to GO! Collect $200.', action: 'moveTo', value: 0 },
    { text: 'A windfall arrives. Collect $75.', action: 'gain', value: 75 },
    { text: 'Caught cutting corners. Go to Jail.', action: 'goToJail', value: 0 },
    { text: 'Audit! Pay 10% of your total assets.', action: 'payPercent', value: 10 },
  ],
  community: [
    { text: 'Community dividend. Collect $50.', action: 'gain', value: 50 },
    { text: 'Public works grant! All players receive $40.', action: 'gainAll', value: 40 },
    { text: 'Advance to GO! Collect $200.', action: 'moveTo', value: 0 },
    { text: 'Levy assessed. Pay 8% of your total assets.', action: 'payPercent', value: 8 },
  ],
};

// opts.rng is accepted for signature symmetry with the other derive* modules but is
// intentionally UNUSED: board derivation is fully order-determined. Do NOT wire rng in —
// consuming draws here would shift the shared stream and break same-seed reproducibility.
export function deriveClassicBoard(boardFacts, opts) { // eslint-disable-line no-unused-vars
  const groups = (boardFacts && boardFacts.groups) || [];
  if (groups.length < 2) {
    throw new Error(`classic board needs >=2 groups (got ${groups.length})`);
  }
  const seenColors = new Map();
  groups.forEach(g => {
    if (!Array.isArray(g.places) || g.places.length < 2) {
      throw new Error(`classic board: group "${g.name}" needs >=2 properties`);
    }
    if (seenColors.has(g.color)) {
      throw new Error(
        `classic board: groups must have unique colors (duplicate "${g.color}" used by "${seenColors.get(g.color)}" and "${g.name}")`
      );
    }
    seenColors.set(g.color, g.name);
  });

  // Collect properties in group order. Each place is EITHER a plain string (hand-authored
  // facts.json, no description) OR a {name, description} object (SP2 synthesis output, or a
  // hand-author opting into the same per-place 简介 field) — both shapes are accepted so this
  // stays backward-compatible with every existing facts.json on disk.
  const properties = [];
  groups.forEach(g => g.places.forEach(item => {
    const name = typeof item === 'string' ? item : item.name;
    const description = typeof item === 'string' ? undefined : item.description;
    properties.push({ name, color: g.color, description });
  }));
  const M = properties.length;

  // Size first: interspersed specials, then pad to N >= 10 with extra chance/community.
  let numSpecials = Math.floor(M / SPECIAL_EVERY);
  let N = 2 + M + numSpecials;
  while (N < 10) { numSpecials++; N++; }

  // Item sequence (length exactly M + numSpecials = N - 2), specials rotating.
  const rotation = ['chance', 'community', 'tax'];
  const items = [];
  let interspersed = 0;
  properties.forEach((p, i) => {
    items.push({ kind: 'property', name: p.name, color: p.color, description: p.description });
    if ((i + 1) % SPECIAL_EVERY === 0 && interspersed < numSpecials) {
      items.push({ kind: rotation[interspersed % 3] });
      interspersed++;
    }
  });
  let padFlip = 0;
  while (interspersed < numSpecials) {
    items.push({ kind: padFlip % 2 === 0 ? 'chance' : 'community' });
    padFlip++;
    interspersed++;
  }

  // Reserve fixed indices, fill the rest in walk order.
  const jailIdx = Math.floor(N / 2);
  const spaces = new Array(N);
  spaces[0] = { id: 0, name: 'GO', type: 'go' };
  spaces[jailIdx] = { id: jailIdx, name: 'Jail', type: 'jail' };
  const groupSpaces = {};
  let idx = 1;
  let order = 0;
  let taxCount = 0;
  items.forEach(item => {
    while (spaces[idx]) idx++;
    if (item.kind === 'property') {
      const price = BASE_PRICE + PRICE_STEP * order;
      spaces[idx] = {
        id: idx,
        name: item.name,
        type: 'property',
        color: item.color,
        price,
        rent: Math.max(2, Math.round(price * 0.06)),
      };
      if (item.description) spaces[idx].description = item.description;
      (groupSpaces[item.color] = groupSpaces[item.color] || []).push(idx);
      order++;
    } else if (item.kind === 'tax') {
      spaces[idx] = { id: idx, name: 'Tax Office', type: 'tax', taxAmount: TAX_BASE + 50 * taxCount++ };
    } else {
      spaces[idx] = {
        id: idx,
        name: item.kind === 'chance' ? 'Chance' : 'Community Chest',
        type: item.kind,
      };
    }
    idx++;
  });

  const colorGroups = {};
  groups.forEach(g => {
    colorGroups[g.color] = { name: g.name, spaces: groupSpaces[g.color] };
  });

  return {
    spaceCount: N,
    layout: { type: 'circle' },
    spaces,
    colorGroups,
    specialSpaces: { go: 0, jail: jailIdx },
    cards: boardFacts.cards || DEFAULT_CARDS,
    theme: boardFacts.theme || DEFAULT_THEME,
  };
}
