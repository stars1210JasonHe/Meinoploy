import fs from 'fs';
import path from 'path';
import { expandFacts } from '../createmod/smart/index';
import { validateModInput } from '../createmod/validate';
import { loadWorld } from '../world-loader';
import { loadMap } from '../map-loader';
import { ARCHETYPES } from '../../mods/dominion/atlas/archetypes';
import { CHANCE_CARDS, COMMUNITY_CARDS } from '../../mods/dominion/cards';

const OPTS = { ARCHETYPES, reusedCards: { chance: CHANCE_CARDS, community: COMMUNITY_CARDS } };
const read = f => JSON.parse(fs.readFileSync(path.join(__dirname, '../../examples/create-mod', f), 'utf8'));

describe('smart-builder integration (pure pipeline)', () => {
  test('silk-road atlas facts -> expandFacts -> validateModInput ok -> loadWorld loads', () => {
    const facts = read('silk-road.facts.json');
    // facts carry no topology — all derived
    facts.world.places.forEach(p => {
      expect(p.connectors).toBeUndefined();
    });
    expect(facts.world.hubs).toBeUndefined();
    const input = expandFacts(facts, { ARCHETYPES });
    const r = validateModInput(input, OPTS);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(() => loadWorld(r.normalized.world, ARCHETYPES)).not.toThrow();
  });

  test('gilded-rails classic facts -> expandFacts -> validateModInput ok -> loadMap loads', () => {
    const input = expandFacts(read('gilded-rails.facts.json'), { ARCHETYPES });
    const r = validateModInput(input, OPTS);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(() => loadMap(r.normalized.map)).not.toThrow();
  });

  test('same facts file expands identically twice (byte determinism)', () => {
    const a = expandFacts(read('silk-road.facts.json'), { ARCHETYPES });
    const b = expandFacts(read('silk-road.facts.json'), { ARCHETYPES });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
