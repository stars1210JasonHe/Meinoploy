// Meinopoly prototype data — plain JS globals (no Babel)
// Mirrors the real Dominion mod data.

const BOARD_SPACES = [
  { id: 0,  name: 'GO',                type: 'go',        group: null,    price: 0,   rent: 0 },
  { id: 1,  name: 'Mediterranean Ave', type: 'property',  group: 'brown', price: 60,  rent: 4 },
  { id: 2,  name: 'Community Chest',   type: 'community', group: null,    price: 0,   rent: 0 },
  { id: 3,  name: 'Baltic Ave',        type: 'property',  group: 'brown', price: 60,  rent: 8 },
  { id: 4,  name: 'Income Tax',        type: 'tax',       group: null,    price: 0,   rent: 200 },
  { id: 5,  name: 'Reading Railroad',  type: 'railroad',  group: null,    price: 200, rent: 25 },
  { id: 6,  name: 'Oriental Ave',      type: 'property',  group: 'cyan',  price: 100, rent: 12 },
  { id: 7,  name: 'Chance',            type: 'chance',    group: null,    price: 0,   rent: 0 },
  { id: 8,  name: 'Vermont Ave',       type: 'property',  group: 'cyan',  price: 100, rent: 12 },
  { id: 9,  name: 'Connecticut Ave',   type: 'property',  group: 'cyan',  price: 120, rent: 16 },
  { id: 10, name: 'Just Visiting',     type: 'jail',      group: null,    price: 0,   rent: 0 },
  { id: 11, name: 'St. Charles Place', type: 'property',  group: 'pink',  price: 140, rent: 20 },
  { id: 12, name: 'Electric Company',  type: 'utility',   group: null,    price: 150, rent: 0 },
  { id: 13, name: 'States Ave',        type: 'property',  group: 'pink',  price: 140, rent: 20 },
  { id: 14, name: 'Virginia Ave',      type: 'property',  group: 'pink',  price: 160, rent: 24 },
  { id: 15, name: 'Pennsylvania RR',   type: 'railroad',  group: null,    price: 200, rent: 25 },
  { id: 16, name: 'St. James Place',   type: 'property',  group: 'orange',price: 180, rent: 28 },
  { id: 17, name: 'Community Chest',   type: 'community', group: null,    price: 0,   rent: 0 },
  { id: 18, name: 'Tennessee Ave',     type: 'property',  group: 'orange',price: 180, rent: 28 },
  { id: 19, name: 'New York Ave',      type: 'property',  group: 'orange',price: 200, rent: 32 },
  { id: 20, name: 'Free Parking',      type: 'parking',   group: null,    price: 0,   rent: 0 },
  { id: 21, name: 'Kentucky Ave',      type: 'property',  group: 'red',   price: 220, rent: 36 },
  { id: 22, name: 'Chance',            type: 'chance',    group: null,    price: 0,   rent: 0 },
  { id: 23, name: 'Indiana Ave',       type: 'property',  group: 'red',   price: 220, rent: 36 },
  { id: 24, name: 'Illinois Ave',      type: 'property',  group: 'red',   price: 240, rent: 40 },
  { id: 25, name: 'B&O Railroad',      type: 'railroad',  group: null,    price: 200, rent: 25 },
  { id: 26, name: 'Atlantic Ave',      type: 'property',  group: 'yellow',price: 260, rent: 44 },
  { id: 27, name: 'Ventnor Ave',       type: 'property',  group: 'yellow',price: 260, rent: 44 },
  { id: 28, name: 'Water Works',       type: 'utility',   group: null,    price: 150, rent: 0 },
  { id: 29, name: 'Marvin Gardens',    type: 'property',  group: 'yellow',price: 280, rent: 48 },
  { id: 30, name: 'Go To Jail',        type: 'goToJail',  group: null,    price: 0,   rent: 0 },
  { id: 31, name: 'Pacific Ave',       type: 'property',  group: 'green', price: 300, rent: 52 },
  { id: 32, name: 'North Carolina Ave',type: 'property',  group: 'green', price: 300, rent: 52 },
  { id: 33, name: 'Community Chest',   type: 'community', group: null,    price: 0,   rent: 0 },
  { id: 34, name: 'Pennsylvania Ave',  type: 'property',  group: 'green', price: 320, rent: 56 },
  { id: 35, name: 'Short Line',        type: 'railroad',  group: null,    price: 200, rent: 25 },
  { id: 36, name: 'Chance',            type: 'chance',    group: null,    price: 0,   rent: 0 },
  { id: 37, name: 'Park Place',        type: 'property',  group: 'blue',  price: 350, rent: 70 },
  { id: 38, name: 'Luxury Tax',        type: 'tax',       group: null,    price: 0,   rent: 100 },
  { id: 39, name: 'Boardwalk',         type: 'property',  group: 'blue',  price: 400, rent: 100 },
];

// Group display colors (vivid, pixel-friendly)
const GROUP_COLORS = {
  brown:  '#8a5a2b',
  cyan:   '#5cc6e8',
  pink:   '#e85ca8',
  orange: '#ef9223',
  red:    '#e23b3b',
  yellow: '#f2d029',
  green:  '#36b15a',
  blue:   '#3b62e2',
};

const CHARACTERS = [
  { id:'albert-victor', name:'Albert Victor', title:'Council Financier',
    stats:{capital:9,luck:4,negotiation:8,charisma:6,tech:5,stamina:4},
    passiveName:'Financial Expertise',
    passive:'Property purchase price -10%. Financial negative event losses -20%.',
    money:1950, color:'#c9a44a' },
  { id:'lia-startrace', name:'Lia Startrace', title:'Interstellar Pioneer',
    stats:{capital:5,luck:8,negotiation:4,charisma:5,tech:9,stamina:6},
    passiveName:'Tech Pioneer',
    passive:'Property upgrade cost -20%. Disaster event trigger rate +10%.',
    money:1750, color:'#5ba3cf' },
  { id:'marcus-grayline', name:'Marcus Grayline', title:'Political Operator',
    stats:{capital:6,luck:4,negotiation:7,charisma:9,tech:4,stamina:5},
    passiveName:'Political Influence',
    passive:'Alliance income share +10%. Voting phase +1 influence.',
    money:1800, color:'#7a5c8a' },
  { id:'evelyn-zero', name:'Evelyn Zero', title:'Probability Speculator',
    stats:{capital:4,luck:10,negotiation:3,charisma:6,tech:5,stamina:6},
    passiveName:'Lucky Draw',
    passive:'Can re-draw event cards once per game. Negative event duration -1 turn.',
    money:1700, color:'#d4af37' },
  { id:'knox-ironlaw', name:'Knox Ironlaw', title:'Order Enforcer',
    stats:{capital:7,luck:3,negotiation:6,charisma:4,tech:6,stamina:6},
    passiveName:'Regulation',
    passive:'Can set "regulated" status on one property. Opponents pay +20% rent there.',
    money:1850, color:'#9a9a9a' },
  { id:'sophia-ember', name:'Sophia Ember', title:'Crisis Arbitrageur',
    stats:{capital:5,luck:6,negotiation:5,charisma:5,tech:4,stamina:8},
    passiveName:'Crisis Profit',
    passive:'Gain $100 when any player goes bankrupt. Rebuild cost -30%.',
    money:1750, color:'#cf5b5b' },
  { id:'cassian-echo', name:'Cassian Echo', title:'Information Merchant',
    stats:{capital:6,luck:5,negotiation:6,charisma:6,tech:6,stamina:5},
    passiveName:'Intel Network',
    passive:'Can preview next event card before drawing. Can hide assets during trade.',
    money:1800, color:'#4a9e7a' },
  { id:'mira-dawnlight', name:'Mira Dawnlight', title:'Idealist Council Member',
    stats:{capital:4,luck:6,negotiation:5,charisma:8,tech:5,stamina:6},
    passiveName:'Growth Vision',
    passive:'Gain +$50 bonus each time passing GO (stacks with $200).',
    money:1700, color:'#e8a0bf' },
  { id:'renn-chainbreaker', name:'Renn Chainbreaker', title:'Rule Breaker',
    stats:{capital:5,luck:5,negotiation:4,charisma:6,tech:7,stamina:7},
    passiveName:'Anti-Monopoly',
    passive:'Reduce rent on monopoly (full color set) properties by 25%.',
    money:1750, color:'#cf8f4a' },
  { id:'ophelia-nightveil', name:'Ophelia Nightveil', title:'Shadow Council Member',
    stats:{capital:6,luck:7,negotiation:5,charisma:7,tech:3,stamina:6},
    passiveName:'Shadow Veil',
    passive:'Hide true money amount from other players. Can trigger hidden victory.',
    money:1800, color:'#9a86c4' },
];

const STAT_KEYS = [
  { key:'capital', label:'CAP' },
  { key:'luck', label:'LCK' },
  { key:'negotiation', label:'NEG' },
  { key:'charisma', label:'CHA' },
  { key:'tech', label:'TEC' },
  { key:'stamina', label:'STA' },
];

const CHANCE_CARDS = [
  { text:'Advance to GO! Collect $200.', kind:'good' },
  { text:'Advance to Illinois Ave.', kind:'neutral' },
  { text:'Bank pays you dividend of $50.', kind:'good' },
  { text:'Go to Jail. Do not pass GO.', kind:'bad' },
  { text:'Black Swan Event! Pay 10% of total assets.', kind:'bad' },
  { text:'Market Boom! Collect $50 per property owned.', kind:'good' },
  { text:'Tech Breakthrough! Free upgrade on a property.', kind:'good' },
  { text:'Hostile Takeover! Force-buy a rival property at 150%.', kind:'neutral' },
  { text:'Stimulus Package! All players receive $100.', kind:'good' },
];

const COMMUNITY_CARDS = [
  { text:'Bank error in your favor. Collect $200.', kind:'good' },
  { text:'Income tax refund. Collect $20.', kind:'good' },
  { text:'Tax Audit! Pay 15% of total assets.', kind:'bad' },
  { text:'Market Crash! Best building loses 1 level.', kind:'bad' },
  { text:'Infrastructure Grant! Free upgrade on a property.', kind:'good' },
  { text:'Community Fund! All players receive $50.', kind:'good' },
];

const SEASONS = ['Summer', 'Autumn', 'Winter', 'Spring'];

// Palette variations (compare via Tweaks)
const PALETTES = {
  council: {
    bg: '#0e1120', bg2: '#1b2034', bg3: '#0a0c17', ink: '#f2e9cf', inkDim: '#9298b6',
    accent: '#e9b23c', accent2: '#6f7cd6', line: '#39406a', good: '#5ad98a', bad: '#e2574f',
  },
  verdant: {
    bg: '#0c2410', bg2: '#16401c', bg3: '#081a0b', ink: '#c4e86a', inkDim: '#6f9a3f',
    accent: '#a9d637', accent2: '#5fae54', line: '#2f5e2c', good: '#bdee5a', bad: '#e0b24a',
  },
  arcade: {
    bg: '#0a0a16', bg2: '#16162e', bg3: '#06060f', ink: '#eaeaff', inkDim: '#8a8ac0',
    accent: '#ff4d8d', accent2: '#36d6e7', line: '#34346a', good: '#48e89a', bad: '#ff5470',
  },
};

// Board grid mapping for an 11x11 grid (row/col 1-indexed for CSS grid)
function boardGridPos(id) {
  if (id === 0)  return { r: 11, c: 11 };            // GO (bottom-right)
  if (id <= 9)   return { r: 11, c: 11 - id };       // bottom row
  if (id === 10) return { r: 11, c: 1 };             // Jail (bottom-left)
  if (id <= 19)  return { r: 11 - (id - 10), c: 1 }; // left col
  if (id === 20) return { r: 1, c: 1 };              // Free Parking (top-left)
  if (id <= 29)  return { r: 1, c: 1 + (id - 20) };  // top row
  if (id === 30) return { r: 1, c: 11 };             // Go To Jail (top-right)
  return { r: 1 + (id - 30), c: 11 };                // right col
}

// Which edge a tile sits on (for color-bar orientation)
function boardEdge(id) {
  if (id === 0 || id === 10 || id === 20 || id === 30) return 'corner';
  if (id < 10)  return 'bottom';
  if (id < 20)  return 'left';
  if (id < 30)  return 'top';
  return 'right';
}

const PORTRAIT = (id) => `portraits/${id.split('-').map(s=>s[0].toUpperCase()+s.slice(1)).join('-')}.png`;

Object.assign(window, {
  BOARD_SPACES, GROUP_COLORS, CHARACTERS, STAT_KEYS,
  CHANCE_CARDS, COMMUNITY_CARDS, SEASONS, PALETTES,
  boardGridPos, boardEdge, PORTRAIT,
});
