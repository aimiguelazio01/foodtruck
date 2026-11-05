import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { loadD1Migrations } from './d1-schema.mjs';
import { applyD1Migrations } from './d1-migrate.mjs';
import { hashPassword } from './passwords.mjs';
import apiWorker from './api-worker.mjs';

function sqliteBinding(sqlite) {
  function prepare(sql, params = []) {
    return {
      bind: (...values) => prepare(sql, values),
      run: () => sqlite.prepare(sql).run(...params),
      all: () => ({ results: sqlite.prepare(sql).all(...params), meta: { changes: sqlite.prepare('SELECT changes() AS n').get().n } }),
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

const CUSTOMER = 'https://shop.example.test';
const MANAGEMENT = 'https://admin.example.test';
const password = 'a long enough password';

async function setup(overrides = {}) {
  const sqlite = new DatabaseSync(':memory:');
  const db = sqliteBinding(sqlite);
  await applyD1Migrations(db, await loadD1Migrations());
  const env = { DB: db, CUSTOMER_ORIGIN: CUSTOMER, MANAGEMENT_ORIGIN: MANAGEMENT, BREVO_API_KEY: 'brevo-test', MAIL_FROM: 'Food Truck <no-reply@example.test>', ...overrides };
  const sent = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'https://api.brevo.com/v3/smtp/email');
    assert.equal(options.headers['api-key'], 'brevo-test');
    const payload = JSON.parse(options.body);
    sent.push({ to: payload.to[0].email, sender: payload.sender, text: payload.textContent, token: payload.textContent.match(/token=([a-f0-9]{64})/)?.[1] });
    return Response.json({ messageId: 'x' });
  };
  const call = (path, body, { method = 'POST', origin = CUSTOMER, headers = {} } = {}) => apiWorker.fetch(new Request(`https://api.example.test${path}`, {
    method, headers: { origin, 'content-type': 'application/json', ...headers }, body: method === 'POST' ? JSON.stringify(body) : undefined,
  }), env);
  return { sqlite, env, sent, call, done: () => { globalThis.fetch = original; sqlite.close(); } };
}

test('customer registers, verifies by email, logs in and out', async () => {
  const t = await setup();
  try {
    assert.equal((await t.call('/api/v1/customer/register', { email: 'Ana@Example.test', password })).status, 200);
    assert.equal(t.sent.length, 1);
    assert.equal(t.sent[0].to, 'ana@example.test');
    assert.match(t.sent[0].text, /^Para ativar a sua conta/);
    assert.ok(t.sent[0].text.includes(`${CUSTOMER}/verify?token=`));
    assert.equal((await t.call('/api/v1/customer/register', { email: 'ana@example.test', password })).status, 409);
    assert.equal((await t.call('/api/v1/customer/login', { email: 'ana@example.test', password })).status, 403);
    assert.equal((await t.call('/api/v1/customer/verify', { token: '0'.repeat(64) })).status, 400);
    assert.equal((await t.call('/api/v1/customer/verify', { token: t.sent[0].token })).status, 200);
    assert.equal((await t.call('/api/v1/customer/verify', { token: t.sent[0].token })).status, 400, 'token is single use');
    assert.equal((await t.call('/api/v1/customer/login', { email: 'ana@example.test', password: 'wrong password!!' })).status, 401);
    const login = await t.call('/api/v1/customer/login', { email: 'ana@example.test', password });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.match(cookie, /^customer_session=[a-f0-9]{64}$/);
    const me = await t.call('/api/v1/customer/me', null, { method: 'GET', headers: { cookie } });
    assert.equal((await me.json()).customer.email, 'ana@example.test');
    assert.equal((await t.call('/api/v1/customer/logout', {}, { headers: { cookie } })).status, 200);
    assert.equal((await t.call('/api/v1/customer/me', null, { method: 'GET', headers: { cookie } })).status, 401);
  } finally { t.done(); }
});

test('verification can be resent and only for unverified accounts', async () => {
  const t = await setup();
  try {
    await t.call('/api/v1/customer/register', { email: 'b@example.test', password });
    await t.call('/api/v1/customer/resend-verification', { email: 'b@example.test' });
    assert.equal(t.sent.length, 2);
    assert.notEqual(t.sent[0].token, t.sent[1].token);
    assert.equal((await t.call('/api/v1/customer/verify', { token: t.sent[0].token })).status, 400, 'old link is replaced');
    assert.equal((await t.call('/api/v1/customer/verify', { token: t.sent[1].token })).status, 200);
    assert.equal((await t.call('/api/v1/customer/resend-verification', { email: 'b@example.test' })).status, 200);
    assert.equal((await t.call('/api/v1/customer/resend-verification', { email: 'nobody@example.test' })).status, 200);
    assert.equal(t.sent.length, 2, 'no mail for verified or unknown addresses');
  } finally { t.done(); }
});

test('customer password reset replaces the password and ends sessions', async () => {
  const t = await setup();
  try {
    await t.call('/api/v1/customer/register', { email: 'c@example.test', password });
    await t.call('/api/v1/customer/verify', { token: t.sent[0].token });
    const login = await t.call('/api/v1/customer/login', { email: 'c@example.test', password });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await t.call('/api/v1/customer/forgot-password', { email: 'nobody@example.test' })).status, 200);
    assert.equal(t.sent.length, 1);
    assert.equal((await t.call('/api/v1/customer/forgot-password', { email: 'c@example.test' })).status, 200);
    const reset = t.sent[1];
    assert.ok(reset.text.includes(`${CUSTOMER}/reset-password?token=`));
    assert.equal((await t.call('/api/v1/customer/reset-password', { token: reset.token, password: 'short' })).status, 400);
    assert.equal((await t.call('/api/v1/customer/reset-password', { token: reset.token, password: 'a brand new password' })).status, 200);
    assert.equal((await t.call('/api/v1/customer/reset-password', { token: reset.token, password: 'another new password' })).status, 400);
    assert.equal((await t.call('/api/v1/customer/me', null, { method: 'GET', headers: { cookie } })).status, 401);
    assert.equal((await t.call('/api/v1/customer/login', { email: 'c@example.test', password })).status, 401);
    assert.equal((await t.call('/api/v1/customer/login', { email: 'c@example.test', password: 'a brand new password' })).status, 200);
  } finally { t.done(); }
});

test('staff password reset uses the management site and signs staff out', async () => {
  const t = await setup();
  try {
    t.sqlite.prepare("INSERT INTO users(id,email,password) VALUES ('u1','owner@example.test',?)").run(await hashPassword(password));
    t.sqlite.prepare("INSERT INTO sessions(hash,user_id,expires) VALUES ('h','u1',?)").run(Date.now() + 60_000);
    assert.equal((await t.call('/api/v1/auth/forgot-password', { email: 'owner@example.test' })).status, 403, 'wrong origin');
    assert.equal((await t.call('/api/v1/auth/forgot-password', { email: 'owner@example.test' }, { origin: MANAGEMENT })).status, 200);
    assert.ok(t.sent[0].text.includes(`${MANAGEMENT}/reset-password?token=`));
    assert.equal((await t.call('/api/v1/auth/reset-password', { token: t.sent[0].token, password: 'staff new password' }, { origin: MANAGEMENT })).status, 200);
    assert.equal(t.sqlite.prepare('SELECT count(*) n FROM sessions').get().n, 0);
    assert.equal((await t.call('/api/v1/auth/login', { email: 'owner@example.test', password: 'staff new password' }, { origin: MANAGEMENT })).status, 200);
  } finally { t.done(); }
});

test('accounts cannot be created or recovered when email is not configured', async () => {
  const t = await setup({ BREVO_API_KEY: undefined });
  try {
    assert.equal((await t.call('/api/v1/customer/register', { email: 'd@example.test', password })).status, 503);
    assert.equal(t.sqlite.prepare('SELECT count(*) n FROM customers').get().n, 0);
    assert.equal((await t.call('/api/v1/customer/forgot-password', { email: 'd@example.test' })).status, 503);
  } finally { t.done(); }
});

test('a failed delivery does not leave an unverifiable account behind', async () => {
  const t = await setup();
  try {
    globalThis.fetch = async () => new Response('nope', { status: 400 });
    assert.equal((await t.call('/api/v1/customer/register', { email: 'e@example.test', password })).status, 502);
    assert.equal(t.sqlite.prepare('SELECT count(*) n FROM customers').get().n, 0);
  } finally { t.done(); }
});
