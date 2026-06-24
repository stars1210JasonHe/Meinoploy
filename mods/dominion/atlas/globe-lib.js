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
  // FETCH the vendored UMD as text, then inject it as an INLINE <script>. We can't use
  // <script src=globe.gl.lib> because the .lib extension serves with a non-JS MIME type
  // (parcel / koa-static), which strict browsers (X-Content-Type-Options: nosniff) refuse
  // to execute. An inline script runs regardless of the source asset's MIME. (The .lib
  // extension is still needed so Parcel v1 copies it as a static asset instead of trying
  // to ES-bundle it — which fails on globe.gl's three/webgpu import.)
  _loading = fetch(globeLibUrl)
    .then(r => { if (!r.ok) throw new Error('globe.gl asset HTTP ' + r.status); return r.text(); })
    .then(code => {
      const s = document.createElement('script');
      s.textContent = code;
      document.head.appendChild(s);
      if (!window.Globe) throw new Error('globe.gl ran but window.Globe missing');
      return window.Globe;
    })
    .catch(err => {
      // Reset so a transient failure doesn't poison every future getGlobe() with the
      // same rejection — the next call retries.
      _loading = null;
      throw err;
    });
  return _loading;
}
