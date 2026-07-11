// tests/e2e/online-map-align.spec.js
// Spec §0b: a browser joining a MOD=terra-titans server must render the ATLAS
// board, not the dominion default the online lobby locally pins. Spawns its
// own game server on 8088 (the client hardcodes that port); if 8088 is busy
// (a dev server), SKIPS LOUDLY rather than testing against the wrong server.
const { test, expect } = require('@playwright/test');
const { spawn } = require('child_process');
const http = require('http');

let serverProc = null;

function portFree(port) {
  return new Promise(resolve => {
    const s = http.createServer().once('error', () => resolve(false))
      .once('listening', () => s.close(() => resolve(true)))
      .listen(port, '127.0.0.1');
  });
}

test.beforeAll(async () => {
  if (!(await portFree(8088))) {
    console.warn('\n[online-map-align] PORT 8088 BUSY — skipping (stop your dev game server to run this spec)\n');
    test.skip(true, 'port 8088 busy');
    return;
  }
  serverProc = spawn(process.execPath, ['-r', 'esm', 'server.js'], {
    env: { ...process.env, MOD: 'terra-titans', PORT: '8088' },
    stdio: 'ignore',
  });
  // Wait for the lobby REST to answer.
  await new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      http.get('http://localhost:8088/games/monopoly', () => resolve())
        .on('error', () => Date.now() - t0 > 15000 ? reject(new Error('game server did not start')) : setTimeout(poll, 300));
    })();
  });
});

test.afterAll(() => { if (serverProc) serverProc.kill(); });

test('online client aligns to the server mod (terra-titans atlas)', async ({ page }) => {
  await page.goto('/');
  await page.getByText('ONLINE GAME', { exact: false }).click();
  await page.locator('#btn-create-match').click(); // creates + auto-joins seat 0
  // Character select must show terra-titans roster (16 leaders), not dominion's 10.
  await expect(page.locator('.charcard').first()).toBeVisible({ timeout: 15000 });
  const count = await page.locator('.charcard').count();
  expect(count).toBeGreaterThan(10); // terra-titans has 16; dominion 10
});
