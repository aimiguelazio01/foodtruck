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
        if (request.action === 'verify-package') return { result: { version: 'test', status: 'release', files: { 'api/worker.mjs': {} } } };
        if (request.action === 'verify-license') return { result: { account: request.account } };
        if (request.action === 'install') {
          if (!request.costsApproved || request.business.name !== 'Truck' || request.account !== 'account') return { error: 'Pedido inválido.' };
          return { result: { customer: 'https://orders.example.test', management: 'https://manage.example.test' } };
        }
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
    assert.equal(await page.locator('#install button').isDisabled(), true);
    await page.locator('#license-file').setInputFiles({ name: 'license.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
    await page.locator('#license button').click();
    await page.locator('#install-fields:not([disabled])').waitFor();
    await page.locator('#business-name').fill('Truck');
    await page.locator('#admin-email').fill('owner@example.test');
    await page.locator('#admin-password').fill('a strong password');
    await page.locator('#deploy-token').fill('a'.repeat(30));
    await page.locator('#costs-approved').check();
    await page.locator('#install button').click();
    await page.locator('#addresses').waitFor();
    assert.equal(await page.locator('#management-url').inputValue(), 'https://manage.example.test');
    assert.equal(await page.locator('#deploy-token').inputValue(), '');
    assert.equal(await page.locator('#admin-password').inputValue(), '');
    await page.locator('#token').fill('b'.repeat(30));
    await page.locator('#connect button').click();
    await page.locator('#connection-result').filter({ hasText: 'Token inválido.' }).waitFor();
    assert.equal(await page.locator('#accounts').isDisabled(), true);
    assert.equal(await page.locator('#token').inputValue(), '');
  } finally {
    await browser.close();
  }
});
