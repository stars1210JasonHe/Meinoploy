// Dominion Mod — Board layout (40 spaces, classic Monopoly map)

export const BOARD_SPACES = [
  { id: 0,  name: 'GO',                  type: 'go',         color: null,       price: 0,   rent: 0 },
  { id: 1,  name: 'Mediterranean Ave',   type: 'property',   color: '#8B4513',  price: 60,  rent: 4 },
  { id: 2,  name: 'Community Chest',     type: 'community',  color: null,       price: 0,   rent: 0 },
  { id: 3,  name: 'Baltic Ave',          type: 'property',   color: '#8B4513',  price: 60,  rent: 8 },
  { id: 4,  name: 'Income Tax',          type: 'tax',        color: null,       price: 0,   rent: 200 },
  { id: 5,  name: 'Reading Railroad',    type: 'railroad',   color: null,       price: 200, rent: 25 },
  { id: 6,  name: 'Oriental Ave',        type: 'property',   color: '#87CEEB',  price: 100, rent: 12 },
  { id: 7,  name: 'Chance',              type: 'chance',     color: null,       price: 0,   rent: 0 },
  { id: 8,  name: 'Vermont Ave',         type: 'property',   color: '#87CEEB',  price: 100, rent: 12 },
  { id: 9,  name: 'Connecticut Ave',     type: 'property',   color: '#87CEEB',  price: 120, rent: 16 },
  { id: 10, name: 'Just Visiting',       type: 'jail',       color: null,       price: 0,   rent: 0 },
  { id: 11, name: 'St. Charles Place',   type: 'property',   color: '#FF69B4',  price: 140, rent: 20 },
  { id: 12, name: 'Electric Company',    type: 'utility',    color: null,       price: 150, rent: 0 },
  { id: 13, name: 'States Ave',          type: 'property',   color: '#FF69B4',  price: 140, rent: 20 },
  { id: 14, name: 'Virginia Ave',        type: 'property',   color: '#FF69B4',  price: 160, rent: 24 },
  { id: 15, name: 'Pennsylvania RR',     type: 'railroad',   color: null,       price: 200, rent: 25 },
  { id: 16, name: 'St. James Place',     type: 'property',   color: '#FFA500',  price: 180, rent: 28 },
  { id: 17, name: 'Community Chest',     type: 'community',  color: null,       price: 0,   rent: 0 },
  { id: 18, name: 'Tennessee Ave',       type: 'property',   color: '#FFA500',  price: 180, rent: 28 },
  { id: 19, name: 'New York Ave',        type: 'property',   color: '#FFA500',  price: 200, rent: 32 },
  { id: 20, name: 'Free Parking',        type: 'parking',    color: null,       price: 0,   rent: 0 },
  { id: 21, name: 'Kentucky Ave',        type: 'property',   color: '#FF0000',  price: 220, rent: 36 },
  { id: 22, name: 'Chance',              type: 'chance',     color: null,       price: 0,   rent: 0 },
  { id: 23, name: 'Indiana Ave',         type: 'property',   color: '#FF0000',  price: 220, rent: 36 },
  { id: 24, name: 'Illinois Ave',        type: 'property',   color: '#FF0000',  price: 240, rent: 40 },
  { id: 25, name: 'B&O Railroad',        type: 'railroad',   color: null,       price: 200, rent: 25 },
  { id: 26, name: 'Atlantic Ave',        type: 'property',   color: '#FFFF00',  price: 260, rent: 44 },
  { id: 27, name: 'Ventnor Ave',         type: 'property',   color: '#FFFF00',  price: 260, rent: 44 },
  { id: 28, name: 'Water Works',         type: 'utility',    color: null,       price: 150, rent: 0 },
  { id: 29, name: 'Marvin Gardens',      type: 'property',   color: '#FFFF00',  price: 280, rent: 48 },
  { id: 30, name: 'Go To Jail',          type: 'goToJail',   color: null,       price: 0,   rent: 0 },
  { id: 31, name: 'Pacific Ave',         type: 'property',   color: '#00AA00',  price: 300, rent: 52 },
  { id: 32, name: 'North Carolina Ave',  type: 'property',   color: '#00AA00',  price: 300, rent: 52 },
  { id: 33, name: 'Community Chest',     type: 'community',  color: null,       price: 0,   rent: 0 },
  { id: 34, name: 'Pennsylvania Ave',    type: 'property',   color: '#00AA00',  price: 320, rent: 56 },
  { id: 35, name: 'Short Line',          type: 'railroad',   color: null,       price: 200, rent: 25 },
  { id: 36, name: 'Chance',              type: 'chance',     color: null,       price: 0,   rent: 0 },
  { id: 37, name: 'Park Place',          type: 'property',   color: '#0000CC',  price: 350, rent: 70 },
  { id: 38, name: 'Luxury Tax',          type: 'tax',        color: null,       price: 0,   rent: 100 },
  { id: 39, name: 'Boardwalk',           type: 'property',   color: '#0000CC',  price: 400, rent: 100 },
];

// Color groups: maps color hex to array of space IDs in that group
export const COLOR_GROUPS = {
  '#8B4513': [1, 3],          // Brown
  '#87CEEB': [6, 8, 9],      // Light Blue
  '#FF69B4': [11, 13, 14],   // Pink
  '#FFA500': [16, 18, 19],   // Orange
  '#FF0000': [21, 23, 24],   // Red
  '#FFFF00': [26, 27, 29],   // Yellow
  '#00AA00': [31, 32, 34],   // Green
  '#0000CC': [37, 39],       // Dark Blue
};
