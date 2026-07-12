// src/__tests__/anim.test.js — DOM-free: fake stage + manual clock.
import { createAnimator, deriveLoopPath } from '../anim';

function makeClock() {
  let t = 0; const q = [];
  return {
    now: () => t,
    schedule: (fn, ms) => { q.push({ at: t + ms, fn }); q.sort((a, b) => a.at - b.at); },
    tick(ms) { // advance, firing due callbacks in order
      const end = t + ms;
      while (q.length && q[0].at <= end) { const j = q.shift(); t = j.at; j.fn(); }
      t = end;
    },
  };
}
function makeStage(log) {
  return {
    diceStart: (d1, d2) => log.push(`dice:${d1},${d2}`),
    diceEnd: () => log.push('diceEnd'),
    // Fix 2: enqueue-claim callback — fires when a hop job is QUEUED (delivery
    // time), carrying the actor's ORIGIN position, distinct from hopTo (which
    // fires per tile once the job actually starts playing).
    hopQueued: (pid, from) => log.push(`hopQueued:${pid}@${from}`),
    hopTo: (pid, pos, i, n) => log.push(`hop:${pid}@${pos}(${i}/${n})`),
    hopDone: (pid) => log.push(`done:${pid}`),
    reapply: () => log.push('reapply'),
  };
}
function makeSink(log) {
  return { dice: () => log.push('snd:dice'), hop: i => log.push(`snd:hop${i}`), event: e => log.push(`snd:${e.type}`) };
}
const ev = (seq, type, actor, data) => ({ seq, turn: 1, type, actor, data: data || {} });
const gWith = (events) => ({ events, players: [] });

describe('deriveLoopPath', () => {
  test('simple forward', () => expect(deriveLoopPath(3, 6, 40)).toEqual([4, 5, 6]));
  test('wraps around GO', () => expect(deriveLoopPath(38, 2, 40)).toEqual([39, 0, 1, 2]));
  test('from==to -> empty (no walk)', () => expect(deriveLoopPath(5, 5, 40)).toEqual([]));
});

describe('animator queue', () => {
  test('dice then hop play in seq order with sounds at milestones', () => {
    const log = []; const clock = makeClock();
    const a = createAnimator({ stage: makeStage(log), sink: makeSink(log), now: clock.now, schedule: clock.schedule, isDisabled: () => false });
    a.onState(gWith([])); // Fix 3 warm-up: absorbs the empty log so the real events below aren't mistaken for a first-sight join
    a.onState(gWith([
      ev(0, 'dice_rolled', '0', { d1: 2, d2: 3, total: 5, doubles: false }),
      ev(1, 'moved', '0', { from: 0, to: 2, path: [1, 2] }),
    ]));
    clock.tick(0);
    // Fix 2: hopQueued fires SYNCHRONOUSLY while onState is still enqueueing
    // (seq 1's moved event), which happens before runNext() ever starts
    // playing the queue (seq 0's dice job) — so it lands ahead of the dice
    // sound in the log despite dice_rolled having the lower seq.
    expect(log[0]).toBe('hopQueued:0@0');
    expect(log[1]).toBe('snd:dice');       // dice sound at tumble start
    expect(log[2]).toBe('dice:2,3');
    // Fix 2 contract change: ownership is claimed at ENQUEUE time (when onState
    // delivers the 'moved' event and pushes its hop job), not at hop-job-start.
    // This REVERSES the old assertion here (`toBe(false)`, commented "hop not
    // started until dice finishes") — that belief is exactly the bug: it let
    // renderTokens paint the token at its destination for the whole dice
    // window before visibly snapping back to path[0] to walk.
    expect(a.isAnimating('0')).toBe(true);
    clock.tick(1100);                       // 700 tumble + 400 hold
    expect(log).toContain('diceEnd');
    expect(a.isAnimating('0')).toBe(true);
    clock.tick(160);
    expect(log).toContain('hop:0@1(0/2)');
    expect(log).toContain('snd:hop0');
    clock.tick(160);
    expect(log).toContain('hop:0@2(1/2)');
    expect(log).toContain('done:0');
    expect(a.isAnimating('0')).toBe(false);
  });

  test('non-animated audible events forward to sink immediately in seq order', () => {
    const log = []; const clock = makeClock();
    const a = createAnimator({ stage: makeStage(log), sink: makeSink(log), now: clock.now, schedule: clock.schedule, isDisabled: () => false });
    a.onState(gWith([])); // Fix 3 warm-up
    a.onState(gWith([ev(0, 'property_bought', '0', {})]));
    expect(log).toEqual(['snd:property_bought']);
  });

  test('cursor: events are consumed once across onState calls', () => {
    const log = []; const clock = makeClock();
    const a = createAnimator({ stage: makeStage(log), sink: makeSink(log), now: clock.now, schedule: clock.schedule, isDisabled: () => false });
    a.onState(gWith([])); // Fix 3 warm-up
    const events = [ev(0, 'property_bought', '0', {})];
    a.onState(gWith(events));
    a.onState(gWith(events)); // same state re-delivered (re-render) -> no double sound
    expect(log).toEqual(['snd:property_bought']);
  });

  test('fastForward completes everything instantly', () => {
    const log = []; const clock = makeClock();
    const a = createAnimator({ stage: makeStage(log), sink: makeSink(log), now: clock.now, schedule: clock.schedule, isDisabled: () => false });
    a.onState(gWith([])); // Fix 3 warm-up
    a.onState(gWith([
      ev(0, 'dice_rolled', '0', { d1: 1, d2: 1, total: 2, doubles: true }),
      ev(1, 'moved', '0', { from: 0, to: 2, path: [1, 2] }),
    ]));
    a.fastForward();
    expect(log).toContain('diceEnd');
    expect(log).toContain('done:0');
    expect(a.isAnimating('0')).toBe(false);
  });

  test('queue depth cap: >6 pending events drain instantly except the last two', () => {
    const log = []; const clock = makeClock();
    const a = createAnimator({ stage: makeStage(log), sink: makeSink(log), now: clock.now, schedule: clock.schedule, isDisabled: () => false });
    a.onState(gWith([])); // Fix 3 warm-up
    const events = [];
    for (let s = 0; s < 8; s++) events.push(ev(s, 'moved', String(s % 2), { from: 0, to: 1, path: [1] }));
    a.onState(gWith(events));
    clock.tick(0);
    // first 6 completed instantly (done logged), last 2 animate normally
    const doneCount = log.filter(l => l.startsWith('done:')).length;
    expect(doneCount).toBeGreaterThanOrEqual(6);
  });

  test('gap (front-trim) -> jump cursor, no animation for missing range', () => {
    const log = []; const clock = makeClock();
    const a = createAnimator({ stage: makeStage(log), sink: makeSink(log), now: clock.now, schedule: clock.schedule, isDisabled: () => false });
    // No explicit warm-up needed: this is itself the animator's first-ever
    // onState call, so (Fix 3) it absorbs silently — but the very next line
    // clears the log unconditionally anyway, so the assertion below only ever
    // observes the SECOND call's output either way.
    a.onState(gWith([ev(0, 'property_bought', '0', {})]));
    log.length = 0;
    // trimmed log: oldest seq jumped from 1 to 250
    a.onState(gWith([ev(250, 'property_bought', '0', {}), ev(251, 'rent_paid', '1', {})]));
    // gap policy: skip to latest, do NOT replay the missing range; the two
    // present events after the jump still play (they are the newest state)
    expect(log).toEqual(['snd:property_bought', 'snd:rent_paid']);
  });

  test('reset clears queue and reveals: pending hop never fires after reset', () => {
    const log = []; const clock = makeClock();
    const a = createAnimator({ stage: makeStage(log), sink: makeSink(log), now: clock.now, schedule: clock.schedule, isDisabled: () => false });
    // Fix 3 warm-up: without this, the single moved event below would be the
    // animator's first-ever onState call and get silently absorbed as a
    // first-sight join, so this test would no longer exercise an actual
    // in-flight hop.
    a.onState(gWith([]));
    a.onState(gWith([ev(0, 'moved', '0', { from: 0, to: 3, path: [1, 2, 3] })]));
    clock.tick(160); // one hop in
    a.reset();
    expect(a.isAnimating('0')).toBe(false);
    const before = log.length;
    clock.tick(2000);
    expect(log.length).toBe(before); // nothing scheduled survived
  });

  // ─── resetAll: bulk-release for queued-never-played hop jobs ───
  test('reset() releases a hop queued behind a still-playing dice job via stage.resetAll', () => {
    const log = []; const clock = makeClock();
    // Fake stage extended with a resetAll logger, scoped to THIS test only — the
    // shared makeStage() above deliberately does NOT define resetAll, so every
    // other test's fake stage exercises the `if (stage.resetAll)` optional-hook
    // guard in anim.js reset() and proves old fakes without it still work.
    const stage = { ...makeStage(log), resetAll: () => log.push('resetAll') };
    const a = createAnimator({ stage, sink: makeSink(log), now: clock.now, schedule: clock.schedule, isDisabled: () => false });
    a.onState(gWith([])); // Fix 3 warm-up
    // Dice job starts playing immediately; the hop job for actor '0' queues
    // behind it (hopQueued fires at enqueue time) but never gets to play or
    // run finishJob/hopDone before we exit — this is exactly the "roll then
    // exit during the dice tumble" repro.
    a.onState(gWith([
      ev(0, 'dice_rolled', '0', { d1: 2, d2: 3, total: 5, doubles: false }),
      ev(1, 'moved', '0', { from: 0, to: 2, path: [1, 2] }),
    ]));
    expect(log).toContain('hopQueued:0@0'); // stage-side placement state created at enqueue
    expect(a.isAnimating('0')).toBe(true);  // dice still tumbling; hop never started
    a.reset();
    expect(log[log.length - 1]).toBe('resetAll'); // bulk-release hook fired
    expect(a.isAnimating('0')).toBe(false);
    const before = log.length;
    clock.tick(2000); // well past the dice tumble/hold and hop windows
    // Nothing scheduled survived the reset — no reapply/hopTo/hopDone/dice
    // activity fires for the actor whose hop was only ever queued, not played.
    expect(log.length).toBe(before);
  });

  test('disabled -> everything completes synchronously, sounds still fire', () => {
    const log = []; const clock = makeClock();
    const a = createAnimator({ stage: makeStage(log), sink: makeSink(log), now: clock.now, schedule: clock.schedule, isDisabled: () => true });
    a.onState(gWith([])); // Fix 3 warm-up
    a.onState(gWith([
      ev(0, 'dice_rolled', '0', { d1: 4, d2: 2, total: 6, doubles: false }),
      ev(1, 'moved', '0', { from: 0, to: 2, path: [1, 2] }),
    ]));
    expect(log).toContain('snd:dice');
    expect(log).toContain('done:0');
    expect(a.isAnimating('0')).toBe(false);
  });

  test('moved without path on a loop board derives the walk', () => {
    const log = []; const clock = makeClock();
    const a = createAnimator({ stage: makeStage(log), sink: makeSink(log), now: clock.now, schedule: clock.schedule, isDisabled: () => true, boardSize: () => 40 });
    a.onState(gWith([])); // Fix 3 warm-up
    a.onState(gWith([ev(0, 'moved', '0', { from: 38, to: 1, passedGo: true })]));
    expect(log).toContain('hop:0@39(0/3)');
    expect(log).toContain('hop:0@1(2/3)');
  });

  test('route-exhausted moved (routeExhausted:true) is skipped — its twin shared emit animates once', () => {
    const log = []; const clock = makeClock();
    const a = createAnimator({ stage: makeStage(log), sink: makeSink(log), now: clock.now, schedule: clock.schedule, isDisabled: () => true });
    a.onState(gWith([])); // Fix 3 warm-up
    a.onState(gWith([
      ev(0, 'moved', '0', { from: 0, to: 1, passedGo: false, routeExhausted: true, path: [1] }),
      ev(1, 'moved', '0', { from: 0, to: 1, passedGo: false, path: [1] }),
    ]));
    const hops = log.filter(l => l.startsWith('hop:'));
    expect(hops).toEqual(['hop:0@1(0/1)']); // exactly ONE hop run, from the shared emit
    expect(log.filter(l => l.startsWith('done:'))).toHaveLength(1);
  });

  // ─── Fix 1: loadGame cursor seed off-by-one ───
  test('loadGame cursor seed: reset(5) consumes seq 6 but not seq 5', () => {
    const log = []; const clock = makeClock();
    const a = createAnimator({ stage: makeStage(log), sink: makeSink(log), now: clock.now, schedule: clock.schedule, isDisabled: () => true });
    // Simulates App.js loadGame: a save whose eventSeq was 6 (post-increment,
    // "next-to-assign") seeds the cursor at eventSeq-1 = 5, i.e. the seq of the
    // LAST event actually baked into the save.
    a.reset(5);
    // The save's own last-baked event (seq 5) re-arrives on the first post-load
    // render (it's still in G.events) — must NOT replay.
    a.onState(gWith([ev(5, 'property_bought', '0', {})]));
    expect(log).toEqual([]);
    // The first genuinely NEW event after resume (seq 6) must fire.
    a.onState(gWith([ev(5, 'property_bought', '0', {}), ev(6, 'rent_paid', '1', {})]));
    expect(log).toEqual(['snd:rent_paid']);
  });

  // ─── Fix 2: enqueue-time ownership claim ───
  test('enqueue-claim: isAnimating is true immediately on delivery, before any clock tick', () => {
    const log = []; const clock = makeClock();
    const a = createAnimator({ stage: makeStage(log), sink: makeSink(log), now: clock.now, schedule: clock.schedule, isDisabled: () => false });
    a.onState(gWith([])); // Fix 3 warm-up
    a.onState(gWith([
      ev(0, 'dice_rolled', '0', { d1: 2, d2: 3, total: 5, doubles: false }),
      ev(1, 'moved', '0', { from: 0, to: 2, path: [1, 2] }),
    ]));
    // No clock.tick() at all — ownership must already be claimed synchronously.
    expect(a.isAnimating('0')).toBe(true);
  });

  test('hopQueued(actor, from) fires at delivery time, holding the token at its origin', () => {
    const log = []; const clock = makeClock();
    const a = createAnimator({ stage: makeStage(log), sink: makeSink(log), now: clock.now, schedule: clock.schedule, isDisabled: () => false });
    a.onState(gWith([])); // Fix 3 warm-up
    a.onState(gWith([ev(0, 'moved', '0', { from: 4, to: 6, path: [5, 6] })]));
    expect(log).toContain('hopQueued:0@4');
  });

  test('two queued hops for the same actor: ownership persists until the second finishes', () => {
    const log = []; const clock = makeClock();
    const a = createAnimator({ stage: makeStage(log), sink: makeSink(log), now: clock.now, schedule: clock.schedule, isDisabled: () => false });
    a.onState(gWith([])); // Fix 3 warm-up
    // Two turns' worth of moves batched into one delivery (e.g. an opponent's
    // remote turn syncing after a lag spike) — both hop jobs queue for actor 0
    // before either has a chance to play.
    a.onState(gWith([
      ev(0, 'moved', '0', { from: 0, to: 1, path: [1] }),
      ev(1, 'moved', '0', { from: 1, to: 2, path: [2] }),
    ]));
    expect(a.isAnimating('0')).toBe(true);
    clock.tick(160); // first hop job plays its single tile and finishes
    expect(log.filter(l => l === 'done:0')).toHaveLength(1);
    // The SECOND job is still queued for the same actor -> ownership must be
    // retained, not released, or renderTokens would repaint the actor at the
    // stale/final G position for the gap before the second job starts.
    expect(a.isAnimating('0')).toBe(true);
    clock.tick(160); // second hop job plays and finishes
    expect(log.filter(l => l === 'done:0')).toHaveLength(2);
    expect(a.isAnimating('0')).toBe(false); // both done -> released
  });

  // ─── Fix 3: first-sight lazy-init for the animator cursor ───
  test('first-sight absorb: first onState with a populated log fires nothing; later new events fire', () => {
    const log = []; const clock = makeClock();
    const a = createAnimator({ stage: makeStage(log), sink: makeSink(log), now: clock.now, schedule: clock.schedule, isDisabled: () => true });
    // Simulates an online mid-match join: the log already has history on the
    // very FIRST onState call this animator instance ever sees.
    a.onState(gWith([ev(0, 'property_bought', '0', {}), ev(1, 'rent_paid', '1', {})]));
    expect(log).toEqual([]); // absorbed silently, not replayed as a burst
    a.onState(gWith([ev(0, 'property_bought', '0', {}), ev(1, 'rent_paid', '1', {}), ev(2, 'card_drawn', '0', {})]));
    expect(log).toEqual(['snd:card_drawn']); // only the genuinely new event fires
  });

  test('bare reset() restores first-sight absorb for the next join/game', () => {
    const log = []; const clock = makeClock();
    const a = createAnimator({ stage: makeStage(log), sink: makeSink(log), now: clock.now, schedule: clock.schedule, isDisabled: () => true });
    a.onState(gWith([])); // warm-up: absorb empty
    a.onState(gWith([ev(0, 'property_bought', '0', {})]));
    expect(log).toEqual(['snd:property_bought']);
    a.reset();
    log.length = 0;
    // A brand-new populated log delivered right after a bare reset (e.g.
    // exit-to-menu then rejoining a different online match) must absorb
    // silently again, not replay it.
    a.onState(gWith([ev(5, 'property_bought', '0', {}), ev(6, 'rent_paid', '1', {})]));
    expect(log).toEqual([]);
  });

  test('fresh-empty-log flow still animates the very first real event (seq-0 regression guard)', () => {
    const log = []; const clock = makeClock();
    const a = createAnimator({ stage: makeStage(log), sink: makeSink(log), now: clock.now, schedule: clock.schedule, isDisabled: () => true });
    a.onState(gWith([])); // constructor-time first render: empty log -> absorb to -1
    expect(log).toEqual([]);
    a.onState(gWith([ev(0, 'property_bought', '0', {})])); // seq 0 > -1 -> fires
    expect(log).toEqual(['snd:property_bought']);
  });
});
