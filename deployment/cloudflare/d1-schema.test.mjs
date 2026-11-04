import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { loadD1Migrations } from './d1-schema.mjs';
import { applyD1Migrations } from './d1-migrate.mjs';
import { initializeD1Business, isD1Configured } from './d1-installation.mjs';
import { handleInstallation } from './installation-worker.mjs';
import { verifyPassword } from './passwords.mjs';
import apiWorker from './api-worker.mjs';
import { commitCheckout } from './checkout-write.mjs';

function sqliteBinding(sqlite) {
  function prepare(sql, params = []) {
    return {
      bind: (...values) => prepare(sql, values),
      run: () => sqlite.prepare(sql).run(...params),
      all: () => ({ results: sqlite.prepare(sql).all(...params),
        meta: { changes: sqlite.prepare('SELECT changes() AS n').get().n } }),
      first: () => sqlite.prepare(sql).get(...params) ?? null,
    };
  }
  return { prepare, async batch(statements) {
    sqlite.exec('BEGIN');
    try {
      const results = statements.map(statement => statement.all());
      sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  } };
}

test('checkout commits stock and order together, with safe retries', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    const db = sqliteBinding(sqlite);
    await applyD1Migrations(db, await loadD1Migrations());
    await initializeD1Business(db, { email: 'owner@example.test', passwordHash: 'test', name: 'Truck',
      address: '', phone: '', contactEmail: '', logo: '', primaryColor: '#111111', secondaryColor: '#222222' });
    const { id: businessId } = sqlite.prepare('SELECT id FROM businesses').get();
    const createdAt = Date.now();
    const pickupAt = createdAt + 900_000;
    sqlite.prepare("INSERT INTO inventory(id,business_id,name,quantity) VALUES ('i',?,'Dough',1)").run(businessId);
    sqlite.prepare("INSERT INTO events(id,business_id,title,address,starts_at,ends_at) VALUES ('e',?,'Market','Lisboa',?,?)").run(businessId, createdAt, pickupAt + 900_000);
    const { catalog_revision: catalogRevision } = sqlite.prepare('SELECT catalog_revision FROM businesses').get();
    const order = { id: 'first', businessId, catalogRevision, requestHash: 'first', payloadHash: 'payload', name: 'Client',
      contact: 'client@example.test', total: 1000, pickupAt, eventId: 'e', location: 'Lisboa', createdAt,
      items: [{ id: 'p', name: 'Pizza', quantity: 1, unit: 1000, customization: '', category: 'Menu' }], ingredients: [['i', 1]] };
    sqlite.exec('UPDATE events SET title=\'Updated market\'');
    await assert.rejects(commitCheckout(db, order), /NOT NULL/);
    assert.equal(sqlite.prepare('SELECT reserved FROM inventory').get().reserved, 0);
    order.catalogRevision = sqlite.prepare('SELECT catalog_revision FROM businesses').get().catalog_revision;
    const competing = { ...order, id: 'second', requestHash: 'second' };
    const attempts = await Promise.allSettled([commitCheckout(db, order), commitCheckout(db, competing)]);
    if (attempts[0].status === 'rejected') throw attempts[0].reason;
    assert.equal(attempts[1].status, 'rejected');
    assert.equal(await commitCheckout(db, { ...order, id: 'retry' }), 'first');
    await assert.rejects(commitCheckout(db, { ...order, payloadHash: 'changed' }), /Chave já utilizada/);
    assert.equal(sqlite.prepare('SELECT reserved FROM inventory').get().reserved, 1);
    for (const table of ['orders', 'order_items', 'reservations', 'domain_events']) {
      assert.equal(sqlite.prepare(`SELECT count(*) n FROM ${table}`).get().n, 1);
    }
    const event = { scheduledTime: createdAt + 901_000 };
    const hold = sqlite.prepare("INSERT INTO worker_maintenance_lease VALUES (1,'previous-run',?)");
    hold.run(Date.now() + 60_000);
    await apiWorker.scheduled(event, { DB: db });
    assert.equal(sqlite.prepare('SELECT status FROM orders').get().status, 'pending');
    sqlite.exec('UPDATE worker_maintenance_lease SET expires_at=0');
    await Promise.all([apiWorker.scheduled(event, { DB: db }), apiWorker.scheduled(event, { DB: db })]);
    assert.equal(sqlite.prepare('SELECT status FROM orders').get().status, 'cancelled');
    assert.equal(sqlite.prepare('SELECT reserved FROM inventory').get().reserved, 0);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM audit_events WHERE action='order:first:cancelled:expired'").get().n, 1);
  } finally {
    sqlite.close();
  }
});

test('D1 deployment can retry migrations and initialize only once', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    const db = sqliteBinding(sqlite);
    const migrations = await loadD1Migrations();
    const versions = await Promise.all([applyD1Migrations(db, migrations), applyD1Migrations(db, migrations)]);
    assert.deepEqual(versions, [{ version: migrations.length }, { version: migrations.length }]);
    await assert.rejects(applyD1Migrations(db, migrations.slice(0, -1)), /Incompatible D1 migration history/);
    await assert.rejects(applyD1Migrations(db, [...migrations, {
      name: 'broken', sha256: 'test', sql: 'CREATE TABLE undo_me(id INTEGER);\nINSERT INTO absent VALUES (1);',
    }]), /absent/);
    assert.equal(sqlite.prepare("SELECT name FROM sqlite_schema WHERE name='undo_me'").get(), undefined);
    assert.equal(await isD1Configured(db), false);
    const input = { email: 'owner@example.test', passwordHash: 'test-hash', name: 'Truck', address: 'Lisboa',
      phone: '123', contactEmail: 'truck@example.test', logo: '', primaryColor: '#111111', secondaryColor: '#222222' };
    await assert.rejects(initializeD1Business(db, { ...input, passwordHash: null }), /NOT NULL/);
    assert.equal(await isD1Configured(db), false);
    const outcomes = await Promise.allSettled([initializeD1Business(db, input), initializeD1Business(db, input)]);
    if (outcomes.every(result => result.status === 'rejected')) throw outcomes[0].reason;
    assert.deepEqual(outcomes.map(result => result.status), ['fulfilled', 'rejected']);
    assert.equal(await isD1Configured(db), true);
    assert.equal(sqlite.prepare('SELECT count(*) n FROM users').get().n, 1);
    assert.equal(sqlite.prepare('SELECT contact_email FROM organization_settings').get().contact_email, input.contactEmail);
  } finally {
    sqlite.close();
  }
});

test('public menu includes modifiers, excludes sold-out products from availability and hides archived businesses', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    const db = sqliteBinding(sqlite);
    await applyD1Migrations(db, await loadD1Migrations());
    await initializeD1Business(db, { email: 'owner@example.test', passwordHash: 'test', name: 'Truck',
      address: '', phone: '', contactEmail: '', logo: '', primaryColor: '#111111', secondaryColor: '#222222' });
    const { id, slug } = sqlite.prepare('SELECT id,slug FROM businesses').get();
    sqlite.prepare("INSERT INTO products(id,business_id,name,price_cents) VALUES ('p',?,'Pizza',1000)").run(id);
    sqlite.prepare("INSERT INTO inventory(id,business_id,name,quantity) VALUES ('i',?,'Dough',0)").run(id);
    sqlite.exec("INSERT INTO recipes VALUES ('p','i',1); INSERT INTO modifier_groups VALUES ('g','p','Extra',0,1); INSERT INTO modifier_options(id,group_id,name,price_cents) VALUES ('o','g','Cheese',100)");
    const now = Date.now();
    sqlite.prepare("INSERT INTO events(id,business_id,title,address,starts_at,ends_at) VALUES ('e',?,'Market','Lisboa',?,?)").run(id, now, now + 7_200_000);
    const get = () => apiWorker.fetch(new Request(`https://api.invalid/api/v1/public/businesses/${slug}`), { DB: db });
    const menu = await (await get()).json();
    assert.equal(menu.products[0].available, 0);
    assert.deepEqual(menu.products[0].groups[0].options, [{ id: 'o', name: 'Cheese', price_cents: 100 }]);
    assert.ok(menu.slots.length > 0);
    sqlite.exec('UPDATE inventory SET quantity=1');
    const order = { requestKey: 'a'.repeat(64), name: 'Cliente', contact: 'client@example.test',
      pickupAt: menu.slots[0], items: [{ id: 'p', quantity: 1, optionIds: ['o'] }], expectedTotal: 1100 };
    const checkout = input => apiWorker.fetch(new Request(`https://api.invalid/api/v1/public/businesses/${slug}/orders`, {
      method: 'POST', body: JSON.stringify(input),
    }), { DB: db });
    assert.equal((await checkout({ ...order, expectedTotal: 1 })).status, 409);
    const response = await checkout(order);
    assert.equal(response.status, 200);
    const { id: orderID } = await response.json();
    assert.match(response.headers.get('set-cookie'), /^ft_track_/);
    assert.equal((await (await checkout(order)).json()).id, orderID);
    assert.equal(sqlite.prepare('SELECT total_cents FROM orders').get().total_cents, 1100);
    assert.equal(sqlite.prepare('SELECT reserved FROM inventory').get().reserved, 1);
    const track = (cookie = '') => apiWorker.fetch(new Request(`https://api.invalid/api/v1/customer/orders/${orderID}`, {
      headers: { cookie },
    }), { DB: db });
    assert.equal((await track()).status, 404);
    assert.equal((await track(`ft_track_${orderID}=${'b'.repeat(64)}`)).status, 404);
    const tracked = (await (await track(response.headers.get('set-cookie').split(';')[0])).json()).order;
    assert.equal(tracked.items[0].customization, 'Extra: Cheese');
    assert.equal(tracked.contact, undefined);
    const staffToken = 'c'.repeat(64);
    const tokenHash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(staffToken))).toString('hex');
    sqlite.exec("INSERT INTO users VALUES ('staff','staff@example.test','test')");
    sqlite.prepare("INSERT INTO memberships VALUES ('staff',?,'staff')").run(id);
    sqlite.prepare("INSERT INTO sessions VALUES (?,'staff',?)").run(tokenHash, Date.now() + 60_000);
    const managed = (business, token = '') => apiWorker.fetch(new Request(`https://api.invalid/api/v1/manage/businesses/${business}/orders`, {
      headers: { authorization: `Bearer ${token}` },
    }), { DB: db });
    assert.equal((await managed(id)).status, 401);
    assert.equal((await managed('another-truck', staffToken)).status, 403);
    const managedOrder = (await (await managed(id, staffToken)).json()).orders[0];
    assert.equal(managedOrder.id, orderID);
    assert.equal(managedOrder.contact, undefined);
    const managementOrigin = 'https://management.example.test';
    const change = (action, data) => apiWorker.fetch(new Request(`https://api.invalid/api/v1/manage/businesses/${id}/orders/${orderID}/${action}`, {
      method: action === 'payment' ? 'POST' : 'PATCH',
      headers: { authorization: `Bearer ${staffToken}`, origin: managementOrigin }, body: JSON.stringify(data),
    }), { DB: db, MANAGEMENT_ORIGIN: managementOrigin });
    assert.equal((await change('status', { status: 'confirmed', version: 1 })).status, 200);
    const preparing = await Promise.all([change('status', { status: 'preparing', version: 2 }), change('status', { status: 'preparing', version: 2 })]);
    assert.deepEqual(preparing.map(r => r.status).sort(), [200, 409]);
    assert.equal(sqlite.prepare('SELECT quantity FROM inventory').get().quantity, 0);
    assert.equal(sqlite.prepare('SELECT reserved FROM inventory').get().reserved, 0);
    assert.equal(sqlite.prepare('SELECT state FROM reservations').get().state, 'consumed');
    assert.equal(sqlite.prepare('SELECT count(*) n FROM stock_movements').get().n, 1);
    assert.equal((await change('status', { status: 'ready', version: 3 })).status, 200);
    assert.equal((await change('status', { status: 'collected', version: 4 })).status, 400);
    assert.equal((await change('payment', { version: 4 })).status, 200);
    assert.equal((await change('status', { status: 'collected', version: 5 })).status, 200);
    const history = await apiWorker.fetch(new Request(`https://api.invalid/api/v1/manage/businesses/${id}/orders/${orderID}/history`, {
      headers: { authorization: `Bearer ${staffToken}` },
    }), { DB: db });
    assert.equal(history.status, 200);
    assert.equal((await history.json()).history.length, 5);
    sqlite.prepare("INSERT INTO membership_permissions VALUES ('staff',?,?)").run(id, '{"orders":false}');
    assert.equal((await managed(id, staffToken)).status, 403);
    sqlite.exec('UPDATE business_settings SET is_open=0');
    assert.deepEqual((await (await get()).json()).slots, []);
    sqlite.exec('UPDATE organization_trucks SET archived=1');
    assert.equal((await get()).status, 404);
  } finally {
    sqlite.close();
  }
});

test('Worker requires a valid installation token and stores a password hash', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    const env = { DB: sqliteBinding(sqlite), INSTALL_TOKEN: 'a'.repeat(64),
      INSTALL_TOKEN_EXPIRES_AT: new Date(Date.now() + 60_000).toISOString() };
    await applyD1Migrations(env.DB, await loadD1Migrations());
    const body = { email: 'OWNER@example.test', password: 'some long password', name: 'Truck',
      address: '', phone: '', contactEmail: '', primaryColor: '#ffffff', secondaryColor: '#000000' };
    const send = (token, input = JSON.stringify(body)) => handleInstallation(new Request('https://test.invalid/api/v1/installation/complete', {
      method: 'POST', headers: { 'x-install-token': token }, body: input,
    }), env);
    assert.equal((await send('b'.repeat(64))).status, 403);
    assert.equal((await send(env.INSTALL_TOKEN, 'x'.repeat(8193))).status, 400);
    assert.equal((await send(env.INSTALL_TOKEN)).status, 201);
    assert.equal((await send(env.INSTALL_TOKEN)).status, 409);
    const user = sqlite.prepare('SELECT email,password FROM users').get();
    assert.equal(user.email, 'owner@example.test');
    assert.match(user.password, /^pbkdf2-sha256\$600000\$[\da-f]{32}\$[\da-f]{64}$/);
    assert.equal(await verifyPassword(body.password, user.password), true);
    assert.equal(await verifyPassword('incorrect password', user.password), false);
    env.MANAGEMENT_ORIGIN = 'https://management.example.test';
    const auth = (action, origin, headers = {}) => apiWorker.fetch(new Request(`https://api.invalid/api/v1/auth/${action}`, {
      method: 'POST', headers: { origin, ...headers }, body: JSON.stringify({ email: body.email, password: body.password }),
    }), env);
    assert.equal((await auth('login', 'https://other.example.test')).status, 403);
    const login = await auth('login', env.MANAGEMENT_ORIGIN);
    assert.equal(login.status, 200);
    const sessionCookie = login.headers.get('set-cookie');
    assert.match(sessionCookie, /^staff_session=[a-f0-9]{64}; HttpOnly; SameSite=Lax; Secure;/);
    const get = (path, cookie) => apiWorker.fetch(new Request(`https://api.invalid/api/v1${path}`, {
      headers: cookie ? { cookie: cookie.split(';')[0] } : {},
    }), env);
    assert.equal((await get('/auth/me')).status, 401);
    assert.equal((await (await get('/auth/me', sessionCookie)).json()).user.email, user.email);
    assert.equal((await (await get('/network/me/organizations', sessionCookie)).json()).organizations[0].role, 'network_owner');
    const businessList = await get('/manage/businesses', sessionCookie);
    assert.equal(businessList.headers.get('x-foodtruck-updates'), 'poll');
    const [business] = (await businessList.json()).businesses;
    assert.equal(business.isAdmin, true);
    assert.deepEqual((await (await get(`/manage/businesses/${business.id}/products`, sessionCookie)).json()).products, []);
    assert.equal((await get('/manage/businesses/another-truck/inventory', sessionCookie)).status, 403);
    env.CUSTOMER_ORIGIN = 'https://orders.example.test';
    assert.equal((await get('/manage/customer-app', sessionCookie)).headers.get('location'), 'https://orders.example.test/');
    assert.equal((await get('/manage/organizations')).status, 401);
    assert.equal((await (await get('/public/app-settings')).json()).primary_color, '#ffffff');
    const organization = sqlite.prepare('SELECT id FROM organizations').get().id;
    const brand = (color, origin = env.MANAGEMENT_ORIGIN, cookie = sessionCookie.split(';')[0]) => apiWorker.fetch(
      new Request(`https://api.invalid/api/v1/network/${organization}/branding`, {
        method: 'POST', headers: { origin, cookie }, body: JSON.stringify({ app_name: 'Truck Live', logo: '',
          primary_color: '#ffffff', secondary_color: '#000000', accent_color: '#123456', catalog_background_color: color }),
      }), env);
    assert.equal((await brand('#334455', 'https://other.example.test')).status, 403);
    assert.equal((await brand('#334455', env.MANAGEMENT_ORIGIN, '')).status, 401);
    assert.equal((await brand('red')).status, 400);
    assert.equal((await brand('#334455')).status, 200);
    assert.equal((await (await get('/public/app-settings')).json()).catalog_background_color, '#334455');
    assert.equal(sqlite.prepare("SELECT count(*) n FROM network_audit WHERE action='settings:branding'").get().n, 1);
    const images = new Map();
    const output = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]);
    const upload = (data, cookie = sessionCookie.split(';')[0]) => apiWorker.fetch(new Request(
      `https://api.invalid/api/v1/network/${organization}/company/images`, { method: 'POST',
        headers: { origin: env.MANAGEMENT_ORIGIN, cookie }, body: JSON.stringify({ data }) }), env);
    assert.equal((await upload('bad', '')).status, 401);
    assert.equal((await upload('bad')).status, 503);
    env.IMAGES = { info: async () => ({ width: 30, height: 30 }), input: () => ({ transform: () => ({
      output: async () => ({ response: () => new Response(output, { headers: { 'Content-Type': 'image/webp' } }) }),
    }) }) };
    env.MEDIA = { async put(key, stream) { images.set(key, await new Response(stream).arrayBuffer()); },
      async get(key) { return images.has(key) ? { body: images.get(key), httpEtag: '"image"' } : null; } };
    assert.equal((await upload(btoa('<svg/>'))).status, 400);
    const uploaded = await upload(btoa('\x89PNG\r\n\x1a\n'));
    assert.equal(uploaded.status, 201);
    const downloaded = await apiWorker.fetch(new Request(`https://api.invalid${(await uploaded.json()).path}`), env);
    assert.equal(downloaded.headers.get('content-type'), 'image/webp');
    assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()), output);
    assert.equal((await (await get('/public/businesses')).json()).businesses[0].name, 'Truck');
    sqlite.exec('UPDATE organization_trucks SET archived=1');
    assert.deepEqual((await (await get('/public/businesses')).json()).businesses, []);
    assert.equal(sqlite.prepare('SELECT count(*) n FROM sessions').get().n, 1);
    assert.equal((await auth('logout', env.MANAGEMENT_ORIGIN, { cookie: sessionCookie.split(';')[0] })).status, 200);
    assert.equal(sqlite.prepare('SELECT count(*) n FROM sessions').get().n, 0);
    assert.equal((await get('/auth/me', sessionCookie)).status, 401);
    env.INSTALL_TOKEN_EXPIRES_AT = '2000-01-01T00:00:00Z';
    assert.equal((await send(env.INSTALL_TOKEN)).status, 403);
  } finally {
    sqlite.close();
  }
});

test('D1 migrations cover the current PostgreSQL schema and start with an empty installation', async () => {
  const migrations = await loadD1Migrations();
  const source = await readdir(new URL('../../services/api/migrations/', import.meta.url));
  // D1 numbers its own additions 019-022; PostgreSQL's 019_write_guard is D1's 022_write_guard (identical SQL).
  const shared = source.filter(name => name.endsWith('.sql') && name !== '019_write_guard.sql').sort();
  assert.deepEqual(migrations.map(({ name }) => `${name}.sql`), [...shared, '019_catalog_revision.sql', '020_maintenance_lease.sql', '021_bootstrap_receipt.sql', '022_write_guard.sql']);
  const [postgresGuard, d1Guard] = await Promise.all([
    readFile(new URL('../../services/api/migrations/019_write_guard.sql', import.meta.url), 'utf8'),
    readFile(new URL('./migrations/022_write_guard.sql', import.meta.url), 'utf8'),
  ]);
  assert.equal(d1Guard, postgresGuard);
  const db = new DatabaseSync(':memory:');
  try {
    for (const { sql } of migrations) db.exec(sql);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    for (const table of ['users', 'businesses', 'organizations', 'orders', 'installation_state']) {
      assert.equal(db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count, 0);
    }
    db.exec(`INSERT INTO organizations VALUES ('org', 'Test');
      INSERT INTO users VALUES ('owner', 'owner@example.test', 'test');
      INSERT INTO organization_members VALUES ('org', 'owner', 'network_owner');
      INSERT INTO businesses(id,slug,name,color) VALUES ('truck', 'truck', 'Test', '#000000');
      INSERT INTO events (id,business_id,title,address,starts_at,ends_at)
        VALUES ('event','truck','Test','Test',100,200);
      INSERT INTO inventory (id,business_id,name) VALUES ('ingredient','truck','Test');
      INSERT INTO tasks (id,business_id,title) VALUES ('task','truck','Test');`);
    assert.throws(() => db.exec('DELETE FROM organization_members'), /retain a network owner/);
    assert.throws(() => db.exec("UPDATE organization_members SET role='network_admin'"), /retain a network owner/);
    assert.throws(() => db.exec('UPDATE events SET latitude=30'), /Invalid event coordinates/);
    db.exec('UPDATE events SET latitude=30, longitude=-10; UPDATE inventory SET quantity=3');
    assert.equal(db.prepare('SELECT version FROM events').get().version, 2);
    assert.equal(db.prepare('SELECT version FROM inventory').get().version, 2);
    assert.ok(db.prepare('SELECT created_at FROM tasks').get().created_at > 0);
  } finally {
    db.close();
  }
});
