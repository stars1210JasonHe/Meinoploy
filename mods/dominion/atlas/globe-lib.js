// CLIENT-ONLY pixel-globe library loader (Option A: vendored UMD, no bundler change).
//
// globe.gl ships a self-contained UMD (three bundled inside, ~1.7MB) that exposes
// window.Globe. Parcel v1 CANNOT ES-bundle the globe.gl npm package — it imports
// 'three/webgpu' from a modern `exports` map that Parcel 1 (2018) predates. So we
// vendor the prebuilt UMD as a NON-.js asset (Parcel copies it verbatim + returns a
// URL instead of trying to bundle it) and inject it as a <script> at runtime; the UMD
// then runs in global scope and sets window.Globe. Offline — no CDN.
//
// >>> A→B SWAP POINT <<<  When a real bundler (Vite / Parcel 2) lands, delete the
// script injection and make getGlobe() just `import Globe from 'globe.gl'; return Globe`.
// `three` + `globe.gl` are already in package.json, ready for that swap. Nothing else
// in the globe renderer changes — it only ever touches `Globe` via getGlobe().
import globeLibUrl from './assets/vendor/globe.gl.lib';

let _loading = null;

// Resolve the global Globe constructor, injecting the vendored UMD exactly once.
export function getGlobe() {
  if (typeof window !== 'undefined' && window.Globe) return Promise.resolve(window.Globe);
  if (_loading) return _loading;
  _loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = globeLibUrl;
    s.async = true;
    s.onload = () => (window.Globe ? resolve(window.Globe) : reject(new Error('globe.gl loaded but window.Globe missing')));
    s.onerror = () => reject(new Error('failed to load vendored globe.gl'));
    document.head.appendChild(s);
  }).catch(err => {
    // Reset so a transient load failure (bad asset response, CSP/MIME, etc.) doesn't
    // poison every future getGlobe() with the same rejection — the next call retries.
    _loading = null;
    throw err;
  });
  return _loading;
}
