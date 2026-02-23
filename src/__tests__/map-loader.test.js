import { validateMap, loadMap, getGridDimensions, positionsToGrid } from '../map-loader';
import classicMap from '../../mods/dominion/maps/classic/map.json';
import stuttgartMap from '../../mods/dominion/maps/stuttgart-fracture-loop/map.json';
import outerRimMap from '../../mods/dominion/maps/outer-rim-station/map.json';
import nightveilMap from '../../mods/dominion/maps/nightveil-intrigue/map.json';

describe('Map Loader', () => {
  // ── Validation ──────────────────────────────────────

  describe('validateMap', () => {
    it('validates the classic 40-space map with no errors', () => {
      const errors = validateMap(classicMap);
      expect(errors).toEqual([]);
    });

    it('validates the Stuttgart 28-space circle map with no errors', () => {
      const errors = validateMap(stuttgartMap);
      expect(errors).toEqual([]);
    });

    it('validates the Outer Rim 30-space hexagon map with no errors', () => {
      const errors = validateMap(outerRimMap);
      expect(errors).toEqual([]);
    });

    it('validates the Nightveil 26-space custom map with no errors', () => {
      const errors = validateMap(nightveilMap);
      expect(errors).toEqual([]);
    });

    it('rejects missing id', () => {
      const bad = { ...classicMap, id: '' };
      expect(validateMap(bad)).toContainEqual(expect.stringContaining('id is required'));
    });

    it('rejects spaceCount < 10', () => {
      const bad = { ...classicMap, spaceCount: 5 };
      expect(validateMap(bad)).toContainEqual(expect.stringContaining('spaceCount must be >= 10'));
    });

    it('rejects mismatched spaces.length and spaceCount', () => {
      const bad = { ...classicMap, spaceCount: 20 };
      expect(validateMap(bad)).toContainEqual(expect.stringContaining('must equal spaceCount'));
    });

    it('rejects invalid layout type', () => {
      const bad = { ...classicMap, layout: { type: 'triangle' } };
      expect(validateMap(bad)).toContainEqual(expect.stringContaining('layout.type must be one of'));
    });

    it('rejects custom layout without positions', () => {
      const bad = { ...classicMap, layout: { type: 'custom' } };
      expect(validateMap(bad)).toContainEqual(expect.stringContaining('positions is required for custom'));
    });

    it('rejects property without color', () => {
      const spaces = classicMap.spaces.map(s => ({ ...s }));
      spaces[1] = { ...spaces[1], color: null };
      const bad = { ...classicMap, spaces };
      expect(validateMap(bad)).toContainEqual(expect.stringContaining('property must have color'));
    });

    it('rejects property without price', () => {
      const spaces = classicMap.spaces.map(s => ({ ...s }));
      spaces[1] = { ...spaces[1], price: 0 };
      const bad = { ...classicMap, spaces };
      expect(validateMap(bad)).toContainEqual(expect.stringContaining('price > 0'));
    });

    it('rejects tax without taxAmount', () => {
      const spaces = classicMap.spaces.map(s => ({ ...s }));
      spaces[4] = { ...spaces[4], taxAmount: undefined };
      const bad = { ...classicMap, spaces };
      expect(validateMap(bad)).toContainEqual(expect.stringContaining('taxAmount > 0'));
    });

    it('rejects color group with < 2 spaces', () => {
      const bad = {
        ...classicMap,
        colorGroups: {
          ...classicMap.colorGroups,
          '#FF00FF': { name: 'Solo', spaces: [1] },
        },
      };
      expect(validateMap(bad)).toContainEqual(expect.stringContaining('must have >= 2 spaces'));
    });

    it('rejects color group space with mismatched color', () => {
      const bad = {
        ...classicMap,
        colorGroups: {
          ...classicMap.colorGroups,
          '#FF00FF': { name: 'Fake', spaces: [1, 3] }, // spaces 1,3 are brown #8B4513
        },
      };
      expect(validateMap(bad)).toContainEqual(expect.stringContaining('has color'));
    });

    it('rejects invalid card action', () => {
      const bad = {
        ...classicMap,
        cards: {
          ...classicMap.cards,
          chance: [{ text: 'Bad', action: 'explode', value: 0 }],
        },
      };
      expect(validateMap(bad)).toContainEqual(expect.stringContaining('invalid action'));
    });

    it('rejects moveTo card with out-of-range space ID', () => {
      const bad = {
        ...classicMap,
        cards: {
          ...classicMap.cards,
          chance: [{ text: 'Go far', action: 'moveTo', value: 99 }],
        },
      };
      expect(validateMap(bad)).toContainEqual(expect.stringContaining('out of range'));
    });

    it('rejects missing theme', () => {
      const bad = { ...classicMap, theme: null };
      expect(validateMap(bad)).toContainEqual(expect.stringContaining('theme is required'));
    });

    it('rejects specialSpaces.go pointing to wrong type', () => {
      const bad = {
        ...classicMap,
        specialSpaces: { ...classicMap.specialSpaces, go: 1 }, // space 1 is property
      };
      expect(validateMap(bad)).toContainEqual(expect.stringContaining('must reference a space with type "go"'));
    });

    it('rejects specialSpaces.jail pointing to wrong type', () => {
      const bad = {
        ...classicMap,
        specialSpaces: { ...classicMap.specialSpaces, jail: 0 },
      };
      expect(validateMap(bad)).toContainEqual(expect.stringContaining('must reference a space with type "jail"'));
    });
  });

  // ── Loading ─────────────────────────────────────────

  describe('loadMap', () => {
    it('loads the classic map successfully', () => {
      const map = loadMap(classicMap);
      expect(map.id).toBe('classic');
      expect(map.name).toBe('Council District');
      expect(map.spaceCount).toBe(40);
      expect(map.layoutType).toBe('square');
    });

    it('generates positions for square layout', () => {
      const map = loadMap(classicMap);
      expect(map.positions).toBeDefined();
      expect(Object.keys(map.positions).length).toBe(40);
      // Space 0 should be at bottom-right
      expect(map.positions[0].x).toBe(100);
      expect(map.positions[0].y).toBe(100);
    });

    it('provides engine-compatible board data', () => {
      const map = loadMap(classicMap);
      expect(map.spaces).toHaveLength(40);
      expect(map.spaces[0].type).toBe('go');
      expect(map.spaces[1].type).toBe('property');
      expect(map.spaces[1].color).toBe('#8B4513');
      expect(map.spaces[1].price).toBe(60);
    });

    it('resolves icons for spaces', () => {
      const map = loadMap(classicMap);
      expect(map.spaces[0].icon).toBeTruthy(); // GO has icon
      expect(map.spaces[7].icon).toBeTruthy(); // Chance has icon
    });

    it('provides flat color groups for engine', () => {
      const map = loadMap(classicMap);
      expect(map.colorGroupsFlat['#8B4513']).toEqual([1, 3]);
      expect(map.colorGroupsFlat['#87CEEB']).toEqual([6, 8, 9]);
    });

    it('identifies corner/special space IDs', () => {
      const map = loadMap(classicMap);
      expect(map.cornerIds).toContain(0);
      expect(map.cornerIds).toContain(10);
      expect(map.cornerIds).toContain(20);
      expect(map.cornerIds).toContain(30);
    });

    it('provides cards', () => {
      const map = loadMap(classicMap);
      expect(map.chanceCards.length).toBeGreaterThan(0);
      expect(map.communityCards.length).toBeGreaterThan(0);
    });

    it('provides theme with defaults', () => {
      const map = loadMap(classicMap);
      expect(map.theme.boardBackground).toBe('#2d5016');
      expect(map.theme.logoText).toBe('MEINOPOLY');
    });

    it('provides victory config with defaults', () => {
      const map = loadMap(classicMap);
      expect(map.victory.primary).toBe('wealth');
      expect(map.victory.maxTurns).toBe(0);
    });

    it('provides mapMechanics with defaults', () => {
      const map = loadMap(classicMap);
      expect(map.mapMechanics.incomeMultiplier).toBe(1.0);
      expect(map.mapMechanics.rentMultiplier).toBe(1.0);
    });

    it('passes through connections as null for linear maps', () => {
      const map = loadMap(classicMap);
      expect(map.connections).toBeNull();
    });

    it('passes through empty phases', () => {
      const map = loadMap(classicMap);
      expect(map.phases).toEqual([]);
    });

    it('throws on invalid map', () => {
      expect(() => loadMap({ id: '', spaceCount: 3 })).toThrow('Map validation failed');
    });

    // ── Non-classic maps ──────────────────────────────

    it('loads the Stuttgart circle map (28 spaces)', () => {
      const map = loadMap(stuttgartMap);
      expect(map.id).toBe('stuttgart-fracture-loop');
      expect(map.spaceCount).toBe(28);
      expect(map.layoutType).toBe('circle');
      expect(Object.keys(map.positions).length).toBe(28);
      // Circle positions should be in range 0-100
      Object.values(map.positions).forEach(p => {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(100);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(100);
      });
      // Map mechanics are non-default
      expect(map.mapMechanics.incomeMultiplier).toBe(1.05);
      // Has affinity data
      expect(map.affinity['albert-victor']).toBeDefined();
    });

    it('loads the Outer Rim hexagon map (30 spaces) with connections', () => {
      const map = loadMap(outerRimMap);
      expect(map.id).toBe('outer-rim-station');
      expect(map.spaceCount).toBe(30);
      expect(map.layoutType).toBe('hexagon');
      expect(Object.keys(map.positions).length).toBe(30);
      // Has portal connections
      expect(map.connections).toBeDefined();
      expect(map.connections['5']).toContain(17);
      expect(map.connections['17']).toContain(5);
      // Color groups
      expect(map.colorGroupsFlat['#22C55E']).toEqual([1, 2, 5]);
      expect(map.colorGroupsFlat['#F97316']).toEqual([22, 24, 26]);
    });

    it('loads the Nightveil custom-layout map (26 spaces) with phases', () => {
      const map = loadMap(nightveilMap);
      expect(map.id).toBe('nightveil-intrigue');
      expect(map.spaceCount).toBe(26);
      expect(map.layoutType).toBe('custom');
      // Custom layout uses provided positions
      expect(map.positions[0].x).toBe(88);
      expect(map.positions[0].y).toBe(88);
      expect(map.positions[25].x).toBe(30);
      expect(map.positions[25].y).toBe(54);
      // Has phases
      expect(map.phases).toHaveLength(3);
      expect(map.phases[0].id).toBe('calm');
      expect(map.phases[2].id).toBe('exposure');
      // Has connections for inner loop
      expect(map.connections).toBeDefined();
      expect(map.connections['25']).toContain(8);
      // Non-default mechanics
      expect(map.mapMechanics.rentMultiplier).toBe(1.08);
    });
  });

  // ── Position Generators ─────────────────────────────

  describe('position generators', () => {
    it('generates circle positions for a 20-space map', () => {
      const circleMap = {
        ...classicMap,
        id: 'circle-test',
        spaceCount: 20,
        layout: { type: 'circle', params: { radius: 45 } },
        cards: {
          chance: [
            { text: 'Advance to GO!', action: 'moveTo', value: 0 },
            { text: 'Collect $50.', action: 'gain', value: 50 },
          ],
          community: [
            { text: 'Advance to GO!', action: 'moveTo', value: 0 },
            { text: 'Collect $100.', action: 'gain', value: 100 },
          ],
        },
        spaces: Array.from({ length: 20 }, (_, i) => {
          if (i === 0) return { id: i, name: 'GO', type: 'go' };
          if (i === 5) return { id: i, name: 'Jail', type: 'jail' };
          if (i === 10) return { id: i, name: 'Parking', type: 'parking' };
          if (i === 15) return { id: i, name: 'GoToJail', type: 'goToJail' };
          if (i === 3 || i === 13) return { id: i, name: 'Chance', type: 'chance' };
          if (i === 8 || i === 18) return { id: i, name: 'Community', type: 'community' };
          if (i === 4) return { id: i, name: 'Tax', type: 'tax', taxAmount: 100 };
          if (i === 7) return { id: i, name: 'Railroad', type: 'railroad', price: 200 };
          if (i === 9) return { id: i, name: 'Utility', type: 'utility', price: 150 };
          // Properties in pairs
          const colors = ['#AA0000', '#AA0000', '#00AA00', '#00AA00', '#0000AA', '#0000AA', '#AAAA00', '#AAAA00'];
          const propIdx = [1, 2, 6, 11, 12, 14, 16, 17];
          const pi = propIdx.indexOf(i);
          if (pi >= 0) return { id: i, name: 'Prop ' + i, type: 'property', color: colors[pi], price: 100 + i * 20, rent: 10 + i * 2 };
          return { id: i, name: 'Space ' + i, type: 'community' };
        }),
        specialSpaces: { go: 0, jail: 5, parking: 10, goToJail: 15 },
        colorGroups: {
          '#AA0000': { name: 'Red', spaces: [1, 2] },
          '#00AA00': { name: 'Green', spaces: [6, 11] },
          '#0000AA': { name: 'Blue', spaces: [12, 14] },
          '#AAAA00': { name: 'Yellow', spaces: [16, 17] },
        },
      };
      const map = loadMap(circleMap);
      expect(Object.keys(map.positions).length).toBe(20);
      // All positions should be within 0-100
      Object.values(map.positions).forEach(p => {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(100);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(100);
      });
    });
  });

  // ── Grid Helpers ────────────────────────────────────

  describe('getGridDimensions', () => {
    it('returns 11x11 for 40-space square', () => {
      expect(getGridDimensions(40, 'square')).toEqual({ rows: 11, cols: 11 });
    });

    it('returns 8x8 for 28-space square', () => {
      expect(getGridDimensions(28, 'square')).toEqual({ rows: 8, cols: 8 });
    });

    it('returns null for circle layout', () => {
      expect(getGridDimensions(20, 'circle')).toBeNull();
    });
  });
});
