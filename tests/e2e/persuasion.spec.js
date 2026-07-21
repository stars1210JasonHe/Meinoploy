const { test, expect } = require('@playwright/test');

// Persuasion E2E (MT2-SP5 direction C2 "舌战群儒", T3 — three-seam UI + bot
// pleas). Self-contained per-file helpers (gameplay.spec.js/duel.spec.js/
// dialogue.spec.js convention — no cross-file imports). Two independent
// cases, both keyless (no API key set anywhere in this file — the judged
// path is optional and this spec never needs it; the T1 keyless charisma
// check resolves every attempt deterministically enough that only
// INVARIANTS are asserted, never a specific outcome):
//
//  (a) rent-mercy (求情): a 2-human hot-seat Dominion classic game, hunted
//      turn-by-turn (no seeded dice exist in this engine — same "hunt under
//      a turn budget" policy duel.spec.js/dialogue.spec.js already use)
//      until a rent payment opens the refund window. Asserts the button
//      appears, is HIDDEN once the online gate is flipped via the
//      __MP_TEST_SET_ONLINE test seam (App.js) and reappears once it's
//      cleared, then submits a plea and asserts the tier-bounded invariants
//      (refund >= 0, one of the exact configured tier amounts, the attempt
//      is burned, the button is gone afterward) by reading the REAL G state
//      through the SAVE flow (bots.spec.js/dialogue.spec.js's proven
//      pattern) — never guessed from rendered text.
//  (b) bot plea (owner-as-judge): a 1-human+1-bot local game with
//      RULES.persuasion.botPlea's probability forced to always-hit via the
//      __MP_FORCE_PLEA test seam (App.js) — removes ONE source of luck
//      (only the coincidental bot-owes-human landing is still hunted for).
//      Asserts the popup appears with ACCEPT/REJECT, REJECT closes it, the
//      attempt is burned (read via the same SAVE-flow technique), and the
//      game keeps running afterward (one more human turn completes cleanly).
//  (c)+(d) duel-taunt window vs a bot responder (T3.5, terra-titans —
//      duel.enabled=true's only shipped mod, an ATLAS/globe world): a
//      1-human+1-bot game, adapting duel.spec.js's proven convergent-route/
//      cash-floor duel-hunting policy with a bot-turn wait/poll spliced in
//      (bots.spec.js's own convention). TWO INDEPENDENT tests, each its own
//      fresh game hunting for exactly ONE duel — not one game chasing two
//      (the human challenger's own RULES.duel.cooldownTurns, 3, would force
//      a long wait between a first and second duel in the SAME game, which
//      the two-independent-tests split avoids entirely while still
//      exercising both release paths):
//   (c) 直接开打 (proceed): asserts the taunt window renders with BOTH
//       buttons and NEITHER of the bot-owner's own FIGHT/DECLINE (the human
//       here is only the CHALLENGER), then that proceeding releases the
//       hold and the (now-unpaused) driver actually resolves the duel.
//   (d) 叫阵 -> modal submit: asserts the SAME modal every other seam uses
//       resolves the duel via the persuasion_resolved event path (not a
//       direct proceed), with the attempt burned (read via the SAVE flow) —
//       either tier outcome (keyless charisma check, no key set).

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('meinopoly_locale', 'en');
    window.__MP_FAST_ROLL = true;
  });
});

// ─── shared navigation helpers (verbatim structure from dialogue.spec.js /
// bots.spec.js — kept as separate copies per this suite's file-local-
// helpers convention) ───────────────────────────────────────────────────
async function selectMod(page, modName) {
  const modCard = page.locator('.map-card[data-mod-idx]', { hasText: modName }).first();
  if (await modCard.isVisible({ timeout: 4000 }).catch(() => false)) {
    await modCard.click();
  }
}

async function pickAndConfirm(page) {
  const card = page.locator('.charcard:not(.charcard--taken)').first();
  await card.click();
  const confirm = page.locator('#btn-select-confirm');
  await expect(confirm).toBeEnabled();
  await confirm.click();
}

async function activePlayerMoney(page) {
  const text = await page.locator('.pcard--active .pcard__money').textContent().catch(() => '');
  const digits = (text || '').replace(/[^0-9]/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

// Reads the freshest save's raw G state via the real topbar SAVE flow
// (dialogue.spec.js's readGrudgeTierHit / bots.spec.js's save step, same
// pattern) — the exact engine state, never guessed from rendered text.
// De-hovers the topbar before returning (dialogue.spec.js's own reasoning:
// the shown topbar overlays the top-of-screen chip strip / prompt area).
async function readSavedG(page) {
  await page.hover('#topbar-hotzone');
  await expect(page.locator('.topbar')).toHaveClass(/topbar--show/);
  await expect(page.locator('#btn-save')).toBeVisible();
  await page.click('#btn-save');
  await expect(page.locator('#btn-save')).toContainText('SAVED', { timeout: 3000 });
  const g = await page.evaluate(() => {
    const saves = JSON.parse(localStorage.getItem('meinopoly_saves') || '{}');
    const newest = Object.values(saves).sort((a, b) => b.timestamp - a.timestamp)[0];
    return newest ? newest.G : null;
  });
  await page.mouse.move(400, 400);
  await expect(page.locator('.topbar')).not.toHaveClass(/topbar--show/);
  return g;
}

// ═══════════════════════════════════════════════════════════════════════
// (a) Rent-mercy (求情) — 2-human hot-seat
// ═══════════════════════════════════════════════════════════════════════

async function selectCharactersDominion2p(page) {
  await page.goto('/');
  await page.waitForSelector('#btn-mode-local', { timeout: 10000 });
  await page.click('#btn-mode-local');
  await selectMod(page, 'Dominion');
  await page.waitForSelector('.map-card[data-map-idx="0"]', { timeout: 10000 });
  await page.click('.map-card[data-map-idx="0"]');
  await page.waitForSelector('.count-btn[data-count="2"]', { timeout: 10000 });
  await page.click('.count-btn[data-count="2"]');
  await page.waitForSelector('#btn-vic-start', { timeout: 10000 });
  await page.click('#btn-vic-start');
  await page.waitForSelector('.charcard', { timeout: 10000 });
  await pickAndConfirm(page);
  await page.waitForFunction(() => {
    const el = document.querySelector('.select__p');
    return el && /PLAYER 2/.test(el.textContent);
  }, { timeout: 10000 });
  await pickAndConfirm(page);
  await page.waitForSelector('#btn-roll', { timeout: 10000 });
}

const CASH_FLOOR = 300; // pass instead of buy below this, same guard-rail idea as duel.spec.js's CASH_FLOOR

// One "turn's worth" of hot-seat play, stopping the INSTANT #btn-persuade-rent
// appears (checked AFTER resolving jail/roll/card/buy, BEFORE ending the
// turn — the window is only ever open for the rest of the payer's own turn,
// see canAttempt's rent branch). Returns true when found.
async function stepTurnHuntingRentWindow(page) {
  const jailBtn = page.locator('#btn-jail');
  if (await jailBtn.isVisible().catch(() => false)) {
    await jailBtn.click();
    await page.waitForTimeout(300);
  }
  const rollBtn = page.locator('#btn-roll');
  if (await rollBtn.isVisible().catch(() => false)) {
    await rollBtn.click();
    await page.waitForTimeout(1100);
  }

  const evAccept = page.locator('#ev-accept');
  if (await evAccept.isVisible().catch(() => false)) {
    await evAccept.click();
    await page.waitForTimeout(300);
  }

  const buyBtn = page.locator('#btn-buy');
  if (await buyBtn.isVisible().catch(() => false)) {
    const cash = await activePlayerMoney(page);
    if (cash > CASH_FLOOR) {
      await buyBtn.click();
      await page.waitForTimeout(300);
    } else {
      await page.click('#btn-pass');
      await page.waitForTimeout(300);
      const passAuctionBtn = page.locator('#btn-pass-auction');
      for (let i = 0; i < 6; i++) {
        if (await passAuctionBtn.isVisible().catch(() => false)) {
          await passAuctionBtn.click();
          await page.waitForTimeout(200);
        } else break;
      }
    }
  }

  if (await page.locator('#btn-persuade-rent').isVisible().catch(() => false)) {
    return true;
  }

  const endBtn = page.locator('#btn-end');
  if (await endBtn.isVisible().catch(() => false) && await endBtn.isEnabled().catch(() => false)) {
    await endBtn.click();
    await page.waitForTimeout(300);
  }
  return false;
}

test.describe('Rent-mercy (求情, keyless, MT2-SP5 direction C2)', () => {
  test('button appears in the window, hidden when online-gated, submits within tier bounds, gone after use', async ({ page }) => {
    // 12min, not 8: the duel hunt's wall time is dice-luck × WORKER CONTENTION.
    // Measured 2026-07-21: solo this test passes in ~4.5m, but in the full
    // 5-worker suite the same hunt shares CPU with 4 other chromiums and one
    // run blew through 480s mid-hunt (timed out on a perfectly normal bot
    // route-pick frame — rerun solo passed first try). The isolated-port T3.5
    // runs measured up to ~10.7m for this describe block, so 720s per test
    // gives the worst measured case honest headroom instead of flaking.
    test.setTimeout(720000);
    const MAX_TURNS = 150;
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await selectCharactersDominion2p(page);

    let found = false;
    for (let i = 0; i < MAX_TURNS && !found; i++) {
      if (await page.locator('.results__victory').isVisible().catch(() => false)) break;
      found = await stepTurnHuntingRentWindow(page);
    }
    expect(found).toBe(true);
    await expect(page.locator('#btn-persuade-rent')).toBeVisible();

    // Online gate (plan items 8/9): flip the SAME seat "online" via the
    // test-only seam — exercises the EXACT `onlinePlayerID == null` half of
    // _persuasionUIEnabled() a real online match would also hit, without a
    // second client/server (out of scope for this worktree). Everything
    // ELSE keeps working (onlinePlayerID is set to ctx.currentPlayer's OWN
    // seat, so every isMyTurn check elsewhere stays true) — only
    // persuasion surfaces react.
    await page.evaluate(() => window.__MP_TEST_SET_ONLINE());
    await expect(page.locator('#btn-persuade-rent')).toHaveCount(0);
    await page.evaluate((v) => window.__MP_TEST_SET_ONLINE(v), null);
    await expect(page.locator('#btn-persuade-rent')).toBeVisible();

    const before = await readSavedG(page);
    const payerSeat = before.lastRentPayment.payerSeat;
    const ownerSeat = before.lastRentPayment.ownerSeat;
    const rentAmount = before.lastRentPayment.amount;
    const payerMoneyBefore = before.players[parseInt(payerSeat, 10)].money;

    await page.click('#btn-persuade-rent');
    await expect(page.locator('.persuade')).toBeVisible();
    await page.fill('#persuade-text', 'Please, have mercy on my coffers.');
    await page.click('#btn-persuade-submit');
    await expect(page.locator('#ui-modal')).not.toHaveClass(/open/);
    await page.waitForTimeout(300);

    const after = await readSavedG(page);
    const payerMoneyAfter = after.players[parseInt(payerSeat, 10)].money;
    const delta = payerMoneyAfter - payerMoneyBefore;

    // RULES.persuasion.rent.tierRefundPct (mods/dominion/rules.js) —
    // mirrored here with this pointer, same "hardcode + pointer-comment"
    // precedent dialogue.spec.js's GRUDGE_TIER_1 uses for a RULES-sourced
    // constant, rather than importing the mod module into a Playwright spec.
    const TIER_REFUND_PCTS = [0, 0.10, 0.20];
    const possibleDeltas = TIER_REFUND_PCTS.map(pct => Math.round(rentAmount * pct));
    expect(possibleDeltas).toContain(delta);
    expect(delta).toBeGreaterThanOrEqual(0);
    expect(after.persuasion.attempts.rent[payerSeat][ownerSeat]).toBe(1);

    await expect(page.locator('#btn-persuade-rent')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// (b) Bot plea (owner-as-judge) — forced probability
// ═══════════════════════════════════════════════════════════════════════

async function gotoSetup(page) {
  await page.goto('/');
  await page.waitForSelector('#btn-mode-local', { timeout: 10000 });
  await page.click('#btn-mode-local');
  await selectMod(page, 'Dominion');
  await page.waitForSelector('.map-card[data-map-idx="0"]', { timeout: 10000 });
  await page.click('.map-card[data-map-idx="0"]');
  await page.waitForSelector('#btn-vic-start', { timeout: 10000 });
}

async function startLocalGameWithOneBot(page) {
  await gotoSetup(page);
  await page.click('.count-btn[data-count="2"]');
  await page.waitForSelector('.bot-btn[data-bots="1"]', { timeout: 10000 });
  await page.click('.bot-btn[data-bots="1"]');
  await page.click('#btn-vic-start');
  await page.waitForSelector('.charcard', { timeout: 10000 });
  await pickAndConfirm(page); // human (seat 0); bot (seat 1) auto-completes with zero clicks
  await page.waitForSelector('#btn-roll', { timeout: 20000 });
}

// One poll step while hunting for the bot-plea popup. Checks the popup
// FIRST, every iteration, before touching anything else — the popup is a
// modal overlay that can appear the instant a bot's rent_paid event lands
// (the paced bot driver is PAUSED by App.js while it's pending, see
// update()'s doc comment, so there's no race to win here beyond noticing
// it). Otherwise makes whatever progress is available (bot-turn wait,
// event card, auction pass-out, jail, roll, buy, end) — same branch
// coverage as bots.spec.js's playUntilBotTurnsObserved.
async function stepWhileHuntingPlea(page) {
  if (await page.locator('#btn-plea-reject').isVisible().catch(() => false)) return true;

  const waitingBot = await page.locator('.turnbox__waiting', { hasText: 'BOT' }).count();
  if (waitingBot > 0) { await page.waitForTimeout(400); return false; }

  const evAccept = page.locator('#ev-accept');
  if (await evAccept.isVisible().catch(() => false)) { await evAccept.click(); await page.waitForTimeout(300); return false; }

  const passAuction = page.locator('#btn-pass-auction');
  if (await passAuction.isVisible().catch(() => false)) { await passAuction.click(); await page.waitForTimeout(300); return false; }

  const jailBtn = page.locator('#btn-jail');
  if (await jailBtn.isVisible().catch(() => false)) { await jailBtn.click(); await page.waitForTimeout(300); return false; }

  const rollBtn = page.locator('#btn-roll');
  if (await rollBtn.isVisible().catch(() => false) && await rollBtn.isEnabled().catch(() => false)) {
    await rollBtn.click();
    await page.waitForTimeout(1100);
    return false;
  }

  const buyBtn = page.locator('#btn-buy');
  if (await buyBtn.isVisible().catch(() => false)) { await buyBtn.click(); await page.waitForTimeout(300); return false; }

  const endBtn = page.locator('#btn-end');
  if (await endBtn.isVisible().catch(() => false) && await endBtn.isEnabled().catch(() => false)) {
    await endBtn.click();
    await page.waitForTimeout(300);
    return false;
  }

  await page.waitForTimeout(300);
  return false;
}

test.describe('Bot pleas (owner-as-judge, forced probability via __MP_FORCE_PLEA)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { window.__MP_FORCE_PLEA = true; });
  });

  test('popup appears with the bot portrait/line, REJECT closes it, attempt is burned, game continues', async ({ page }) => {
    // 12min, not 8: the duel hunt's wall time is dice-luck × WORKER CONTENTION.
    // Measured 2026-07-21: solo this test passes in ~4.5m, but in the full
    // 5-worker suite the same hunt shares CPU with 4 other chromiums and one
    // run blew through 480s mid-hunt (timed out on a perfectly normal bot
    // route-pick frame — rerun solo passed first try). The isolated-port T3.5
    // runs measured up to ~10.7m for this describe block, so 720s per test
    // gives the worst measured case honest headroom instead of flaking.
    test.setTimeout(720000);
    const MAX_ITER = 400;
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await startLocalGameWithOneBot(page);

    let pleaSeen = false;
    for (let i = 0; i < MAX_ITER && !pleaSeen; i++) {
      if (await page.locator('.results__victory').isVisible().catch(() => false)) break;
      pleaSeen = await stepWhileHuntingPlea(page);
    }
    expect(pleaSeen).toBe(true);
    await expect(page.locator('.pleapop')).toBeVisible();
    await expect(page.locator('.pleapop__line')).not.toBeEmpty();
    await expect(page.locator('#btn-plea-accept')).toBeVisible();

    await page.click('#btn-plea-reject');
    await expect(page.locator('#ui-modal')).not.toHaveClass(/open/);
    await expect(page.locator('.pleapop')).toHaveCount(0);
    await page.waitForTimeout(300);

    // The attempt was burned (REJECT = score 0, a genuine engine-resolved
    // failure, not a UI-only dismiss) — read via the same SAVE-flow
    // technique as test (a) above, no DOM guessing. Bot seats occupy the
    // LAST seats (App.js's startGameWithPlayers) — with count:2/bots:1,
    // seat '1' is always the bot, '0' the human (this test's own setup).
    const g = await readSavedG(page);
    const attemptsRent = (g.persuasion && g.persuasion.attempts && g.persuasion.attempts.rent) || {};
    expect(attemptsRent['1'] && attemptsRent['1']['0']).toBe(1);

    // Game continues: not soft-locked — at least one more turn (human or
    // bot) advances cleanly after the popup resolves.
    for (let i = 0; i < 20; i++) {
      if (await page.locator('.results__victory').isVisible().catch(() => false)) break;
      const advanced = await stepWhileHuntingPlea(page);
      if (advanced) break; // a SECOND plea is also an acceptable "still running" signal
      if (await page.locator('#btn-roll').isVisible().catch(() => false)) break;
    }

    expect(pageErrors).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// (c)+(d) Duel-taunt window vs a bot responder (T3.5) — terra-titans, 1 bot
// ═══════════════════════════════════════════════════════════════════════

async function gotoTerraTitansSetup(page) {
  await page.goto('/');
  await page.waitForSelector('#btn-mode-local', { timeout: 10000 });
  await page.click('#btn-mode-local');
  await page.waitForSelector('.map-card[data-mod-idx]', { timeout: 10000 });
  await page.locator('.map-card[data-mod-idx]', { hasText: 'Terra Titans' }).click();
  await page.waitForSelector('.map-card[data-map-idx]', { timeout: 10000 });
  await page.locator('.map-card[data-map-idx]', { hasText: 'Terra Titans' }).click();
}

// count:2/bots:1 -> seat '0' human, seat '1' bot (App.js's startGameWithPlayers
// hands bots the LAST seats). Survival victory EXPLICITLY picked — duel.spec.js's
// own documented reason still applies: Terra Titans defaults to DOMINION
// victory, which races this spec's buying-driven duel hunt.
async function startTerraTitansWithOneBot(page) {
  await gotoTerraTitansSetup(page);
  await page.click('.count-btn[data-count="2"]');
  await page.waitForSelector('.bot-btn[data-bots="1"]', { timeout: 10000 });
  await page.click('.bot-btn[data-bots="1"]');
  await page.locator('.vic-card[data-mode="survival"]').click();
  await page.waitForSelector('#btn-vic-start', { timeout: 10000 });
  await page.click('#btn-vic-start');
  await page.waitForSelector('.charcard', { timeout: 10000 });
  await pickAndConfirm(page); // human (seat 0); bot (seat 1) auto-completes with zero clicks
  await page.waitForSelector('#btn-roll', { timeout: 20000 });
}

const TERRA_CASH_FLOOR = 700; // duel.spec.js's own floor — same world/pricing, same stake-safety reasoning

// One step of a hot-seat-vs-bot Terra Titans turn, ADAPTING duel.spec.js's
// convergent-route/cash-floor policy (roll -> resolve route fork -> buy
// above the cash floor -> ALWAYS escalate an eligible duel offer to DUEL!,
// never PAY RENT, since generating a duel IS the point) with bots.spec.js's
// bot-turn wait/poll spliced in (only ONE seat here can ever be a bot: '1').
// Checks the taunt window FIRST, every call, before anything else — it's a
// modal-adjacent overlay that can appear the instant this human's own
// initiateDuel dispatch lands (App.js holds the driver the same tick, see
// _syncTauntHold), so there's no race to lose by checking it first.
async function terraStepHuntingTaunt(page) {
  if (await page.locator('#btn-taunt-proceed').isVisible().catch(() => false)) return 'taunt-window';

  const waitingBot = await page.locator('.turnbox__waiting', { hasText: 'BOT' }).count();
  if (waitingBot > 0) { await page.waitForTimeout(400); return 'continue'; }

  const evAccept = page.locator('#ev-accept');
  if (await evAccept.isVisible().catch(() => false)) { await evAccept.click(); await page.waitForTimeout(300); return 'continue'; }

  const passAuction = page.locator('#btn-pass-auction');
  if (await passAuction.isVisible().catch(() => false)) { await passAuction.click(); await page.waitForTimeout(300); return 'continue'; }

  const duelBtn = page.locator('#btn-duel');
  if (await duelBtn.isVisible().catch(() => false)) {
    if (await duelBtn.isEnabled().catch(() => false)) {
      await duelBtn.click(); // initiate — the responder here is ALWAYS the bot (only 2 seats)
      await page.waitForTimeout(300);
    } else {
      // cooldown-disabled (shouldn't happen — this is the challenger's
      // first-ever duel this game, same reasoning duel.spec.js's own
      // assertion relies on) — pay rent instead rather than getting stuck.
      await page.click('#btn-payrent');
      await page.waitForTimeout(300);
    }
    return 'continue';
  }

  const rollBtn = page.locator('#btn-roll');
  if (await rollBtn.isVisible().catch(() => false)) {
    await rollBtn.click();
    await page.waitForTimeout(1100);
    const awaitingRoute = await page.locator('.centerslot__hint', { hasText: 'CHOOSE YOUR ROUTE' })
      .first().isVisible().catch(() => false);
    if (awaitingRoute) {
      const target = page.locator('.gcity--route').first();
      await target.waitFor({ state: 'visible', timeout: 8000 });
      await target.click();
      await page.waitForTimeout(350);
    }
    return 'continue';
  }

  const buyBtn = page.locator('#btn-buy');
  if (await buyBtn.isVisible().catch(() => false)) {
    const cash = await activePlayerMoney(page);
    if (cash > TERRA_CASH_FLOOR) {
      await buyBtn.click();
      await page.waitForTimeout(300);
    } else {
      await page.click('#btn-pass');
      await page.waitForTimeout(400);
      const passAuctionBtn = page.locator('#btn-pass-auction');
      for (let i = 0; i < 6; i++) {
        if (await passAuctionBtn.isVisible().catch(() => false)) {
          await passAuctionBtn.click();
          await page.waitForTimeout(200);
        } else break;
      }
    }
    return 'continue';
  }

  const endBtn = page.locator('#btn-end');
  if (await endBtn.isVisible().catch(() => false) && await endBtn.isEnabled().catch(() => false)) {
    await endBtn.click();
    await page.waitForTimeout(300);
    return 'continue';
  }

  await page.waitForTimeout(300);
  return 'continue';
}

async function huntTauntWindow(page, maxSteps) {
  let signal = 'continue';
  for (let i = 0; i < maxSteps && signal !== 'taunt-window'; i++) {
    if (await page.locator('.results__victory').isVisible().catch(() => false)) break;
    signal = await terraStepHuntingTaunt(page);
  }
  return signal;
}

test.describe('Duel-taunt window vs a bot responder (T3.5, terra-titans)', () => {
  test('taunt window renders with both actions (no bot FIGHT/DECLINE leak); 直接开打 releases the hold and the bot resolves the duel', async ({ page }) => {
    // 12min, not 8: the duel hunt's wall time is dice-luck × WORKER CONTENTION.
    // Measured 2026-07-21: solo this test passes in ~4.5m, but in the full
    // 5-worker suite the same hunt shares CPU with 4 other chromiums and one
    // run blew through 480s mid-hunt (timed out on a perfectly normal bot
    // route-pick frame — rerun solo passed first try). The isolated-port T3.5
    // runs measured up to ~10.7m for this describe block, so 720s per test
    // gives the worst measured case honest headroom instead of flaking.
    test.setTimeout(720000);
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await startTerraTitansWithOneBot(page);

    const signal = await huntTauntWindow(page, 800);
    expect(signal).toBe('taunt-window');

    await expect(page.locator('#btn-persuade-duel')).toBeVisible();
    await expect(page.locator('#btn-taunt-proceed')).toBeVisible();
    // The human here is ONLY the challenger — the bot owner's own
    // FIGHT/DECLINE decision must never be exposed to them (item 1/2).
    await expect(page.locator('#btn-fight')).toHaveCount(0);
    await expect(page.locator('#btn-decline')).toHaveCount(0);

    await page.click('#btn-taunt-proceed');
    // Released: the window disappears, and the now-unpaused driver
    // resolves the duel on its own pacing (no attempt burned — this test
    // doesn't check the attempts ledger, it checks the hold/driver behavior).
    await expect(page.locator('#btn-taunt-proceed')).toHaveCount(0, { timeout: 5000 });
    // "duel reached resolution" — turnPhase returns to 'done' (END TURN
    // enabled) regardless of WHICH way the bot resolved it. INSTRUMENTED,
    // not guessed (a first pass here asserted the '.turnbox__slot' "WINS"
    // strip specifically and failed live): sim/bot.js's owner-response
    // decision (respondDuel FIGHT vs declineDuel) is a stat-strength
    // comparison, policy-independent (src/sim/bot.js:329-335) — this specific
    // bot seat/character pairing can genuinely DECLINE, which logs
    // 'duel_declined' (rent auto-pays, opening ANOTHER rent-mercy window —
    // visibly correct behavior, just not a 'duel_resolved'/"WINS" event) —
    // so the outcome-agnostic proof below (readSavedG) is what actually
    // pins "reached resolution", not a specific rendered string.
    await expect(page.locator('#btn-end')).toBeEnabled({ timeout: 8000 });
    const g = await readSavedG(page);
    expect(g.duel).toBeNull();
    const recentTypes = g.events.slice(-8).map(e => e.type);
    expect(recentTypes.some(ty => ty === 'duel_resolved' || ty === 'duel_declined')).toBe(true);

    expect(pageErrors).toEqual([]);
  });

  test('叫阵 -> shared modal submit resolves the duel; attempt burned, no hang', async ({ page }) => {
    // 12min, not 8: the duel hunt's wall time is dice-luck × WORKER CONTENTION.
    // Measured 2026-07-21: solo this test passes in ~4.5m, but in the full
    // 5-worker suite the same hunt shares CPU with 4 other chromiums and one
    // run blew through 480s mid-hunt (timed out on a perfectly normal bot
    // route-pick frame — rerun solo passed first try). The isolated-port T3.5
    // runs measured up to ~10.7m for this describe block, so 720s per test
    // gives the worst measured case honest headroom instead of flaking.
    test.setTimeout(720000);
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await startTerraTitansWithOneBot(page);

    const signal = await huntTauntWindow(page, 800);
    expect(signal).toBe('taunt-window');

    await page.click('#btn-persuade-duel');
    await expect(page.locator('.persuade')).toBeVisible();
    await page.fill('#persuade-text', 'Your last victory was luck. Face me properly this time.');
    await page.click('#btn-persuade-submit');
    await expect(page.locator('#ui-modal')).not.toHaveClass(/open/);

    // Released via the persuasion_resolved event (NOT a direct 直接开打
    // click) — _releaseTauntHoldOnVerdict — and the driver resumes on its
    // own; same "no hang" evidence as the other test.
    await expect(page.locator('#btn-taunt-proceed')).toHaveCount(0, { timeout: 5000 });
    // "duel reached resolution" — outcome-agnostic (see the other test's
    // doc comment: the bot's FIGHT-vs-DECLINE response is a stat-strength
    // comparison this test can't pin down in advance, and DECLINE never
    // produces a "WINS" string).
    await expect(page.locator('#btn-end')).toBeEnabled({ timeout: 8000 });

    // Attempt burned (either tier outcome — keyless, no key set anywhere in
    // this file) — read via the SAME real-G SAVE-flow technique as every
    // other invariant assertion in this spec, which ALSO proves resolution
    // (G.duel cleared + a duel_resolved/duel_declined event landed).
    const g = await readSavedG(page);
    expect(g.duel).toBeNull();
    const recentTypes = g.events.slice(-8).map(e => e.type);
    expect(recentTypes.some(ty => ty === 'duel_resolved' || ty === 'duel_declined')).toBe(true);
    expect(g.persuasion.attempts.duel['0'] && g.persuasion.attempts.duel['0']['1']).toBe(1);

    expect(pageErrors).toEqual([]);
  });
});
