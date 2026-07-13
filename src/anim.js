// Event-driven animation scheduler — spec 2026-07-11 §3.1 (approach A).
// PRESENTATION-ONLY: consumes G.events via a lazy seq cursor (same pattern as
// App.js detectAndTriggerAI / character-ai.js's consumeNewEvents — INCLUDING
// consumeNewEvents' first-sight lazy-init: cursor starts `undefined`, and the
// very first onState() call absorbs whatever's already in the log silently
// (setting cursor to the log's latest seq, or -1 if empty, without firing
// anything) rather than replaying it. This matters for an online mid-match
// join, where the log is already populated on the very first render — without
// absorb, that whole window would fire as one SFX/animation burst. A bare
// reset() (loadGame's legacy fallback aside, this is exit-to-menu/gameover)
// restores the `undefined` state so the next game/session absorbs its own
// first-sight too; a seeded reset(n) (loadGame, explicit cursor) skips absorb
// and uses that cursor directly. Drives an injected `stage` (real DOM in
// App.js, fake in tests) and a `sink` (audio). Never touches game state.
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

  let cursor;                 // last consumed seq (exclusive cursor); undefined = first-sight absorb pending
  let queue = [];              // pending animation jobs (dice/hop), FIFO by seq
  let playing = null;          // current job
  let epoch = 0;               // bumped on reset/fastForward: orphans stale callbacks
  const inFlight = new Set();  // playerIds mid-hop — claimed at ENQUEUE time (see onState), not hop-start

  function pathFor(e) {
    if (e.data && e.data.path) return e.data.path.slice(); // defensive copy: event data is G-owned/frozen
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
      // Enqueue-time ownership (Fix 2): inFlight was claimed when this job (or a
      // sibling hop job for the same actor) was QUEUED in onState, not when it
      // started playing here. Release it only if no OTHER queued hop job for
      // this actor remains — a plain unconditional delete would let a second
      // still-queued hop for the same actor (e.g. two turns' worth of moves
      // batched into one onState delivery) lose ownership the moment the FIRST
      // one finishes, and renderTokens would repaint the actor at its stale/
      // final G position for the gap until the second job starts. Queue-scan
      // (not a refcount) — queues are tiny (single-digit), so this is O(1) in
      // practice and needs no extra state to keep in sync.
      const stillQueued = queue.some(j => j.kind === 'hop' && j.actor === job.actor);
      if (!stillQueued) inFlight.delete(job.actor);
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
    // hop — ownership (inFlight) was already claimed at enqueue time in onState,
    // via stage.hopQueued; nothing to claim here. See finishJob for the release side.
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
      if (cursor === undefined) {
        // First-sight lazy-init (mirrors character-ai.js's consumeNewEvents):
        // absorb whatever's already in the log WITHOUT animating/sounding any of
        // it. Empty log (fresh local game's first render) -> absorbs to -1, so
        // the real seq-0 event still fires normally on the very next call.
        // Populated log (online mid-match join) -> absorbs to the latest seq,
        // so the whole pre-existing window doesn't fire as one SFX/animation
        // burst.
        cursor = events.length ? events[events.length - 1].seq : -1;
        return;
      }
      if (events.length && events[0].seq > cursor + 1) {
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
          if (path && path.length) {
            const actor = String(e.actor);
            queue.push({ kind: 'hop', seq: e.seq, actor, path });
            // Enqueue-claim (Fix 2): stake ownership + park the token at its
            // ORIGIN the moment the job is queued, not when it starts playing.
            // Without this, renderTokens (which only skips writing a player's
            // position while isAnimating() is true) paints the token at its
            // DESTINATION for the whole dice-tumble window that plays in front
            // of this job, then it visibly snaps back to path[0] to begin the
            // walk. `stage.hopQueued` is optional (back-compat with any stage
            // fake that doesn't define it).
            inFlight.add(actor);
            if (stage.hopQueued) stage.hopQueued(actor, e.data.from);
          }
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
      // Targeted delete — LOAD-BEARING, not redundant with the inFlight.clear()
      // a few lines down: hopDone's forced App.js renderTokens() call checks
      // isAnimating(actor) SYNCHRONOUSLY, so ownership must already be gone by
      // the time hopDone fires here, or that render would still treat the actor
      // as mid-hop and skip writing its real position — stranding the token at
      // its last mid-hop tile until some later render happens to fire. Safe to
      // delete unconditionally here (unlike finishJob's queue-scanned release):
      // `queue` was just cleared above, so no sibling job for this actor can
      // still be holding a claim.
      if (playing && playing.kind === 'hop') { inFlight.delete(playing.actor); stage.hopDone(playing.actor); }
      if (playing && playing.kind === 'dice') stage.diceEnd();
      playing = null;
      inFlight.clear();
      // Bulk-release for queued-never-played hop jobs: hopQueued (onState) writes
      // stage-side placement state at ENQUEUE time, before the job ever plays, so a
      // job sitting behind another (e.g. a hop queued behind a still-playing dice
      // job) has no corresponding hopDone here to clean it up — only `playing` gets
      // one, above. Without this, that stale placement survives into the NEXT
      // game/session and reapply() (which wins over renderTokens while it thinks
      // the entry is live) force-places the token there on every render until the
      // player's first hop of the new game completes. Optional hook — old stage
      // fakes without it keep working.
      if (stage.resetAll) stage.resetAll();
      // No arg (bare reset — exit-to-menu/gameover) -> cursor becomes undefined
      // -> first-sight absorb on the next onState (fresh game / next join).
      // Explicit arg (loadGame's seeded reset) -> that exact cursor, no absorb.
      cursor = latestSeq;
    },
    isAnimating(playerId) { return inFlight.has(String(playerId)); },
    // Additive, presentation-only: "is ANYTHING animating right now" (no playerId
    // filter), for consumers that just need a generic idle predicate — e.g. the
    // local-bots paced stepper (src/bot-driver.js's `animBusy` dep) holds its next
    // dispatch while a dice/hop job is playing OR queued, same as isAnimating(id)
    // but seat-agnostic. Does not change any existing behavior/export.
    isBusy() { return playing !== null || queue.length > 0; },
    _cursor() { return cursor; },
  };
}
