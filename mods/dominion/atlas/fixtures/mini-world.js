// Minimal VALID atlas world used by unit tests. Layout (entry->exit chains, connectors -> edges):
//   rome(capital-hub, HUB) -> paris(downtown) -> berlin(port) -> rome   (main loop)
//   paris -> geneva(market) -> rome                                     (branch)
export var MINI_WORLD = {
  id: 'mini', name: 'Mini World', story: 'test fixture', movementMode: 'atlas',
  schemaVersion: '3.0-draft',
  places: [
    { id: 'rome',   archetypes: ['capital-hub'], realName: 'Rome',
      pos: { x: 50, y: 80 }, data: { population: 2800000, gdp: 160000, fame: 90 },
      connectors: { n: 'paris' }, isHub: true },
    { id: 'paris',  archetypes: ['downtown'], realName: 'Paris',
      pos: { x: 30, y: 40 }, data: { population: 2100000, gdp: 220000, fame: 95 },
      connectors: { e: 'berlin', s: 'geneva' } },
    { id: 'berlin', archetypes: ['port'], realName: 'Berlin',
      pos: { x: 70, y: 20 }, data: { population: 3600000, gdp: 180000, fame: 80 },
      connectors: { s: 'rome' } },
    { id: 'geneva', archetypes: ['market'], realName: 'Geneva',
      pos: { x: 55, y: 55 }, data: { population: 200000, gdp: 50000, fame: 60 },
      connectors: { e: 'rome' } },
  ],
  hubs: ['rome'],
  winPaths: ['wealth', 'dominion'],
  size: { maxPlaces: 16, maxSpaces: 96 },
};
