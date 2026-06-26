// Terra Titans Mod — Character data (server-safe, NO portrait imports).
//
// 16 historical leaders. Each leader's passive.id is one of the 8 IMPLEMENTED engine
// effects (financier, pioneer, speculator, enforcer, idealist, breaker, arbitrageur,
// merchant) so it actually FIRES — `operator` / `shadow` are config-only (dead) and
// deliberately unused here. The passive NAME + description are leader-flavored, but the
// described effect matches the assigned id's real engine behaviour exactly.
//
// Stats use the same 6 keys as Dominion (Capital, Luck, Negotiation, Charisma, Tech,
// Stamina). Reuses Dominion's RULES for the starting-money formula (same economy v1).

import { RULES } from '../dominion/rules';

export const CHARACTERS_DATA = [
  {
    id: 'hammurabi',
    name: 'Hammurabi',
    title: 'The Lawgiver',
    stats: { capital: 6, luck: 3, negotiation: 6, charisma: 5, tech: 5, stamina: 9 },
    passive: {
      id: 'enforcer',
      name: 'Code of Law',
      description: 'Designate one owned property as regulated; opponents pay +20% rent there.',
    },
    color: '#b5651d',
  },
  {
    id: 'cyrus-the-great',
    name: 'Cyrus the Great',
    title: 'King of Kings',
    stats: { capital: 7, luck: 4, negotiation: 8, charisma: 7, tech: 4, stamina: 4 },
    passive: {
      id: 'financier',
      name: 'Edict of Tolerance',
      description: 'Property purchase price -10%. Financial negative-event losses -20%.',
    },
    color: '#7e57c2',
  },
  {
    id: 'chandragupta-maurya',
    name: 'Chandragupta Maurya',
    title: 'Empire-Founder',
    stats: { capital: 6, luck: 5, negotiation: 6, charisma: 7, tech: 4, stamina: 6 },
    passive: {
      id: 'idealist',
      name: 'Dharma Dividend',
      description: 'Gain +$50 each time you pass GO (stacks with the $200 salary).',
    },
    color: '#ff8f00',
  },
  {
    id: 'cao-cao',
    name: 'Cao Cao',
    title: 'Hero of Chaos',
    stats: { capital: 6, luck: 3, negotiation: 7, charisma: 5, tech: 8, stamina: 5 },
    passive: {
      id: 'merchant',
      name: 'Art of War',
      description: 'Preview the next event card before drawing. Conceal your assets during trades.',
    },
    color: '#212121',
  },
  {
    id: 'liu-bei',
    name: 'Liu Bei',
    title: 'The Benevolent Lord',
    stats: { capital: 5, luck: 5, negotiation: 7, charisma: 9, tech: 4, stamina: 4 },
    passive: {
      id: 'pioneer',
      name: 'Mandate of Virtue',
      description: 'Property upgrade cost -20% — the people build willingly for a just lord.',
    },
    color: '#c2185b',
  },
  {
    id: 'alexander-the-great',
    name: 'Alexander the Great',
    title: 'World-Conqueror',
    stats: { capital: 5, luck: 7, negotiation: 4, charisma: 7, tech: 4, stamina: 7 },
    passive: {
      id: 'arbitrageur',
      name: 'Relentless March',
      description: 'Gain $100 whenever any player goes bankrupt. Rebuild cost -30%.',
    },
    color: '#1565c0',
  },
  {
    id: 'julius-caesar',
    name: 'Julius Caesar',
    title: 'Dictator Perpetuo',
    stats: { capital: 7, luck: 5, negotiation: 7, charisma: 7, tech: 3, stamina: 5 },
    passive: {
      id: 'arbitrageur',
      name: 'Spoils of Conquest',
      description: 'Gain $100 whenever any player goes bankrupt. Rebuild cost -30%.',
    },
    color: '#b71c1c',
  },
  {
    id: 'mansa-musa',
    name: 'Mansa Musa',
    title: 'Lord of the Gold',
    stats: { capital: 10, luck: 5, negotiation: 6, charisma: 6, tech: 3, stamina: 4 },
    passive: {
      id: 'idealist',
      name: 'Golden Pilgrimage',
      description: 'Gain +$50 each time you pass GO (stacks with the $200 salary).',
    },
    color: '#fbc02d',
  },
  {
    id: 'suleiman',
    name: 'Suleiman the Magnificent',
    title: 'The Magnificent',
    stats: { capital: 8, luck: 4, negotiation: 7, charisma: 6, tech: 5, stamina: 4 },
    passive: {
      id: 'pioneer',
      name: 'Imperial Patronage',
      description: 'Property upgrade cost -20%, funding grand construction.',
    },
    color: '#2e7d32',
  },
  {
    id: 'genghis-khan',
    name: 'Genghis Khan',
    title: 'The Great Khan',
    stats: { capital: 6, luck: 6, negotiation: 4, charisma: 6, tech: 4, stamina: 8 },
    passive: {
      id: 'enforcer',
      name: 'Steppe Tribute',
      description: 'Designate one owned property as regulated; opponents pay +20% rent there.',
    },
    color: '#5d4037',
  },
  {
    id: 'taejo',
    name: 'Taejo of Joseon',
    title: 'Dynasty-Founder',
    stats: { capital: 5, luck: 4, negotiation: 5, charisma: 6, tech: 9, stamina: 5 },
    passive: {
      id: 'speculator',
      name: 'Founding Mandate',
      description: 'Re-draw an event card you do not like. Negative event duration -1 turn.',
    },
    color: '#0277bd',
  },
  {
    id: 'tokugawa-ieyasu',
    name: 'Tokugawa Ieyasu',
    title: 'The Patient Shogun',
    stats: { capital: 7, luck: 4, negotiation: 6, charisma: 4, tech: 5, stamina: 8 },
    passive: {
      id: 'financier',
      name: 'Sakoku Reserves',
      description: 'Financial negative-event losses -20%, shielded by deep reserves. Property purchase price -10%.',
    },
    color: '#37474f',
  },
  {
    id: 'pachacuti',
    name: 'Pachacuti',
    title: 'Earth-Shaker',
    stats: { capital: 6, luck: 4, negotiation: 5, charisma: 5, tech: 8, stamina: 6 },
    passive: {
      id: 'pioneer',
      name: 'Terraced Engineering',
      description: 'Property upgrade cost -20%, reflecting Andean megabuilding.',
    },
    color: '#f57f17',
  },
  {
    id: 'moctezuma-i',
    name: 'Moctezuma I',
    title: 'Tribute-Master',
    stats: { capital: 8, luck: 3, negotiation: 6, charisma: 5, tech: 5, stamina: 7 },
    passive: {
      id: 'enforcer',
      name: 'Flower Tribute',
      description: 'Designate one owned property as regulated; opponents pay +20% rent there.',
    },
    color: '#00695c',
  },
  {
    id: 'moshoeshoe-i',
    name: 'Moshoeshoe I',
    title: 'The Mountain King',
    stats: { capital: 4, luck: 5, negotiation: 9, charisma: 8, tech: 3, stamina: 5 },
    passive: {
      id: 'breaker',
      name: 'Diplomacy of the Blanket',
      description: "Reduce rent you pay on opponents' monopoly properties by 25%.",
    },
    color: '#6a1b9a',
  },
  {
    id: 'cleopatra-vii',
    name: 'Cleopatra VII',
    title: 'The Last Pharaoh',
    stats: { capital: 7, luck: 5, negotiation: 9, charisma: 8, tech: 3, stamina: 2 },
    passive: {
      id: 'breaker',
      name: 'Diplomatic Mastery',
      description: "Reduce rent you pay on opponents' monopoly properties by 25%, won through shrewd negotiation.",
    },
    color: '#ffd54f',
  },
];

export function getCharacterById(id) {
  return CHARACTERS_DATA.find(c => c.id === id);
}

export function getStartingMoney(character) {
  return RULES.core.baseStartingMoney + character.stats.capital * RULES.stats.capital.startingMoneyBonus;
}
