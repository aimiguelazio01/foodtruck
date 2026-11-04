import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { loadD1Migrations } from './d1-schema.mjs';
import { applyD1Migrations } from './d1-migrate.mjs';
import { takeRequestSlot } from './rate-limits.mjs';
import { buildBootstrap } from './build-bootstrap.mjs';

test('temporary bridge initializes a fresh private D1 and refuses unauthorized requests', { timeout: 120_000 }, async () => {
  const setup = await buildBootstrap();
  const bridge = await build({ entryPoints: [fileURLToPath(new URL('./bootstrap-bridge.mjs', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  const token = 'b'.repeat(64);
  const bindings = { INSTALL_TOKEN: token, INSTALL_TOKEN_EXPIRES_AT: new Date(Date.now() + 300_000).toISOString(), BOOTSTRAP_ID: `foodtruck-${'a'.repeat(32)}` };
  const runtime = new Miniflare(convertV4MiniflareOptions({ workers: [
    { name: 'bridge', modules: true, script: bridge.outputFiles[0].text, compatibilityDate: '2026-11-03', bindings,
      serviceBindings: { FOODTRUCK_SETUP: 'setup' } },
    { name: 'setup', modules: true, script: setup.outputFiles[0].text, compatibilityDate: '2026-11-03', bindings,
      d1Databases: ['DB'] },
  ] }));
  try {
    const body = { email: 'owner@example.test', password: 'a strong test password', name: 'Cloud Truck', address: '',
      phone: '', contactEmail: '', primaryColor: '#112233', secondaryColor: '#445566' };
    const send = secret => runtime.dispatchFetch('https://bridge.example.test/initialize', {
      method: 'POST', headers: { 'x-install-token': secret }, body: JSON.stringify(body),
    });
    assert.equal((await send('invalid')).status, 403);
    const db = await runtime.getD1Database('DB', 'setup');
    assert.equal((await db.prepare("SELECT count(*) n FROM sqlite_schema WHERE name='users'").first()).n, 0);
    const installed = await send(token);
    assert.equal(installed.status, 201, await installed.text());
    assert.equal((await db.prepare('SELECT email FROM users').first()).email, body.email);
    const repeated = await send(token);
    assert.equal(repeated.status, 200);
    assert.equal((await repeated.json()).installation, bindings.BOOTSTRAP_ID);
    assert.equal((await runtime.dispatchFetch('https://bridge.example.test/api/v1/auth/login')).status, 404);
  } finally {
    await runtime.dispose();
  }
});

test('workerd initializes D1, hashes passwords and authenticates the administrator', { timeout: 120_000 }, async () => {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('./api-worker.mjs', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  const token = 'a'.repeat(64);
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-11-03', d1Databases: ['DB'], r2Buckets: ['MEDIA'],
    bindings: { INSTALL_TOKEN: token, INSTALL_TOKEN_EXPIRES_AT: new Date(Date.now() + 300_000).toISOString(),
      MANAGEMENT_ORIGIN: 'https://management.example.test' } }));
  try {
    const db = await runtime.getD1Database('DB');
    await applyD1Migrations(db, await loadD1Migrations());
    const limitTime = Date.now();
    const attempts = await Promise.all(Array.from({ length: 8 }, () => takeRequestSlot(db, 'test', 'client', 3, 1000, limitTime)));
    assert.equal(attempts.filter(Boolean).length, 3);
    assert.equal(await takeRequestSlot(db, 'test', 'client', 3, 1000, limitTime + 1000), true);
    const body = { email: 'owner@example.test', password: 'a strong test password', name: 'Truck', address: '',
      phone: '', contactEmail: '', primaryColor: '#112233', secondaryColor: '#445566' };
    const post = (path, value, headers = {}) => runtime.dispatchFetch(`https://management.example.test/api/v1${path}`, {
      method: 'POST', headers: { origin: 'https://management.example.test', ...headers }, body: JSON.stringify(value),
    });
    const installed = await post('/installation/complete', body, { 'x-install-token': token });
    assert.equal(installed.status, 201, await installed.text());
    const login = await post('/auth/login', { email: body.email, password: body.password });
    assert.equal(login.status, 200, await login.text());
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const me = await runtime.dispatchFetch('https://management.example.test/api/v1/auth/me', { headers: { cookie } });
    assert.equal((await me.json()).user.email, body.email);
    const saturated = await db.prepare("UPDATE request_limits SET count=25 WHERE key LIKE 'staff-login:%'").run();
    assert.equal(saturated.meta.changes, 1);
    const blocked = await post('/auth/login', { email: body.email, password: body.password });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get('retry-after'), '900');
    assert.equal((await post('/installation/complete', body, { 'x-install-token': token })).status, 409);
  } finally {
    await runtime.dispose();
  }
});
