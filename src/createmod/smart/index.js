// Create-Mod smart-builder — orchestrator + seeded PRNG. Pure (no fs/images).
// expandFacts (added by a later task) is the only public entry the CLI calls.

// mulberry32 seeded from a 32-bit string hash. The ONLY randomness source in smart/*
// (Math.random/Date.now are forbidden — they break same-seed reproducibility).
export function makeRng(seedString) {
  const s = String(seedString);
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
