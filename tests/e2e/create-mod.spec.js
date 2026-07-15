const { test, expect } = require('@playwright/test');

// Locale pin (localization task 5): this spec's own assertions target mod NAMES
// (data, never localized — spec 2026-07-15-localization-design.md §2), so they're
// locale-independent already. Pinned 'en' anyway for consistency with every other
// spec in this suite (this file had no addInitScript before — added fresh).
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { window.localStorage.setItem('meinopoly_locale', 'en'); });
});

// The generated mods must appear in mod-select. This is the only automated gate that
// exercises the generated Tier-B bundle.client.js through a real Parcel build.
test.describe('Create-Mod generated mods', () => {
  test('generated atlas + classic mods are selectable on mod-select screen', async ({ page }) => {
    await page.goto('/');

    // Wait for hero screen and click LOCAL GAME
    await page.waitForSelector('#btn-mode-local', { timeout: 15000 });
    await page.click('#btn-mode-local');

    // Mod-select renders because MODS.length > 1 (dominion + terra-titans + ancient-empires + steam-barons)
    await page.waitForSelector('.map-card[data-mod-idx]', { timeout: 15000 });

    // Assert both generated mod names are visible as mod cards
    await expect(page.locator('.map-card[data-mod-idx]', { hasText: 'Ancient Empires' }).first()).toBeVisible();
    await expect(page.locator('.map-card[data-mod-idx]', { hasText: 'Steam Barons' }).first()).toBeVisible();
  });
});
