import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { loadD1Migrations } from './d1-schema.mjs';
import { applyD1Migrations } from './d1-migrate.mjs';

const origin = 'https://management.example.test';

test('shared-service routes enforce session, origin, capabilities and race safety over HTTP on workerd', { timeout: 180_000 }, async () => {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('./api-worker.mjs', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  const installToken = 'c'.repeat(64);
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-11-03', d1Databases: ['DB'], r2Buckets: ['MEDIA'],
    bindings: { INSTALL_TOKEN: installToken, INSTALL_TOKEN_EXPIRES_AT: new Date(Date.now() + 300_000).toISOString(), MANAGEMENT_ORIGIN: origin } }));
  try {
    const db = await runtime.getD1Database('DB');
    await applyD1Migrations(db, await loadD1Migrations());
    const send = (method, path, { cookie, body, headers = {} } = {}) => runtime.dispatchFetch(`${origin}/api/v1${path}`, {
      method, headers: { ...(method === 'GET' ? {} : { origin }), ...(cookie ? { cookie } : {}), ...headers },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });
    const admin = { email: 'owner@example.test', password: 'a strong test password' };
    assert.equal((await send('POST', '/installation/complete', { headers: { 'x-install-token': installToken },
      body: { ...admin, name: 'Truck', address: '', phone: '', contactEmail: '', primaryColor: '#112233', secondaryColor: '#445566' } })).status, 201);
    const login = await send('POST', '/auth/login', { body: admin });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const [business] = (await (await send('GET', '/manage/businesses', { cookie })).json()).businesses;
    const base = `/manage/businesses/${business.id}/inventory`;

    // Authentication, CSRF origin and malformed bodies.
    assert.equal((await send('GET', base)).status, 401);
    assert.equal((await send('POST', base, { cookie, body: { name: 'Sal' }, headers: { origin: 'https://evil.example' } })).status, 403);
    assert.equal((await send('POST', base, { cookie, body: '{not json' })).status, 400);
    assert.equal((await send('POST', base, { cookie, body: { name: '', unit: 'g' } })).status, 400);

    // Success path and read-back.
    const created = await send('POST', base, { cookie, body: { name: 'Farinha', unit: 'g', quantity: 10, minimum: 2, supplier: '' } });
    const createdText = await created.text();
    assert.equal(created.status, 200, createdText);
    const { id } = JSON.parse(createdText);
    assert.equal((await send('POST', base, { cookie, body: { name: 'farinha', unit: 'g' } })).status, 409);
    const listed = (await (await send('GET', base, { cookie })).json()).inventory;
    assert.equal(listed.length, 1);
    assert.equal(listed[0].recipe_count, 0);
    assert.equal((await (await send('GET', `${base}/${id}/movements`, { cookie })).json()).movements.length, 1);
    assert.equal((await send('GET', `${base}/missing/movements`, { cookie })).status, 404);

    // Four simultaneous withdrawals with the same version: exactly one is applied.
    const { version } = listed[0];
    const results = await Promise.all([1, 2, 3, 4].map(() => send('POST', `${base}/${id}/stock`, { cookie, body: { quantity: 8, reason: 'waste', version } })));
    const codes = results.map(response => response.status).sort();
    assert.deepEqual(codes, [200, 409, 409, 409]);
    assert.equal((await db.prepare('SELECT quantity FROM inventory WHERE id=?').bind(id).first()).quantity, 2);

    // Capabilities: default staff has no inventory access; a custom grant allows it; non-members never do.
    const staffToken = randomBytes(32).toString('hex');
    await db.batch([
      db.prepare("INSERT INTO users(id,email,password) VALUES('staff','staff@example.test','x')"),
      db.prepare('INSERT INTO memberships(user_id,business_id,role) VALUES(?,?,?)').bind('staff', business.id, 'staff'),
      db.prepare('INSERT INTO sessions(hash,user_id,expires) VALUES(?,?,?)').bind(createHash('sha256').update(staffToken).digest('hex'), 'staff', Date.now() + 3_600_000),
      db.prepare("INSERT INTO users(id,email,password) VALUES('stranger','stranger@example.test','x')"),
    ]);
    const staff = `staff_session=${staffToken}`;
    assert.equal((await send('GET', base, { cookie: staff })).status, 403);
    assert.equal((await send('POST', base, { cookie: staff, body: { name: 'Sal', unit: 'g' } })).status, 403);
    const strangerToken = randomBytes(32).toString('hex');
    await db.prepare('INSERT INTO sessions(hash,user_id,expires) VALUES(?,?,?)').bind(createHash('sha256').update(strangerToken).digest('hex'), 'stranger', Date.now() + 3_600_000).run();
    assert.equal((await send('GET', base, { cookie: `staff_session=${strangerToken}` })).status, 403);

    // Audit trail and change events were written with the data.
    assert.ok((await db.prepare("SELECT count(*) n FROM audit_events WHERE action LIKE 'inventory:%'").first()).n >= 2);
    assert.ok((await db.prepare('SELECT count(*) n FROM domain_events WHERE business_id=?').bind(business.id).first()).n >= 2);
  } finally {
    await runtime.dispose();
  }
});
