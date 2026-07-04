import {
  buildMapPrompt, buildWorldPrompt, buildBoardPrompt, buildRosterPrompt, buildLorePrompt,
  buildRepairPrompt, MAP_CACHE_KEY, KEBAB_PATTERN,
} from '../createmod/extract/prompts';
import { ARCHETYPES } from '../../mods/dominion/atlas/archetypes';
import { IMPLEMENTED_PASSIVES } from '../createmod/validate';
import { STAT_KEYS } from '../createmod/smart/roster';

// Recursively assert strict-mode shape: every object schema closes additionalProperties
// and lists every property in required.
function assertStrict(schema, path = '$') {
  if (schema.type === 'object' || schema.properties) {
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties).sort()).toEqual((schema.required || []).slice().sort());
    Object.entries(schema.properties).forEach(([k, v]) => assertStrict(v, `${path}.${k}`));
  }
  if (schema.items) assertStrict(schema.items, `${path}[]`);
}

const CUT = {
  places: [{ canonicalName: 'Xi\'an', aliases: [], mentions: 5, regionHints: ['west'] }],
  characters: [{ canonicalName: 'Cao Cao', aliases: ['Mengde'], mentions: 9, traits: ['cunning'], relationships: [] }],
  themes: ['war'],
};

describe('strict-mode schema rules', () => {
  test('every schema is strict-legal', () => {
    [buildMapPrompt('text', 'en'),
     buildWorldPrompt(CUT, ['war'], 'en', {}),
     buildWorldPrompt(CUT, ['war'], 'en', { mapImage: true }),
     buildBoardPrompt(CUT, ['war'], 'en'),
     buildRosterPrompt(CUT.characters, 'en', 2),
     buildLorePrompt(CUT.characters[0], 'evidence', ['A', 'B'], 'en'),
    ].forEach(p => {
      expect(p.name).toBeTruthy();
      assertStrict(p.schema);
      expect(JSON.stringify(p.schema)).not.toMatch(/oneOf|minItems/);
    });
  });
  test('vocabularies embedded as enums', () => {
    const world = buildWorldPrompt(CUT, [], 'en', {});
    expect(JSON.stringify(world.schema)).toContain(JSON.stringify(Object.keys(ARCHETYPES)));
    const roster = buildRosterPrompt(CUT.characters, 'en', 2);
    expect(JSON.stringify(roster.schema)).toContain(JSON.stringify(IMPLEMENTED_PASSIVES));
    expect(JSON.stringify(roster.schema)).toContain(JSON.stringify(STAT_KEYS));
  });
  test('id fields carry the kebab pattern; modId present in world AND board schemas', () => {
    const w = buildWorldPrompt(CUT, [], 'en', {});
    const b = buildBoardPrompt(CUT, [], 'en');
    expect(w.schema.properties.modId.pattern).toBe(KEBAB_PATTERN);
    expect(b.schema.properties.modId.pattern).toBe(KEBAB_PATTERN);
    expect(w.schema.properties.places.items.properties.id.pattern).toBe(KEBAB_PATTERN);
  });
  test('two world variants: default requires geo, image variant requires pos + flat', () => {
    const geo = buildWorldPrompt(CUT, [], 'en', {});
    const img = buildWorldPrompt(CUT, [], 'en', { mapImage: true });
    expect(geo.schema.properties.places.items.required).toContain('geo');
    expect(geo.schema.properties.places.items.required).not.toContain('pos');
    expect(img.schema.properties.places.items.required).toContain('pos');
    expect(img.schema.properties.places.items.required).not.toContain('geo');
    expect(img.schema.properties.renderMode.enum).toEqual(['flat']);
  });
  test('map prompt is TARGET-INDEPENDENT and lang-dependent', () => {
    const en = buildMapPrompt('chunk', 'en');
    expect(en.user).not.toMatch(/10|12/); // no target numbers
    const zh = buildMapPrompt('chunk', 'zh');
    expect(zh.user).not.toBe(en.user);
  });
  test('MAP_CACHE_KEY is a stable 16-hex content hash', () => {
    expect(MAP_CACHE_KEY).toMatch(/^[0-9a-f]{16}$/);
  });
  test('repair prompt reuses the base schema and appends errors', () => {
    const base = buildRosterPrompt(CUT.characters, 'en', 2);
    const rep = buildRepairPrompt(base, ['roster (x): duplicate id']);
    expect(rep.schema).toBe(base.schema);
    expect(rep.user).toMatch(/change only the failing entries/i);
    expect(rep.user).toContain('duplicate id');
  });
});
