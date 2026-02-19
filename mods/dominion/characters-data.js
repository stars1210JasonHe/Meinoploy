// Dominion Mod — Character data (server-safe, no portrait imports)
// Stats: Capital, Luck, Negotiation, Charisma, Tech, Stamina (range 1-10)

import { RULES } from './rules';

export const CHARACTERS_DATA = [
  {
    id: 'albert-victor',
    name: 'Albert Victor',
    title: 'Council Financier',
    stats: { capital: 9, luck: 4, negotiation: 8, charisma: 6, tech: 5, stamina: 4 },
    passive: {
      id: 'financier',
      name: 'Financial Expertise',
      description: 'Property purchase price -10%. Financial negative event losses -20%.',
    },
    color: '#c9a44a',
  },
  {
    id: 'lia-startrace',
    name: 'Lia Startrace',
    title: 'Interstellar Pioneer',
    stats: { capital: 5, luck: 8, negotiation: 4, charisma: 5, tech: 9, stamina: 6 },
    passive: {
      id: 'pioneer',
      name: 'Tech Pioneer',
      description: 'Property upgrade cost -20%. Disaster event trigger rate +10%.',
    },
    color: '#5ba3cf',
  },
  {
    id: 'marcus-grayline',
    name: 'Marcus Grayline',
    title: 'Political Operator',
    stats: { capital: 6, luck: 4, negotiation: 7, charisma: 9, tech: 4, stamina: 5 },
    passive: {
      id: 'operator',
      name: 'Political Influence',
      description: 'Alliance income share +10%. Voting phase +1 influence.',
    },
    color: '#7a5c8a',
  },
  {
    id: 'evelyn-zero',
    name: 'Evelyn Zero',
    title: 'Probability Speculator',
    stats: { capital: 4, luck: 10, negotiation: 3, charisma: 6, tech: 5, stamina: 6 },
    passive: {
      id: 'speculator',
      name: 'Lucky Draw',
      description: 'Can re-draw event cards once per game. Negative event duration -1 turn.',
    },
    color: '#d4af37',
  },
  {
    id: 'knox-ironlaw',
    name: 'Knox Ironlaw',
    title: 'Order Enforcer',
    stats: { capital: 7, luck: 3, negotiation: 6, charisma: 4, tech: 6, stamina: 6 },
    passive: {
      id: 'enforcer',
      name: 'Regulation',
      description: 'Can set "regulated" status on one property. Opponents pay +20% rent there.',
    },
    color: '#8b8b8b',
  },
  {
    id: 'sophia-ember',
    name: 'Sophia Ember',
    title: 'Crisis Arbitrageur',
    stats: { capital: 5, luck: 6, negotiation: 5, charisma: 5, tech: 4, stamina: 8 },
    passive: {
      id: 'arbitrageur',
      name: 'Crisis Profit',
      description: 'Gain $100 when any player goes bankrupt. Rebuild cost -30%.',
    },
    color: '#cf5b5b',
  },
  {
    id: 'cassian-echo',
    name: 'Cassian Echo',
    title: 'Information Merchant',
    stats: { capital: 6, luck: 5, negotiation: 6, charisma: 6, tech: 6, stamina: 5 },
    passive: {
      id: 'merchant',
      name: 'Intel Network',
      description: 'Can preview next event card before drawing. Can hide assets during trade.',
    },
    color: '#4a9e7a',
  },
  {
    id: 'mira-dawnlight',
    name: 'Mira Dawnlight',
    title: 'Idealist Council Member',
    stats: { capital: 4, luck: 6, negotiation: 5, charisma: 8, tech: 5, stamina: 6 },
    passive: {
      id: 'idealist',
      name: 'Growth Vision',
      description: 'Gain +$50 bonus each time passing GO (stacks with $200).',
    },
    color: '#e8a0bf',
  },
  {
    id: 'renn-chainbreaker',
    name: 'Renn Chainbreaker',
    title: 'Rule Breaker',
    stats: { capital: 5, luck: 5, negotiation: 4, charisma: 6, tech: 7, stamina: 7 },
    passive: {
      id: 'breaker',
      name: 'Anti-Monopoly',
      description: 'Reduce rent on monopoly (full color set) properties by 25%.',
    },
    color: '#cf8f4a',
  },
  {
    id: 'ophelia-nightveil',
    name: 'Ophelia Nightveil',
    title: 'Shadow Council Member',
    stats: { capital: 6, luck: 7, negotiation: 5, charisma: 7, tech: 3, stamina: 6 },
    passive: {
      id: 'shadow',
      name: 'Shadow Veil',
      description: 'Hide true money amount from other players. Can trigger hidden victory.',
    },
    color: '#3d3d5c',
  },
];

export function getCharacterById(id) {
  return CHARACTERS_DATA.find(c => c.id === id);
}

export function getStartingMoney(character) {
  return RULES.core.baseStartingMoney + character.stats.capital * RULES.stats.capital.startingMoneyBonus;
}
