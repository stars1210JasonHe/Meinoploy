// Atlas archetype library — reusable district templates (spec §4.1)
// Each archetype: { id, name, sprite, spaceSlots, statLean, tierHint }
// - spaceSlots: ordered roles expanded into board spaces by src/world-loader.js
// - statLean: per-stat bias aggregated (and clamped) into map traits
// - sprite: placeholder filename; assets are a render-task concern
// Stat keys match the 6 character stats: capital, luck, negotiation, charisma, tech, stamina.

export var ARCHETYPES = {
  'downtown': {
    id: 'downtown',
    name: 'Downtown',
    sprite: 'downtown.png',
    spaceSlots: [{ role: 'property' }, { role: 'property' }, { role: 'property' }],
    statLean: { charisma: 0.04 },
    tierHint: 'high',
  },
  'port': {
    id: 'port',
    name: 'Trade Port',
    sprite: 'port.png',
    spaceSlots: [{ role: 'property' }, { role: 'property' }, { role: 'transit' }],
    statLean: { negotiation: 0.05 },
    tierHint: 'mid',
  },
  'industrial': {
    id: 'industrial',
    name: 'Industrial Zone',
    sprite: 'industrial.png',
    spaceSlots: [{ role: 'property' }, { role: 'property' }, { role: 'tax' }],
    statLean: { stamina: 0.04 },
    tierHint: 'low',
  },
  'financial-district': {
    id: 'financial-district',
    name: 'Financial District',
    sprite: 'financial-district.png',
    spaceSlots: [{ role: 'property' }, { role: 'property' }, { role: 'community' }],
    statLean: { capital: 0.05 },
    tierHint: 'high',
  },
  'tech-hub': {
    id: 'tech-hub',
    name: 'Tech Hub',
    sprite: 'tech-hub.png',
    spaceSlots: [{ role: 'property' }, { role: 'property' }, { role: 'chance' }],
    statLean: { tech: 0.05 },
    tierHint: 'high',
  },
  'market': {
    id: 'market',
    name: 'Market Bazaar',
    sprite: 'market.png',
    spaceSlots: [{ role: 'property' }, { role: 'property' }, { role: 'property' }],
    statLean: { negotiation: 0.04 },
    tierHint: 'low',
  },
  'residential': {
    id: 'residential',
    name: 'Residential Quarter',
    sprite: 'residential.png',
    spaceSlots: [{ role: 'property' }, { role: 'property' }, { role: 'property' }],
    statLean: { charisma: 0.03 },
    tierHint: 'low',
  },
  'landmark': {
    id: 'landmark',
    name: 'Landmark',
    sprite: 'landmark.png',
    spaceSlots: [{ role: 'property' }, { role: 'property' }, { role: 'chance' }],
    statLean: { luck: 0.04 },
    tierHint: 'mid',
  },
  'transit-hub': {
    id: 'transit-hub',
    name: 'Transit Hub',
    sprite: 'transit-hub.png',
    spaceSlots: [{ role: 'transit' }, { role: 'property' }, { role: 'property' }],
    statLean: { tech: 0.03 },
    tierHint: 'mid',
  },
  'wilderness': {
    id: 'wilderness',
    name: 'Wilderness',
    sprite: 'wilderness.png',
    spaceSlots: [{ role: 'property' }, { role: 'property' }, { role: 'chance' }],
    statLean: { luck: 0.05 },
    tierHint: 'low',
  },
  'frontier': {
    id: 'frontier',
    name: 'Frontier',
    sprite: 'frontier.png',
    spaceSlots: [{ role: 'property' }, { role: 'property' }, { role: 'tax' }],
    statLean: { stamina: 0.05 },
    tierHint: 'low',
  },
  'capital-hub': {
    id: 'capital-hub',
    name: 'Capital Hub',
    sprite: 'capital-hub.png',
    spaceSlots: [{ role: 'property' }, { role: 'property' }, { role: 'community' }],
    statLean: { capital: 0.03 },
    tierHint: 'mid',
  },
};
