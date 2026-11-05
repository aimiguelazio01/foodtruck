import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { loadD1Migrations } from './d1-schema.mjs';
import { applyD1Migrations } from './d1-migrate.mjs';
import { seedKey } from './demo-reset.mjs';
import { buildSeedPackage } from '../demo/build-seed-package.mjs';

const origin = 'https://management.example.test';
const seedPackage = await buildSeedPackage();
const fixtureText = JSON.stringify(seedPackage);
const fixture = seedPackage.fixture;
const demoToken = 'd'.repeat(64);

async function start(demo = true) {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('./api-worker.mjs', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-11-03', d1Databases: ['DB'], r2Buckets: ['MEDIA'],
    bindings: { MANAGEMENT_ORIGIN: origin, ...(demo ? { DEMO_MODE: '1', DEMO_TOKEN: demoToken } : {}) } }));
  const db = await runtime.getD1Database('DB');
  await applyD1Migrations(db, await loadD1Migrations());
  const media = await runtime.getR2Bucket('MEDIA');
  const worker = await runtime.getWorker();
  return { runtime, db, media, worker };
}
const count = async (db, table) => (await db.prepare(`SELECT count(*) n FROM ${table}`).first()).n;

test('the demonstration fixture loads into D1, resets to a known state and shifts its dates to now', { timeout: 180_000 }, async () => {
  const { runtime, db, media, worker } = await start();
  try {
    await media.put(seedKey, fixtureText);
    const now = Date.now();
    await worker.scheduled({ scheduledTime: new Date(now) });
    const expected = { businesses: 3, users: 9, memberships: 9, products: 30, orders: 72, order_items: 72, inventory: 63,
      recipes: 79, events: 21, stock_movements: 129, reservations: 72, tasks: 9, product_details: 30 };
    for (const [table, rows] of Object.entries(expected)) assert.equal(await count(db, table), rows, table);
    assert.equal((await db.prepare("SELECT mode FROM installation_state WHERE id=1").first()).mode, 'demo');
    assert.equal(await count(db, 'organization_members'), 1);
    assert.equal(await count(db, 'organization_trucks'), 3);
    const newest = (await db.prepare('SELECT max(created_at) m FROM orders').first()).m;
    assert.ok(Math.abs(newest - (Math.max(...fixture.tables.orders.map(order => order.created_at)) + now - fixture.capturedAt)) < 2, 'dates shifted');
    // The demo user cannot sign in with a password, only through the demo session.
    assert.equal((await db.prepare('SELECT password FROM users WHERE email=?').bind('owner@urban-burger.demo').first()).password, 'demo-session-only');

    // A visitor can come in without a password and sees the three businesses.
    const session = await runtime.dispatchFetch(`${origin}/api/v1/demo/session`, { method: 'POST', headers: { origin } });
    assert.equal(session.status, 200, await session.text());
    const cookie = session.headers.get('set-cookie').split(';')[0];
    const list = await (await runtime.dispatchFetch(`${origin}/api/v1/manage/businesses`, { headers: { cookie } })).json();
    assert.equal(list.businesses.length, 3);

    // Visitors make a mess; a second run inside the same day leaves it alone, one a day later puts everything back.
    await db.batch([db.prepare("DELETE FROM order_items"), db.prepare("DELETE FROM reservations"), db.prepare("DELETE FROM orders"), db.prepare("DELETE FROM tasks"), db.prepare("UPDATE products SET name='Estragado'")]);
    await worker.scheduled({ scheduledTime: new Date(now + 3_600_000) });
    assert.equal(await count(db, 'orders'), 0);
    await worker.scheduled({ scheduledTime: new Date(now + 90_000_000) });
    assert.equal(await count(db, 'orders'), 72);
    assert.equal(await count(db, 'products'), 30);
    assert.equal(await count(db, 'tasks'), 9);
    assert.equal((await db.prepare("SELECT count(*) n FROM products WHERE name='Estragado'").first()).n, 0);
    assert.equal(await count(db, 'organization_members'), 1);
    assert.equal((await runtime.dispatchFetch(`${origin}/api/v1/auth/me`, { headers: { cookie } })).status, 200, 'sessions survive a reset');
  } finally {
    await runtime.dispose();
  }
});

test('the operator loads the demonstration with a token, and only with the token', { timeout: 180_000 }, async () => {
  const { runtime, db } = await start();
  try {
    const put = (token, body = JSON.stringify(seedPackage)) => runtime.dispatchFetch(`${origin}/api/v1/demo/seed`, {
      method: 'PUT', headers: token ? { 'x-demo-token': token } : {}, body });
    assert.equal((await put(undefined)).status, 403);
    assert.equal((await put('x'.repeat(64))).status, 403);
    assert.equal((await put(demoToken, '{"nope":1}')).status, 400);
    assert.equal(await count(db, 'businesses'), 0);
    const loaded = await put(demoToken);
    assert.equal(loaded.status, 200, await loaded.text());
    assert.equal(await count(db, 'businesses'), 3);
    assert.equal(await count(db, 'orders'), 72);
  } finally {
    await runtime.dispose();
  }
});

test('outside demo mode the seed route does not exist', { timeout: 120_000 }, async () => {
  const { runtime } = await start(false);
  try {
    const response = await runtime.dispatchFetch(`${origin}/api/v1/demo/seed`, { method: 'PUT', headers: { 'x-demo-token': demoToken }, body: '{}' });
    assert.notEqual(response.status, 200);
    assert.notEqual(response.status, 403);
  } finally {
    await runtime.dispose();
  }
});

test('a Worker that is not in demo mode never touches its data on a schedule', { timeout: 120_000 }, async () => {
  const { runtime, db, media, worker } = await start(false);
  try {
    await media.put(seedKey, fixtureText);
    await worker.scheduled({ scheduledTime: new Date() });
    assert.equal(await count(db, 'businesses'), 0);
  } finally {
    await runtime.dispose();
  }
});
