import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from '@playwright/test';

test('installer verifies a package and displays Cloudflare accounts without retaining the token', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 850 } });
    await page.addInitScript(() => {
      window.__TAURI__ = { core: { invoke: async (command, { request }) => {
        if (command !== 'engine') throw new Error('Unexpected command');
        if (request.action === 'verify-package') return { result: { version: 'test', files: { 'api/worker.mjs': {} } } };
        if (request.token === 'a'.repeat(30)) return { result: [{ id: 'account', name: '<Account & Business>' }] };
        return { error: 'Token inválido.' };
      } } };
    });
    await page.goto(new URL('./ui/index.html', import.meta.url).href);
    await page.locator('#directory').fill('C:\\Food Truck Package');
    await page.locator('#package button').click();
    await page.locator('#package-result').filter({ hasText: '1 ficheiros conferidos' }).waitFor();
    await page.locator('#token').fill('a'.repeat(30));
    await page.locator('#connect button').click();
    await page.locator('#accounts:not([disabled])').waitFor();
    assert.equal(await page.locator('#accounts option').textContent(), '<Account & Business>');
    assert.equal(await page.locator('#token').inputValue(), '');
    await page.locator('#token').fill('b'.repeat(30));
    await page.locator('#connect button').click();
    await page.locator('#connection-result').filter({ hasText: 'Token inválido.' }).waitFor();
    assert.equal(await page.locator('#accounts').isDisabled(), true);
    assert.equal(await page.locator('#token').inputValue(), '');
  } finally {
    await browser.close();
  }
});
