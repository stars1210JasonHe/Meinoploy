import { validateWorld, loadWorld } from '../world-loader';
import { ARCHETYPES } from '../../mods/dominion/atlas/archetypes';
import { TERRA_CIRCUIT } from '../../mods/dominion/atlas/worlds/terra-circuit';

describe('Terra Circuit world', () => {
  test('passes validateWorld with zero errors', () => {
    expect(validateWorld(TERRA_CIRCUIT, ARCHETYPES)).toEqual([]);
  });

  test('loadWorld produces a playable atlas mapData', () => {
    const md = loadWorld(TERRA_CIRCUIT, ARCHETYPES);
    expect(md.movementMode).toBe('atlas');
    expect(md.layoutType).toBe('custom');
    expect(md.spaceCount).toBe(21);            // 7 places x 3 slots
    expect(md.hubs.length).toBe(2);            // tokyo + newyork entries
    expect(Object.keys(md.placeGroups).length).toBe(7); // all 7 places buildable (>=2 property slots)
    expect(md.victory.primary).toBe('dominion');
    expect(md.victory.params.groupsToWin).toBe(3);
    // every space has a position for rendering
    for (let i = 0; i < md.spaceCount; i++) expect(md.positions[i]).toBeDefined();
    // the fork: singapore's exit has 2 outgoing edges
    const singaporeExit = md.exits['singapore'];
    expect(md.edges[singaporeExit].length).toBe(2);
  });

  test('no place exceeds the default value-share cap (no atlasConfig loosening needed)', () => {
    // If this fails, the world concentrates >35% of property value in one place;
    // fix by rebalancing data, NOT by raising valueShareCap.
    expect(validateWorld(TERRA_CIRCUIT, ARCHETYPES)).toEqual([]);
  });
});
