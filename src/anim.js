// Event-driven animation scheduler — spec 2026-07-11 §3.1 (approach A).
// PRESENTATION-ONLY: consumes G.events via a lazy seq cursor (same pattern as
// App.js detectAndTriggerAI), drives an injected `stage` (real DOM in App.js,
// fake in tests) and a `sink` (audio). Never touches game state.
export const HOP_MS = 160;
export const DICE_TUMBLE_MS = 700;
export const DICE_HOLD_MS = 400;
export const QUEUE_FAST_FORWARD_DEPTH = 6;

// Clockwise walk on a loop board, exclusive of `from`, inclusive of `to`.
export function deriveLoopPath(from, to, boardSize) {
  if (from === to) return [];
  const path = [];
  let p = from;
  do { p = (p + 1) % boardSize; path.push(p); } while (p !== to && path.length <= boardSize);
  return path;
}

export function createAnimator(opts) {
  const stage = opts.stage;
  const sink = opts.sink;
  const now = opts.now || (() => Date.now());
  const schedule = opts.schedule || ((fn, ms) => setTimeout(fn, ms));
  const isDisabled = opts.isDisabled || (() => false);
  const boardSize = opts.boardSize || (() => 0);

  let cursor = -1;            // last consumed seq (exclusive cursor)
  let queue = [];             // pending animation jobs (dice/hop), FIFO by seq
  let playing = null;         // current job
  let epoch = 0;              // bumped on reset/fastForward: orphans stale callbacks
  const inFlight = new Set(); // playerIds mid-hop

  function pathFor(e) {
    if (e.data && e.data.path) return e.data.path;
    const n = boardSize();
    if (n > 0 && e.data && e.data.from !== undefined && e.data.to !== undefined
        && e.data.from !== e.data.to) {
      return deriveLoopPath(e.data.from, e.data.to, n);
    }
    return null; // teleports (jail/goto) don't walk
  }

  function finishJob(job, instant) {
    if (job.kind === 'dice') stage.diceEnd();
    else {
      if (instant && job.path.length) stage.hopTo(job.actor, job.path[job.path.length - 1], job.path.length - 1, job.path.length);
      inFlight.delete(job.actor);
      stage.hopDone(job.actor);
    }
  }

  function runNext() {
    playing = null;
    if (!queue.length) return;
    const job = queue.shift();
    playing = job;
    const myEpoch = epoch;
    if (job.kind === 'dice') {
      sink.dice();
      stage.diceStart(job.d1, job.d2);
      if (isDisabled()) { finishJob(job); runNext(); return; }
      schedule(() => { if (myEpoch !== epoch) return; finishJob(job); runNext(); }, DICE_TUMBLE_MS + DICE_HOLD_MS);
      return;
    }
    // hop
    inFlight.add(job.actor);
    if (isDisabled()) {
      job.path.forEach((pos, i) => { stage.hopTo(job.actor, pos, i, job.path.length); sink.hop(i); });
      finishJob(job); runNext(); return;
    }
    let i = 0;
    const step = () => {
      if (myEpoch !== epoch) return;
      stage.hopTo(job.actor, job.path[i], i, job.path.length);
      sink.hop(i);
      i++;
      // finish IMMEDIATELY after the last tile lands — the tests assert
      // done:<pid> in the same tick as the final hopTo, not one HOP_MS later.
      if (i >= job.path.length) { finishJob(job); runNext(); return; }
      schedule(step, HOP_MS);
    };
    schedule(step, HOP_MS);
  }

  function drainInstantly(keepLast) {
    // complete current + all but the last `keepLast` queued jobs immediately
    epoch++;
    if (playing) { finishJob(playing, true); playing = null; }
    while (queue.length > keepLast) finishJob(queue.shift(), true);
    if (queue.length) runNext();
  }

  return {
    onState(G) {
      const events = G.events || [];
      if (events.length && events[0].seq > cursor + 1 && cursor !== -1) {
        // front-trim gap: jump — replaying a partial window would misorder.
        cursor = events[0].seq - 1;
      }
      const fresh = events.filter(e => e.seq > cursor);
      if (!fresh.length) return;
      cursor = events[events.length - 1].seq;
      fresh.forEach(e => {
        if (e.type === 'moved' && e.data && e.data.routeExhausted) {
          // Route-exhausted atlas notice: performMove's shared emit that
          // ALWAYS follows carries the identical path and is the one that
          // animates. Without this skip, one atlas walk queues two hop jobs
          // for the same path -> double animation. Fully silent: not even
          // forwarded to sink.event.
          return;
        }
        if (e.type === 'dice_rolled') {
          queue.push({ kind: 'dice', seq: e.seq, d1: e.data.d1, d2: e.data.d2 });
        } else if (e.type === 'moved') {
          const path = pathFor(e);
          if (path && path.length) queue.push({ kind: 'hop', seq: e.seq, actor: String(e.actor), path });
        } else {
          sink.event(e);
        }
      });
      if (queue.length + (playing ? 1 : 0) > QUEUE_FAST_FORWARD_DEPTH) drainInstantly(2);
      if (!playing) runNext();
    },
    afterRender() { stage.reapply(); },
    fastForward() { drainInstantly(0); },
    reset(latestSeq) {
      epoch++;
      queue = [];
      if (playing && playing.kind === 'hop') { inFlight.delete(playing.actor); stage.hopDone(playing.actor); }
      if (playing && playing.kind === 'dice') stage.diceEnd();
      playing = null;
      inFlight.clear();
      cursor = latestSeq !== undefined ? latestSeq : -1;
    },
    isAnimating(playerId) { return inFlight.has(String(playerId)); },
    _cursor() { return cursor; },
  };
}
