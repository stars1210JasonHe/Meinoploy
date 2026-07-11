/**
 * @jest-environment jsdom
 */
// src/__tests__/audio.test.js
//
// This module reads/writes `localStorage` and probes for a global
// `AudioContext`, neither of which exist under this project's default Jest
// testEnvironment ('node' — jest.config.js sets no testEnvironment, and
// Jest 27+ defaults to 'node', not 'jsdom'). Scoped to jsdom via this
// docblock (not a jest.config.js-wide change) so no other suite's Node-only
// assumptions are disturbed. Verified: RED run without this docblock threw
// `ReferenceError: localStorage is not defined`, not the AudioContext-absent
// no-op the brief anticipated — confirming the harness needs jsdom, not just
// jsdom-shaped mocks. jest-environment-jsdom pinned to match installed jest
// (30.2.0) added as a devDependency for this.
import { createAudio, EVENT_SOUND_MAP } from '../audio';
import { ENGINE_EVENTS } from '../events';

describe('EVENT_SOUND_MAP', () => {
  test('every key is a real registry event type (typos fail here)', () => {
    Object.keys(EVENT_SOUND_MAP).forEach(k => {
      expect(ENGINE_EVENTS[k]).toBe(k);
    });
  });
  test('pins the spec §3.2 audible set exactly', () => {
    expect(EVENT_SOUND_MAP).toEqual({
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
      duel_resolved: 'duel_resolved', // resolved -> win|lose picked from event data at play time
      bankruptcy: 'duel_lose',
      game_over: 'victory',
      auction_started: 'card',
    });
  });
});

describe('createAudio', () => {
  // jsdom has no AudioContext: default construction must silently no-op.
  test('no AudioContext -> everything is a silent no-op (no throw)', () => {
    const a = createAudio();
    expect(() => { a.onFirstGesture(); a.play('buy'); a.hop(3); a.dice(); }).not.toThrow();
  });

  test('mute state persists via localStorage["meino-muted"], default unmuted', () => {
    localStorage.removeItem('meino-muted');
    const a = createAudio();
    expect(a.isMuted()).toBe(false);
    a.setMuted(true);
    expect(localStorage.getItem('meino-muted')).toBe('1');
    const b = createAudio();
    expect(b.isMuted()).toBe(true);
    b.setMuted(false);
    expect(localStorage.getItem('meino-muted')).toBe('0');
  });

  test('muted -> recipe trigger not invoked; unmuted -> invoked (spy on internal trigger)', () => {
    // Construct with an injected fake context factory to observe scheduling:
    const calls = [];
    const fakeCtx = () => ({
      currentTime: 0, state: 'running', resume: () => Promise.resolve(), destination: {},
      createGain: () => ({ gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }),
      createOscillator: () => { calls.push('osc'); return { type: 'square', frequency: { value: 0, setValueAtTime() {} }, connect() {}, start() {}, stop() {} }; },
      createBuffer: () => ({ getChannelData: () => new Float32Array(4410) }),
      createBufferSource: () => { calls.push('noise'); return { buffer: null, connect() {}, start() {}, stop() {} }; },
    });
    const a = createAudio({ contextFactory: fakeCtx });
    a.onFirstGesture();
    a.setMuted(true);
    a.play('buy');
    expect(calls).toHaveLength(0);
    a.setMuted(false);
    a.play('buy');
    expect(calls.length).toBeGreaterThan(0);
  });

  test('playForEvent routes through the map; unmapped types are silent', () => {
    const calls = [];
    const a = createAudio({ contextFactory: null, onTrigger: n => calls.push(n) });
    a.onFirstGesture();
    a.playForEvent({ type: 'property_bought', data: {} });
    a.playForEvent({ type: 'landing_notice', data: {} }); // unmapped -> silence
    // duel_resolved real shape (src/Game.js ~1953-1965): actor = challengerId,
    // data.winnerId = the actual winner's player id. winnerId === actor ->
    // challenger won -> duel_win; otherwise the owner won -> duel_lose.
    a.playForEvent({ type: 'duel_resolved', actor: '1', data: { winnerId: '1', ownerId: '0' } });
    a.playForEvent({ type: 'duel_resolved', actor: '1', data: { winnerId: '0', ownerId: '0' } });
    expect(calls).toEqual(['buy', 'duel_win', 'duel_lose']);
  });
});
