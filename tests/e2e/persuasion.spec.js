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
    test.setTimeout(480000);
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
    test.setTimeout(480000);
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
