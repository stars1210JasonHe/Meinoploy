// CLIENT-ONLY real-city background assets for Terra Circuit.
//
// Parcel v1 requires images imported as ES modules (not string paths) to bundle them.
// This module is imported ONLY by the client (App.js) — NEVER by Game.js / world-loader /
// the sim, which run under plain Node (`node -r esm`) and cannot load image imports. This
// mirrors why characters.js (with portrait imports) is split from the server-safe
// characters-data.js. Keep it out of any module the engine/tests/sim load.
//
// Images are fetched + bundled by mods/dominion/atlas/assets/fetch-assets.mjs (provenance
// + licensing in assets/CREDITS.md). Keyed by placeId — must match terra-circuit.js places.
import worldBg from './assets/world.jpg';
import tokyo from './assets/cities/tokyo.jpg';
import shanghai from './assets/cities/shanghai.jpg';
import singapore from './assets/cities/singapore.jpg';
import mumbai from './assets/cities/mumbai.jpg';
import dubai from './assets/cities/dubai.jpg';
import newyork from './assets/cities/newyork.jpg';
import london from './assets/cities/london.jpg';

export const TERRA_ASSETS = {
  worldBg,
  cityImages: { tokyo, shanghai, singapore, mumbai, dubai, newyork, london },
};
