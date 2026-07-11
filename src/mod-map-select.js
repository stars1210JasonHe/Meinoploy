// Server-side mod/map activation (MT2-SP3, spec §0/§2).
//
// A NEW extraction, deliberately NOT literal reuse of App.js's setMap(): that
// method interleaves client-only lines (atlasAssets from the Tier-B bundle,
// getGlobe() dynamic WebGL import) that don't exist server-side. This module
// covers exactly the ENGINE-relevant subset against the Tier-A registry:
// world entries (movementMode 'atlas') expand through loadWorld; classic
// map.json entries through loadMap; both feed setActiveMap. One mod+map per
// process (setActiveMod/setActiveMap are process-global by design — the known
// concurrency limitation the spec documents).
import { setActiveMod, setActiveMap } from './Game';
import { loadWorld } from './world-loader';
import { loadMap } from './map-loader';
import { ARCHETYPES } from '../mods/dominion/atlas/archetypes';
import { MODS } from '../mods/index';

export function resolveModMap(modId, mapId) {
  const mod = MODS[modId];
  if (!mod) {
    throw new Error(`unknown mod '${modId}' — available: ${Object.keys(MODS).join(', ')}`);
  }
  setActiveMod(modId); // installs RULES + roster + mod default board

  const available = (mod.maps || []).concat(mod.worlds || []);
  if (available.length === 0) {
    // No maps/worlds registered: the setActiveMod reseed already installed the
    // mod's default board (activeMapId stays null).
    if (mapId) throw new Error(`unknown map '${mapId}' for mod '${modId}' — it registers no maps/worlds`);
    return { modId, mapId: null };
  }

  const entry = mapId ? available.find(m => m.id === mapId) : available[0];
  if (!entry) {
    throw new Error(`unknown map '${mapId}' for mod '${modId}' — available: ${available.map(m => m.id).join(', ')}`);
  }
  const mapData = entry.movementMode === 'atlas' ? loadWorld(entry, ARCHETYPES) : loadMap(entry);
  setActiveMap(mapData);
  return { modId, mapId: entry.id };
}
