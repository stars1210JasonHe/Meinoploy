const { test, expect } = require('@playwright/test');

// ─────────────────────────────────────────────────────────────
// Local-bots unattended-play E2E (Task 3 of the local-bots plan).
//
// Per-file setup helpers, NOT exported — same convention as gameplay.spec.js
// (read first): each spec file keeps its own copies rather than sharing a
// helper module. Flow this file exercises end-to-end: hero -> LOCAL ->
// Dominion mod -> classic map -> SETUP (count 3, BOTS 2) -> human (seat 0)
// picks a character, bot seats (1 and 2 — App.js's startGameWithPlayers hands
// the LAST seats to bots) auto-complete character select with zero clicks ->
// bots play multiple of their own turns completely unattended -> the human's
// own turn stays interactive -> save/reload/load preserves bot badges and the
// driver resumes autonomous play with no further human input.
// ─────────────────────────────────────────────────────────────

async function selectMod(page, modName) {
  const modCard = page.locator('.map-card[data-mod-idx]', { hasText: modName }).first();
  if (await modCard.isVisible({ timeout: 4000 }).catch(() => false)) {
    await modCard.click();
  }
}

// hero -> LOCAL -> Dominion -> classic map (data-map-idx 0) -> lands on the
// merged SETUP screen (player count / BOTS / victory).
async function gotoSetup(page) {
  await page.goto('/');
  await page.waitForSelector('#btn-mode-local', { timeout: 10000 });
  await page.click('#btn-mode-local');
  await selectMod(page, 'Dominion');
  await page.waitForSelector('.map-card[data-map-idx="0"]', { timeout: 10000 });
  await page.click('.map-card[data-map-idx="0"]');
  await page.waitForSelector('#btn-vic-start', { timeout: 10000 });
}

// Sets total player count and bot count on the SETUP screen, then starts.
// The BOTS row's data-bots options are 0..count-1 and only exist once the
// matching count is selected (App.js's _renderSetup rebuilds botBtns off
// s.playerCount), so count must be clicked BEFORE the bot-btn is queried.
async function startLocalGameWithBots(page, { count, bots }) {
  await gotoSetup(page);
  await page.click(`.count-btn[data-count="${count}"]`);
  await page.waitForSelector(`.bot-btn[data-bots="${bots}"]`, { timeout: 10000 });
  await page.click(`.bot-btn[data-bots="${bots}"]`);
  await page.click('#btn-vic-start');
  await page.waitForSelector('.charcard', { timeout: 10000 });
}

// Two-step pick (preview then confirm) — same pattern as gameplay.spec.js's
// pickAndConfirm. Only ever used for the HUMAN seat in this file: bot seats
// auto-complete via the driver with zero clicks.
async function pickAndConfirm(page) {
  const card = page.locator('.charcard:not(.charcard--taken)').first();
  await card.click();
  const confirm = page.locator('#btn-select-confirm');
  await expect(confirm).toBeEnabled();
  await confirm.click();
}

// Resolves the human's CURRENT turn end-to-end: roll, accept any event card,
// buy whatever's offered, end turn. Always buys (rather than passing into an
// auction) to keep the human seat out of any auction the bots might also be
// bidding in — minimizes cross-seat timing noise in what this spec is
// actually trying to observe (unattended BOT turns).
async function completeHumanTurn(page) {
  const rollBtn = page.locator('#btn-roll');
  if (await rollBtn.isVisible().catch(() => false)) {
    await rollBtn.click();
    await page.waitForTimeout(1100); // ~0.9s dice animation + dispatch, same wait gameplay.spec.js uses
  }
  const evAccept = page.locator('#ev-accept');
  if (await evAccept.isVisible().catch(() => false)) {
    await evAccept.click();
    await page.waitForTimeout(300);
  }
  const buyBtn = page.locator('#btn-buy');
  if (await buyBtn.isVisible().catch(() => false)) {
    await buyBtn.click();
    await page.waitForTimeout(300);
  }
  const endBtn = page.locator('#btn-end');
  if (await endBtn.isVisible().catch(() => false) && await endBtn.isEnabled().catch(() => false)) {
    await endBtn.click();
    await page.waitForTimeout(300);
  }
}

// Reads the "Turn N" (or "T N/max") counter off the season strip — G.totalTurns,
// bumped once per player turn in turn.onBegin (Game.js:1258). Returns null if
// the strip isn't present/parsable yet.
async function readTurnNumber(page) {
  const text = await page.locator('.board__season-turns').textContent().catch(() => '');
  const m = text && text.match(/(?:Turn|T)\s*(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// Drives the game forward — clicking ONLY when it's the human's own turn, to
// unblock the bots (they occupy the LAST seats and can only act once turn
// order reaches them; a fresh game always starts on the human's own turn) —
// until at least `minBotTurns` DISTINCT turn numbers have been observed with a
// BOT as the active chip (.pcard--active .pcard__bot). Every bot turn itself
// is left completely unattended: this loop never clicks anything while a bot
// is acting, it only polls. Returns once the target is met AND control is
// back on the human's own turn (roll button visible), so the caller can do
// its own explicit, isolated interactivity assertion — per the task-3 brief's
// flow ("let bots play" as a distinct step from "assert roll enabled + click").
async function playUntilBotTurnsObserved(page, minBotTurns, maxIterations) {
  const botTurnsSeen = new Set();
  for (let i = 0; i < maxIterations; i++) {
    const turnNum = await readTurnNumber(page);
    const activeIsBot = await page.locator('.pcard--active .pcard__bot').count();
    if (activeIsBot > 0 && turnNum !== null) botTurnsSeen.add(turnNum);

    const rollBtn = page.locator('#btn-roll');
    const rollVisible = await rollBtn.isVisible().catch(() => false);
    if (botTurnsSeen.size >= minBotTurns && rollVisible) return botTurnsSeen;

    // A bot (its own turn, or a cross-seat state targeting a bot) is acting —
    // App.js's renderTurnbox shows this hint and renders NO actionable button
    // row at all (see App.js's deriveActingSeat-gated branch in
    // renderTurnbox). Just wait and poll again; zero clicks here.
    const waitingBot = await page.locator('.turnbox__waiting', { hasText: 'BOT' }).count();
    if (waitingBot > 0) { await page.waitForTimeout(400); continue; }

    const evAccept = page.locator('#ev-accept');
    if (await evAccept.isVisible().catch(() => false)) { await evAccept.click(); await page.waitForTimeout(250); continue; }

    if (rollVisible && await rollBtn.isEnabled().catch(() => false)) {
      await rollBtn.click();
      await page.waitForTimeout(1100);
      continue;
    }

    const buyBtn = page.locator('#btn-buy');
    if (await buyBtn.isVisible().catch(() => false)) { await buyBtn.click(); await page.waitForTimeout(300); continue; }

    const endBtn = page.locator('#btn-end');
    if (await endBtn.isVisible().catch(() => false) && await endBtn.isEnabled().catch(() => false)) {
      await endBtn.click();
      await page.waitForTimeout(300);
      continue;
    }

    await page.waitForTimeout(300);
  }
  return botTurnsSeen;
}

// Make the dice roll INSTANT in E2E — same init script gameplay.spec.js uses
// (App.js's _animateRollThenMove reads this flag and skips the ~0.9s tumble).
// Registered per-test via addInitScript, which re-applies on every navigation
// within the test, including the page.reload() this spec does for save/load.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { window.__MP_FAST_ROLL = true; });
});

test.describe('Local bots — unattended play', () => {
  test('bot seats auto-pick + play unattended; human stays interactive; bots resume after save/reload/load', async ({ page }) => {
    test.setTimeout(240000); // bot pacing is 700-1100ms/step across several bot turns — needs headroom
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await startLocalGameWithBots(page, { count: 3, bots: 2 });

    // Human (seat 0) picks; bot seats 1 and 2 must auto-complete without ANY
    // click here — the whole point of this assertion.
    await pickAndConfirm(page);
    await page.waitForSelector('#btn-roll', { timeout: 20000 });

    // Both bot chips carry the BOT badge (App.js's chipHtml -> .pcard__bot,
    // isBot: this._isBotSeat(i)).
    await expect(page.locator('.pcard__bot')).toHaveCount(2);

    // Let the bots play unattended across >=2 of their own turns. The human's
    // own turns are driven minimally here just to unblock turn order — the
    // thing under test is that the BOT turns themselves take zero clicks.
    const botTurnsSeen = await playUntilBotTurnsObserved(page, 2, 400);
    expect(botTurnsSeen.size).toBeGreaterThanOrEqual(2);

    // Human interactivity: back on the human's own turn, the roll button is
    // visible and enabled (a bot's turn would show the "BOT 思考中…" hint
    // instead — see renderTurnbox — with no actionable button row at all).
    await expect(page.locator('#btn-roll')).toBeVisible();
    await expect(page.locator('#btn-roll')).toBeEnabled();
    const turnBeforeHandoff = await readTurnNumber(page);
    await completeHumanTurn(page); // roll -> card -> buy -> end, hands control to a bot seat

    // Save via the topbar SAVE button while it's now a bot's turn (about to act).
    // The topbar auto-hides in-game (index.html: .app--game .topbar { transform:
    // translateY(-100%) }), revealed only via a top-edge hotzone hover (App.js's
    // delegated mousemove listener toggles .topbar--show) — hover the hotzone
    // first so #btn-save is actually in-viewport before clicking it.
    await page.hover('#topbar-hotzone');
    await expect(page.locator('.topbar')).toHaveClass(/topbar--show/);
    await expect(page.locator('#btn-save')).toBeVisible();
    await page.click('#btn-save');
    await expect(page.locator('#btn-save')).toContainText('SAVED', { timeout: 3000 });

    // Reload the page — fresh client-side app state; only the localStorage
    // save persists. #btn-load-menu lives in the fixed topbar (outside every
    // .screen container), so it's reachable straight from the post-reload
    // hero screen with no need to re-navigate hero -> LOCAL -> mod -> map.
    await page.reload();
    await page.waitForSelector('#btn-load-menu', { timeout: 10000 });
    await page.click('#btn-load-menu');
    await page.waitForSelector('.btn-load-save', { timeout: 10000 });
    await page.click('.btn-load-save');

    // Post-load: the game board is back, bot badges persisted through the
    // save (App.js's saveGame/loadGame round-trip botSeats), and the driver
    // resumes autonomous play with NO further human input at all — the turn
    // counter advances past its pre-save value on its own.
    await page.waitForSelector('#board', { timeout: 10000 });
    await expect(page.locator('.pcard__bot')).toHaveCount(2);

    await expect.poll(async () => readTurnNumber(page), { timeout: 25000, intervals: [500] })
      .toBeGreaterThan(turnBeforeHandoff);

    expect(pageErrors).toEqual([]);
  });
});
