const { test, expect } = require('@playwright/test');

// Dialogue system E2E (MT2-SP4 direction B, T3 — speech bubbles + attitude
// chips + diary tab). Self-contained per-file helpers (gameplay.spec.js/
// duel.spec.js convention — no cross-file imports).
//
// Two independent cases:
//  (a) keyless deterministic — play Terra Titans (the only mod with
//      RULES.duel.enabled=true, see duel.spec.js) until a duel resolves,
//      open the LOSER's player-detail popover, assert a grudge tier glyph
//      renders. Zero API key anywhere — the attitude ledger is pure/code-
//      driven (T1/T2 "no key = ledger still accumulates" invariant).
//  (b) bubble smoke — inject an already-resolved reaction line through
//      window.__MP_TEST_BUBBLE (App.js's test-only seam, mirroring the
//      existing __MP_FAST_ROLL/__MP_LIVE_CLIENTS convention) and assert the
//      speech bubble appears on the right chip, never blocks clicks, and
//      auto-dismisses.
//
// MEASURED finding that shaped test (a)'s design (not a guess — verified via
// a scratch jest run against the real loaded Terra Titans world before
// writing this spec): every Terra Titans city's rent tops out at 38
// (loaded via src/world-loader.js's loadWorld against the real
// mods/terra-titans world data), so even doubled by RULES.duel.loseMultiplier
// (2) a duel-loss rent payment (max 76) NEVER reaches
// RULES.dialogue.rentGrudgeThreshold (200) — the "big rent" grudge row never
// fires here. A SINGLE duel loss therefore only ever produces
// weights.duelLostGrudge (2), which is BELOW attitudeDisplay.grudgeTiers[0]
// (3) — no glyph would render after just one duel. This matches the plan's
// own acceptance item (docs/superpowers/plans/2026-07-17-dialogue-b-plan.md,
// sign-off 3: "两轮即到显示" — two rounds to reach the display threshold),
// so the test below plays additional duel rounds (same two players, no other
// opponents exist) until the actual grudge glyph appears, rather than
// asserting after exactly one duel.

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

// Resolves the CURRENTLY-showing duel offer (DUEL! -> FIGHT), reads the
// winner's character name off the result strip (App.js _duelResultStripHtml,
// t('duel.wins', {name,...}) = "{name} WINS (...)"), and ends the turn so
// the outer search loop can resume. Returns the winner's character name.
async function resolveOneDuel(page) {
  await expect(page.locator('#btn-payrent')).toBeVisible();
  const duelBtn = page.locator('#btn-duel');
  await expect(duelBtn).toBeVisible();
  await expect(duelBtn).toBeEnabled();
  await duelBtn.click();
  await page.waitForTimeout(300);

  await expect(page.locator('#btn-fight')).toBeVisible();
  await page.locator('#btn-fight').click();
  await page.waitForTimeout(300);

  const winsLocator = page.locator('.turnbox__slot', { hasText: 'WINS' }).first();
  await expect(winsLocator).toBeVisible();
  const winsText = (await winsLocator.textContent()) || '';
  const m = winsText.match(/^\s*(.+?)\s+WINS/);
  const winnerName = m ? m[1].trim() : null;

  const endBtn = page.locator('#btn-end');
  if (await endBtn.isVisible().catch(() => false) && await endBtn.isEnabled().catch(() => false)) {
    await endBtn.click();
    await page.waitForTimeout(300);
  }
  return winnerName;
}

// Maps a character NAME to its chip's data-chip index. .pcard__name is
// display:none at rest (CSS hover-reveal — index.html
// ".app--game .pcard--chip .pcard__name { display:none }") but
// .textContent() reads the real DOM text regardless of CSS visibility
// (unlike .innerText()/click(), which require visibility) — same technique
// duel.spec.js's activePlayerMoney already relies on for .pcard__money.
async function chipIdxByName(page, name) {
  const chips = page.locator('.pcard--chip');
  const count = await chips.count();
  for (let i = 0; i < count; i++) {
    const chipName = ((await chips.nth(i).locator('.pcard__name').textContent()) || '').trim();
    if (chipName === name) return chips.nth(i).getAttribute('data-chip');
  }
  return null;
}

// Opens chipIdx's player-detail popover, checks for a rendered grudge glyph
// (game-chrome.js attitudeChipsHtml's .attitude__grudge — code-driven, no
// API key involved anywhere in this path), closes the popover (scrim click —
// Escape only closes the drawer, not this modal, per gameplay.spec.js), and
// returns whether a glyph was present.
async function popoverHasGrudgeGlyph(page, chipIdx) {
  await page.locator(`.pcard--chip[data-chip="${chipIdx}"]`).click();
  await expect(page.locator('.chip-detail')).toBeVisible();
  const hasGrudge = (await page.locator('.attitude__grudge').count()) > 0;
  await page.locator('#ui-modal').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#ui-modal')).not.toHaveClass(/open/);
  return hasGrudge;
}

test.describe('Attitude ledger (keyless, MT2-SP4 direction B)', () => {
  test('grudge tier glyph renders in the loser\'s player-detail popover after real duel losses', async ({ page }) => {
    // Generous budget: see the file-header comment — a single duel loss
    // (grudge 2) sits BELOW the display tier (3), so this may need several
    // duel rounds (same 2 players, no other opponents exist in a 1v1 game)
    // before ANY pair crosses the display threshold. Each round's own search
    // for a fresh cross-landing reuses duel.spec.js's proven 40-turn/240s
    // budget for finding ONE duel; this scales that budget for up to 4 rounds.
    test.setTimeout(420000);
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await selectCharactersTerraTitans(page);

    let glyphFound = false;
    for (let round = 0; round < 4 && !glyphFound; round++) {
      let offerSeen = false;
      for (let i = 0; i < 40 && !offerSeen; i++) {
        if (await page.locator('.results__victory').isVisible().catch(() => false)) break;
        offerSeen = await terraTitansTurn(page);
      }
      if (!offerSeen) break; // game likely ended (victory) — nothing more to search for

      const winnerName = await resolveOneDuel(page);
      expect(winnerName).toBeTruthy();

      const chipIds = await page.locator('.pcard--chip').evaluateAll(els => els.map(el => el.dataset.chip));
      const winnerIdx = await chipIdxByName(page, winnerName);
      const loserIdx = chipIds.find(idx => idx !== winnerIdx);
      expect(loserIdx).toBeTruthy();

      glyphFound = await popoverHasGrudgeGlyph(page, loserIdx);
    }

    expect(glyphFound).toBe(true);
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
