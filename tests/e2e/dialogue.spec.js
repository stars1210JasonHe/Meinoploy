const { test, expect } = require('@playwright/test');

// Dialogue system E2E (MT2-SP4 direction B, T3 — speech bubbles + attitude
// chips + diary tab). Self-contained per-file helpers (gameplay.spec.js/
// duel.spec.js convention — no cross-file imports).
//
// Two independent cases:
//  (a) keyless deterministic — play Terra Titans (the only mod with
//      RULES.duel.enabled=true, see duel.spec.js), resolving real duels and
//      reading the SAVED attitude ledger after each one, until the ledger
//      itself proves a grudge tier is crossed — only THEN open that seat's
//      player-detail popover and assert the glyph. Zero API key anywhere —
//      the attitude ledger is pure/code-driven (T1/T2 "no key = ledger
//      still accumulates" invariant).
//  (b) bubble smoke — inject an already-resolved reaction line through
//      window.__MP_TEST_BUBBLE (App.js's test-only seam, mirroring the
//      existing __MP_FAST_ROLL/__MP_LIVE_CLIENTS convention) and assert the
//      speech bubble appears on the right chip, never blocks clicks, and
//      auto-dismisses.
//
// ── Why test (a) asserts on LEDGER STATE, not duel counting (T3-review
// MUST-FIX redesign) ─────────────────────────────────────────────────────
//
// MEASURED inputs (verified via a scratch jest run against the real loaded
// Terra Titans world through src/world-loader.js loadWorld — not guessed):
// every city rent tops out at 38, so even doubled by duel.loseMultiplier
// (2) a duel-loss payment (max 76) NEVER reaches
// RULES.dialogue.rentGrudgeThreshold (200) — the bigRentGrudge stacking row
// never fires here. Per-loss delta is therefore exactly
// weights.duelLostGrudge = 2.
//
// The decay math that broke the first version of this test: decayPerSeason
// .grudge = 1 fires on EVERY season_changed (seasons.changeInterval = 10
// G.totalTurns = every 5 two-player rounds) and decays EVERY tracked pair.
// Two same-holder losses with <= 1 season boundary between them yield
// 2 - 1 + 2 = 3 >= attitudeDisplay.grudgeTiers[0] (3) — tier reached. With
// >= 2 boundaries between them the pair oscillates 2 -> 0 -> 2 and NEVER
// crosses. A fixed "N duels then assert the popover" script therefore
// races decay (the review's finding: most long trajectories interleave it).
//
// The deterministic fix: after each resolved duel, click SAVE and read the
// dialogue-memory envelope (T2's saveData.dialogueMemory.ledger — the exact
// same seat-keyed state renderPlayerInfo's attitude section reads) straight
// out of localStorage. The popover is opened ONLY once the ledger itself
// shows some pair's grudge >= grudgeTiers[0] — at that point the glyph
// rendering is a pure deterministic function of state already proven to
// hold, so the UI assertion cannot race anything. The loop merely HUNTS for
// that state under hard caps: every duel adds +2 to one of the two pair
// directions while a season boundary costs each direction only 1, and the
// convergent-route policy (duel.spec.js's proven approach) recurs duels
// well within a season once cross-ownership builds — two same-holder losses
// inside <= 1 boundary is the expected case, not the lucky one.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('meinopoly_locale', 'en');
    window.__MP_FAST_ROLL = true;
  });
});

// ─── Terra Titans navigation (verbatim structure from duel.spec.js) ───
async function pickAndConfirm(page) {
  const card = page.locator('.charcard:not(.charcard--taken)').first();
  await card.click();
  const confirm = page.locator('#btn-select-confirm');
  await expect(confirm).toBeEnabled();
  await confirm.click();
}

async function waitForPlayer2(page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('.select__p');
    return el && /PLAYER 2/.test(el.textContent);
  }, { timeout: 10000 });
}

async function selectCharactersTerraTitans(page) {
  await page.goto('/');
  await page.waitForSelector('#btn-mode-local', { timeout: 10000 });
  await page.click('#btn-mode-local');
  await page.waitForSelector('.map-card[data-mod-idx]', { timeout: 10000 });
  await page.locator('.map-card[data-mod-idx]', { hasText: 'Terra Titans' }).click();
  await page.waitForSelector('.map-card[data-map-idx]', { timeout: 10000 });
  await page.locator('.map-card[data-map-idx]', { hasText: 'Terra Titans' }).click();
  await page.waitForSelector('.count-btn[data-count="2"]', { timeout: 10000 });
  await page.click('.count-btn[data-count="2"]');
  // Survival, not the mod's dominion default — same race-avoidance reasoning
  // as duel.spec.js (this test needs MULTIPLE duel rounds, so dominion
  // victory racing us to end the game early is an even bigger risk here).
  await page.locator('.vic-card[data-mode="survival"]').click();
  await page.waitForSelector('#btn-vic-start', { timeout: 10000 });
  await page.click('#btn-vic-start');
  await page.waitForSelector('.charcard', { timeout: 10000 });
  await pickAndConfirm(page);
  await waitForPlayer2(page);
  await pickAndConfirm(page);
  await page.waitForSelector('#btn-roll', { timeout: 10000 });
}

async function activePlayerMoney(page) {
  const text = await page.locator('.pcard--active .pcard__money').textContent().catch(() => '');
  const digits = (text || '').replace(/[^0-9]/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

const CASH_FLOOR = 700; // same buffer duel.spec.js uses — never buy into stake-bankruptcy risk

// One Terra Titans turn, stopping the instant a duel OFFER shows (#btn-duel
// visible). Identical structure to duel.spec.js's terraTitansTurn — kept as
// a separate copy per this suite's file-local-helpers convention.
async function terraTitansTurn(page) {
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
  }

  const evAccept = page.locator('#ev-accept');
  if (await evAccept.isVisible().catch(() => false)) {
    await evAccept.click();
    await page.waitForTimeout(300);
  }

  if (await page.locator('#btn-duel').isVisible().catch(() => false)) {
    return true;
  }

  const buyBtn = page.locator('#btn-buy');
  if (await buyBtn.isVisible().catch(() => false)) {
    const cash = await activePlayerMoney(page);
    if (cash > CASH_FLOOR) {
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
  }

  const endBtn = page.locator('#btn-end');
  if (await endBtn.isVisible().catch(() => false) && await endBtn.isEnabled().catch(() => false)) {
    await endBtn.click();
    await page.waitForTimeout(300);
  }
  return false;
}

// The grudge value at which the FIRST tier glyph renders —
// RULES.dialogue.attitudeDisplay.grudgeTiers[0] (mods/dominion/rules.js,
// shared by every mod via the drift-guarded defaults). Not readable from the
// save envelope (RULES live off-G), so mirrored here with this pointer.
const GRUDGE_TIER_1 = 3;

// The duel stake is loseMultiplier (2) x rent (max 38 in this world, see the
// header comment) = max 76, but the loser might ALSO be close to broke from
// buying. A challenger below this floor pays rent instead of duelling so a
// lost duel can never bankrupt-and-gameover a player mid-test (T3-review:
// challenger-cash guard).
const DUEL_CASH_FLOOR = 500;

// Resolves the CURRENTLY-showing duel offer (DUEL! -> FIGHT -> result strip),
// then ends the turn so the outer loop can resume. Caller has already
// checked the cash floor + enabled state.
async function resolveOneDuel(page) {
  await page.locator('#btn-duel').click();
  await page.waitForTimeout(300);

  await expect(page.locator('#btn-fight')).toBeVisible();
  await page.locator('#btn-fight').click();
  await page.waitForTimeout(300);

  // Resolution is random (2d6 + stats per side) — which side won doesn't
  // matter here (the LEDGER read below is the arbiter); just wait for the
  // result strip so the duel has definitely resolved before saving.
  await expect(page.locator('.turnbox__slot', { hasText: 'WINS' }).first()).toBeVisible();

  const endBtn = page.locator('#btn-end');
  if (await endBtn.isVisible().catch(() => false) && await endBtn.isEnabled().catch(() => false)) {
    await endBtn.click();
    await page.waitForTimeout(300);
  }
}

// Pays the rent on a showing duel offer instead of fighting (cash floor /
// cooldown-disabled cases), then ends the turn.
async function payRentInstead(page) {
  await page.click('#btn-payrent');
  await page.waitForTimeout(300);
  const endBtn = page.locator('#btn-end');
  if (await endBtn.isVisible().catch(() => false) && await endBtn.isEnabled().catch(() => false)) {
    await endBtn.click();
    await page.waitForTimeout(300);
  }
}

// Saves the game via the real topbar SAVE flow (bots.spec.js's exact
// pattern: the topbar auto-hides in-game, revealed via the top-edge
// hotzone), then reads the freshest save's dialogue-memory ledger (T2's
// saveData.dialogueMemory.ledger) out of localStorage and returns the first
// {holder, opp, grudge} pair at/over GRUDGE_TIER_1, or null. The ledger is
// keyed by SEAT ids ('0','1') — holder is therefore directly the data-chip
// index of the chip whose popover must show the glyph.
async function readGrudgeTierHit(page) {
  await page.hover('#topbar-hotzone');
  await expect(page.locator('.topbar')).toHaveClass(/topbar--show/);
  await expect(page.locator('#btn-save')).toBeVisible();
  await page.click('#btn-save');
  await expect(page.locator('#btn-save')).toContainText('SAVED', { timeout: 3000 });
  return await page.evaluate((tier) => {
    const saves = JSON.parse(localStorage.getItem('meinopoly_saves') || '{}');
    const newest = Object.values(saves).sort((a, b) => b.timestamp - a.timestamp)[0];
    const ledger = (newest && newest.dialogueMemory && newest.dialogueMemory.ledger) || {};
    for (const holder of Object.keys(ledger)) {
      for (const opp of Object.keys(ledger[holder])) {
        if (ledger[holder][opp].grudge >= tier) {
          return { holder, opp, grudge: ledger[holder][opp].grudge };
        }
      }
    }
    return null;
  }, GRUDGE_TIER_1);
}

test.describe('Attitude ledger (keyless, MT2-SP4 direction B)', () => {
  test('grudge tier glyph renders once the saved ledger proves the tier is crossed', async ({ page }) => {
    // Budget: each duel-search reuses duel.spec.js's proven convergent-route
    // policy (~found within 40 turns worst-case pre-ownership; much faster
    // once cross-ownership exists). MAX_TURNS caps total turn iterations
    // across ALL duels; MAX_DUELS caps resolved duels. See the file header
    // for the 2+2-1=3 tier math and why the ledger read (not duel counting)
    // is what makes the final assertion deterministic.
    test.setTimeout(480000);
    const MAX_TURNS = 150;
    const MAX_DUELS = 12;
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await selectCharactersTerraTitans(page);

    let hit = null;
    let duelsResolved = 0;
    for (let i = 0; i < MAX_TURNS && !hit && duelsResolved < MAX_DUELS; i++) {
      if (await page.locator('.results__victory').isVisible().catch(() => false)) break;
      const offerShowing = await terraTitansTurn(page);
      if (!offerShowing) continue;

      // Duel offer on screen. Guards: challenger cash floor (a lost duel's
      // 2x-rent stake must never bankrupt-and-gameover mid-test) and the
      // cooldown-disabled state (RULES.duel.cooldownTurns renders #btn-duel
      // disabled for 3 turns after each duel) — both fall back to paying
      // rent, which still advances the game toward the next opportunity.
      const cash = await activePlayerMoney(page);
      const duelEnabled = await page.locator('#btn-duel').isEnabled().catch(() => false);
      if (cash < DUEL_CASH_FLOOR || !duelEnabled) {
        await payRentInstead(page);
        continue;
      }

      await resolveOneDuel(page);
      duelsResolved += 1;
      hit = await readGrudgeTierHit(page);
    }

    // The ledger itself must have crossed the tier within budget…
    expect(hit).toBeTruthy();
    expect(hit.grudge).toBeGreaterThanOrEqual(GRUDGE_TIER_1);

    // …and only now assert the UI: the popover's attitude section renders
    // from EXACTLY this ledger state (renderPlayerInfo -> attitudeChipsHtml,
    // seat-keyed), so with the tier proven above, the glyph is a
    // deterministic function of state — no luck left in this assertion.
    //
    // De-hover the topbar first: readGrudgeTierHit's save-hover left it
    // shown (App.js's mousemove toggle), and the shown topbar overlays the
    // top-of-screen chip strip — a mid-screen mouse move clears
    // .topbar--show so the chip click can't be intercepted.
    await page.mouse.move(400, 400);
    await expect(page.locator('.topbar')).not.toHaveClass(/topbar--show/);
    await page.locator(`.pcard--chip[data-chip="${hit.holder}"]`).click();
    await expect(page.locator('.chip-detail')).toBeVisible();
    await expect(page.locator('.attitude__grudge').first()).toBeVisible();
    // Close via scrim click. (Escape would ALSO close it — App.js's
    // consolidated keydown handler closes the ui-modal first, modal-first
    // ordering — scrim-click just matches gameplay.spec.js's convention.)
    await page.locator('#ui-modal').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('#ui-modal')).not.toHaveClass(/open/);

    expect(pageErrors).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
// Bubble smoke test: a simple 2-player Dominion classic game (duels/atlas
// complexity irrelevant here — bubbles only need a live chip strip).
// ─────────────────────────────────────────────────────────────
async function selectCharactersDominion(page) {
  await page.goto('/');
  await page.waitForSelector('#btn-mode-local', { timeout: 10000 });
  await page.click('#btn-mode-local');
  const modCard = page.locator('.map-card[data-mod-idx]', { hasText: 'Dominion' }).first();
  if (await modCard.isVisible({ timeout: 4000 }).catch(() => false)) {
    await modCard.click();
  }
  await page.waitForSelector('.map-card[data-map-idx="0"]', { timeout: 10000 });
  await page.click('.map-card[data-map-idx="0"]');
  await page.waitForSelector('.count-btn[data-count="2"]', { timeout: 10000 });
  await page.click('.count-btn[data-count="2"]');
  await page.waitForSelector('#btn-vic-start', { timeout: 10000 });
  await page.click('#btn-vic-start');
  await page.waitForSelector('.charcard', { timeout: 10000 });
  await pickAndConfirm(page);
  await waitForPlayer2(page);
  await pickAndConfirm(page);
  await page.waitForSelector('#btn-roll', { timeout: 10000 });
}

test.describe('Speech bubbles (T3, injected via the __MP_TEST_BUBBLE test seam)', () => {
  // A fake key is required to satisfy _showSpeechBubble's own isEnabled()
  // gate (apiKey && verbosity !== OFF) — the SAME gate a real reaction must
  // pass to ever display. __MP_TEST_BUBBLE never calls fetch/_callApi, so
  // this key is NEVER sent anywhere; it exists purely to legitimately
  // exercise the real production gate rather than special-casing test mode.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('meinopoly_ai_key', 'sk-test-fake-not-a-real-key-never-sent');
    });
  });

  test('injected reaction shows a speech bubble on the character chip, never blocks clicks, and auto-dismisses', async ({ page }) => {
    test.setTimeout(30000);
    await selectCharactersDominion(page);

    const chip0 = page.locator('.pcard--chip[data-chip="0"]');
    await expect(chip0).toBeVisible();

    await page.evaluate(() => window.__MP_TEST_BUBBLE('0', 'Testing, testing.'));

    const bubble = page.locator('.dbubble');
    await expect(bubble).toBeVisible();
    await expect(bubble.locator('.dbubble__text')).toContainText('Testing, testing.');

    // Must never block a click underneath it (spec requirement).
    const pointerEvents = await bubble.evaluate(el => getComputedStyle(el).pointerEvents);
    expect(pointerEvents).toBe('none');

    // Auto-dismiss after RULES.dialogue.bubbleMs (default 6000ms) + the short
    // CSS exit-fade hold (App.js DBUBBLE_EXIT_MS, 200ms) — generous timeout,
    // bounded real-time wait (not a guessed/flake-hiding margin: this is the
    // real configured default plus a small fixed constant).
    await expect(bubble).toHaveCount(0, { timeout: 9000 });
  });

  test('a second injected reaction for the SAME chip replaces the bubble (stacking = newest replaces)', async ({ page }) => {
    test.setTimeout(30000);
    await selectCharactersDominion(page);

    await page.evaluate(() => window.__MP_TEST_BUBBLE('0', 'First line.'));
    await expect(page.locator('.dbubble__text')).toContainText('First line.');

    await page.evaluate(() => window.__MP_TEST_BUBBLE('0', 'Second line.'));
    // Exactly one bubble ever exists at a time for a given chip.
    await expect(page.locator('.dbubble')).toHaveCount(1);
    await expect(page.locator('.dbubble__text')).toContainText('Second line.');
    await expect(page.locator('.dbubble__text')).not.toContainText('First line.');
  });

  test('verbosity OFF suppresses the injected bubble entirely (same gate as reactions)', async ({ page }) => {
    test.setTimeout(30000);
    await selectCharactersDominion(page);

    // #btn-ai-settings lives in the auto-hiding in-game topbar — reveal it
    // via the top-edge hotzone first (bots.spec.js's #btn-save pattern).
    await page.hover('#topbar-hotzone');
    await expect(page.locator('.topbar')).toHaveClass(/topbar--show/);
    await page.click('#btn-ai-settings');
    await page.waitForSelector('#ai-verbosity-select', { timeout: 10000 });
    await page.selectOption('#ai-verbosity-select', 'off');
    await page.click('#btn-ai-save');
    await page.waitForTimeout(200);

    await page.evaluate(() => window.__MP_TEST_BUBBLE('0', 'Should never appear.'));
    await page.waitForTimeout(500);
    await expect(page.locator('.dbubble')).toHaveCount(0);
  });
});
