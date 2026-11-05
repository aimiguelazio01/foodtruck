import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { loadD1Migrations } from './d1-schema.mjs';
import { applyD1Migrations } from './d1-migrate.mjs';

const origin = 'https://management.example.test';

async function start(demo) {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('./api-worker.mjs', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-11-03', d1Databases: ['DB'], r2Buckets: ['MEDIA'],
    bindings: { MANAGEMENT_ORIGIN: origin, ...(demo ? { DEMO_MODE: '1' } : {}) } }));
  const db = await runtime.getD1Database('DB');
  await applyD1Migrations(db, await loadD1Migrations());
  await db.batch([
    db.prepare("INSERT INTO installation_state(id,mode) VALUES (1,'demo')"),
    db.prepare("INSERT INTO users(id,email,password) VALUES ('u1','owner@urban-burger.demo','x')"),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('demo-network','Rede de demonstração')"),
    db.prepare("INSERT INTO organization_members VALUES ('demo-network','u1','network_owner')"),
  ]);
  const call = (method, path, init = {}) => runtime.dispatchFetch(`${origin}/api/v1${path}`, {
    method, ...init, headers: { origin, ...(init.headers ?? {}) }, body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return { runtime, call };
}

test('demo mode: passwordless session, closed actions and a status that says demo', { timeout: 120_000 }, async () => {
  const { runtime, call } = await start(true);
  try {
    const status = await (await call('GET', '/installation/status')).json();
    assert.equal(status.demo, true);
    assert.equal(status.configured, true);

    const foreign = await runtime.dispatchFetch(`${origin}/api/v1/demo/session`, { method: 'POST', headers: { origin: 'https://evil.example.test' } });
    assert.equal(foreign.status, 403);

    const started = await call('POST', '/demo/session');
    assert.equal(started.status, 200, await started.text());
    const cookie = started.headers.get('set-cookie');
    assert.match(cookie, /Max-Age=3600/);
    const me = await call('GET', '/auth/me', { headers: { cookie: cookie.split(';')[0] } });
    assert.equal((await me.json()).user.email, 'owner@urban-burger.demo');

    const closed = [
      ['POST', '/manage/businesses/b1/orders/00000000-0000-4000-8000-000000000000/payment'],
      ['POST', '/network/demo-network/company'],
      ['POST', '/network/demo-network/branding'],
      ['POST', '/network/demo-network/company/images'],
      ['POST', '/manage/businesses/b1/images'],
      ['POST', '/manage/businesses/b1/users'],
      ['PATCH', '/manage/businesses/b1/users/u1/permissions'],
      ['POST', '/customer/register'],
      ['POST', '/customer/forgot-password'],
      ['POST', '/auth/forgot-password'],
    ];
    for (const [method, path] of closed) {
      const response = await call(method, path, { body: {}, headers: { cookie: cookie.split(';')[0] } });
      assert.equal(response.status, 403, `${method} ${path}`);
      assert.match((await response.json()).message, /Demonstração/, `${method} ${path}`);
    }
  } finally {
    await runtime.dispose();
  }
});

test('outside demo mode the demo route does not exist and nothing is blocked as a demo', { timeout: 120_000 }, async () => {
  const { runtime, call } = await start(false);
  try {
    assert.equal((await (await call('GET', '/installation/status')).json()).demo, false);
    assert.equal((await call('POST', '/demo/session')).status, 404);
    const register = await call('POST', '/customer/register', { body: {} });
    assert.notEqual((await register.clone().text()).includes('Demonstração'), true);
  } finally {
    await runtime.dispose();
  }
});
