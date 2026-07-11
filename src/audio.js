// WebAudio SFX synth — spec 2026-07-11 §3.2. NO asset files; everything is
// square/triangle oscillators + noise buffers. PRESENTATION-ONLY: any failure
// (no AudioContext, suspended context, autoplay policy) degrades to silence.
// A separate bgmGain node is created but unused — reserved for future BGM
// (owner: "bgm后面加").

export const EVENT_SOUND_MAP = {
  dice_rolled: 'dice',
  moved: 'hop',
  property_bought: 'buy',
  rent_paid: 'rent',
  tax_paid: 'rent',
  card_drawn: 'card',
  went_to_jail: 'jail',
  salary_collected: 'go',
  duel_offered: 'duel',
  duel_initiated: 'duel',
  duel_resolved: 'duel_resolved',
  bankruptcy: 'duel_lose',
  game_over: 'victory',
  auction_started: 'card',
};

// Recipes: [waveform, [freqHz...], stepMs, gainPeak]. Jingles are longer arrays.
const RECIPES = {
  dice:     { noise: true, bursts: 5, stepMs: 60, gain: 0.25 },
  hop:      { wave: 'square', freqs: [440], stepMs: 50, gain: 0.15 }, // pitch scaled by hop index at play time
  buy:      { wave: 'square', freqs: [523, 659, 784], stepMs: 70, gain: 0.2 },
  rent:     { wave: 'triangle', freqs: [392, 262], stepMs: 110, gain: 0.2 },
  card:     { wave: 'square', freqs: [880, 1175], stepMs: 55, gain: 0.15 },
  jail:     { wave: 'triangle', freqs: [110, 98], stepMs: 180, gain: 0.25 },
  go:       { wave: 'square', freqs: [988, 1319], stepMs: 45, gain: 0.18 },
  duel:     { wave: 'square', freqs: [196, 233, 196, 233], stepMs: 90, gain: 0.25 },
  duel_win: { wave: 'square', freqs: [523, 659, 784, 1047], stepMs: 90, gain: 0.22 },
  duel_lose:{ wave: 'triangle', freqs: [330, 262, 196, 131], stepMs: 110, gain: 0.22 },
  victory:  { wave: 'square', freqs: [523, 659, 784, 1047, 784, 1047, 1319], stepMs: 120, gain: 0.25 },
};

export function createAudio(opts) {
  const o = opts || {};
  let ctx = null;
  let master = null;
  let bgmGain = null; // reserved channel — BGM added later per owner
  let muted = false;
  try { muted = localStorage.getItem('meino-muted') === '1'; } catch (e) { /* no storage */ }

  function ensureContext() {
    if (ctx || o.contextFactory === null) return;
    try {
      const factory = o.contextFactory
        || (typeof AudioContext !== 'undefined' ? () => new AudioContext() : null);
      if (!factory) return;
      ctx = factory();
      master = ctx.createGain();
      master.gain.value = 1;
      master.connect(ctx.destination);
      bgmGain = ctx.createGain();
      bgmGain.gain.value = 0;
      bgmGain.connect(master);
    } catch (e) { ctx = null; } // permanent silent no-op
  }

  function trigger(name, arg) {
    if (muted) return;
    if (o.onTrigger) { o.onTrigger(name, arg); return; } // test seam
    if (!ctx || ctx.state !== 'running') return;
    const r = RECIPES[name];
    if (!r) return;
    const t0 = ctx.currentTime;
    if (r.noise) {
      for (let i = 0; i < r.bursts; i++) {
        const src = ctx.createBufferSource();
        const buf = ctx.createBuffer(1, 2205, 44100);
        const d = buf.getChannelData(0);
        for (let k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1;
        src.buffer = buf;
        const g = ctx.createGain();
        g.gain.setValueAtTime(r.gain, t0 + i * r.stepMs / 1000);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + (i * r.stepMs + 55) / 1000);
        src.connect(g); g.connect(master);
        src.start(t0 + i * r.stepMs / 1000);
        src.stop(t0 + (i * r.stepMs + 60) / 1000);
      }
      return;
    }
    const pitchMul = name === 'hop' && typeof arg === 'number' ? Math.pow(1.06, arg) : 1;
    r.freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = r.wave;
      osc.frequency.setValueAtTime(f * pitchMul, t0 + i * r.stepMs / 1000);
      const g = ctx.createGain();
      g.gain.setValueAtTime(r.gain, t0 + i * r.stepMs / 1000);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + ((i + 1) * r.stepMs) / 1000);
      osc.connect(g); g.connect(master);
      osc.start(t0 + i * r.stepMs / 1000);
      osc.stop(t0 + ((i + 1) * r.stepMs + 20) / 1000);
    });
  }

  return {
    onFirstGesture() {
      ensureContext();
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    },
    play(name, arg) { trigger(name, arg); },
    hop(i) { trigger('hop', i); },
    dice() { trigger('dice'); },
    playForEvent(event) {
      const name = EVENT_SOUND_MAP[event.type];
      if (!name) return;
      if (name === 'duel_resolved') {
        // Real emit shape (src/Game.js ~1953-1965): actor = challengerId,
        // data.winnerId = the actual winning player's id. winnerId === actor
        // means the challenger won this duel.
        trigger(event.data && event.data.winnerId === event.actor ? 'duel_win' : 'duel_lose');
        return;
      }
      trigger(name);
    },
    setMuted(b) {
      muted = !!b;
      try { localStorage.setItem('meino-muted', muted ? '1' : '0'); } catch (e) {}
    },
    isMuted() { return muted; },
  };
}
