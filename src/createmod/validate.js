// Create-Mod — thin-builder normalize + validation. Pure (reuses world/map loaders, no fs/images).
import { validateWorld, loadWorld } from '../world-loader';
import { validateMap, loadMap } from '../map-loader';

export const IMPLEMENTED_PASSIVES = ['financier', 'pioneer', 'speculator', 'enforcer', 'idealist', 'breaker', 'arbitrageur', 'merchant'];
export const STAT_KEYS = ['capital', 'luck', 'negotiation', 'charisma', 'tech', 'stamina'];

function deriveGeoPos(place, renderMode) {
  const p = Object.assign({}, place);
  if (p.geo && !p.pos) {
    p.pos = { x: (p.geo.lng + 180) / 360 * 100, y: (90 - p.geo.lat) / 180 * 100 };
  } else if (renderMode === 'globe' && p.pos && !p.geo) {
    p.geo = { lat: 90 - p.pos.y / 100 * 180, lng: p.pos.x / 100 * 360 - 180 };
  }
  return p;
}

export function normalizeAtlasWorld(world, archetypes) {
  const places = (world.places || []).map(p => deriveGeoPos(p, world.renderMode));
  let size = world.size;
  if (!size) {
    let maxSpaces = 0;
    for (const place of places) {
      for (const aid of (place.archetypes || [])) {
        const arch = archetypes[aid];
        if (arch && Array.isArray(arch.spaceSlots)) maxSpaces += arch.spaceSlots.length;
      }
    }
    size = { maxPlaces: places.length, maxSpaces };
  }
  return Object.assign({}, world, { places, size });
}
