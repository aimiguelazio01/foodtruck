import assert from 'node:assert/strict';
import { test } from 'node:test';
import apiWorker from './api-worker.mjs';
import { cleanMessage, routePattern } from './diagnostics.mjs';
import { hashPassword, verifyLoginPassword } from './passwords.mjs';
import { resetHostingCache } from './subscription.mjs';

const MANAGEMENT = 'https://admin.example.test';
const secrets = ['ana@example.test', 'hunter2-super-secret', 'a'.repeat(64), 'SECRETQUERY', 'cookie-value-123'];

async function captureErrors(run) {
  const original = console.error;
  const lines = [];
  console.error = (...args) => { lines.push(args.map(String).join(' ')); };
  try { return { result: await run(), lines }; } finally { console.error = original; }
}

function assertNoSecrets(line) {
  for (const secret of secrets) assert.equal(line.includes(secret), false, `log line leaks ${secret}: ${line}`);
  assert.equal(line.includes('?'), false, `log line keeps a query string: ${line}`);
}

const failingDB = {
  prepare() {
    throw new Error(`D1_ERROR: no such table for ana@example.test token=${'a'.repeat(64)} at https://api.example.test/x?t=SECRETQUERY`);
  },
};

test('an uncaught error becomes one JSON line with route, stage, error and request id, and no secrets', async () => {
  const request = new Request('https://api.example.test/api/v1/auth/login?redirect=SECRETQUERY', {
    method: 'POST',
    headers: { origin: MANAGEMENT, 'content-type': 'application/json', cookie: 'staff_session=cookie-value-123', 'cf-ray': '8f00aa11bb22-LIS' },
    body: JSON.stringify({ email: 'ana@example.test', password: 'hunter2-super-secret' }),
  });
  const { result: response, lines } = await captureErrors(() => apiWorker.fetch(request, { DB: failingDB, MANAGEMENT_ORIGIN: MANAGEMENT }));
  assert.equal(response.status, 503);
  const { errorId } = await response.json();
  assert.equal(lines.length, 1);
  assertNoSecrets(lines[0]);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.event, 'api-error');
  assert.equal(entry.route, 'POST /api/v1/auth/login');
  assert.equal(entry.stage, 'staff-auth');
  assert.equal(entry.status, 503);
  assert.equal(entry.error, 'Error');
  assert.match(entry.message, /^D1_ERROR: no such table/);
  assert.ok(entry.message.length <= 200);
  assert.equal(entry.requestId, errorId);
  assert.equal(entry.ray, '8f00aa11bb22-LIS');
});

test('a hosting-gate 503 is logged with the swallowed cause', async () => {
  resetHostingCache();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('fetch failed: https://portal.example.test/status?token=SECRETQUERY'); };
  try {
    const request = new Request('https://api.example.test/api/v1/public/businesses/ana-truck?email=ana@example.test');
    const env = { SUBSCRIPTION_STATUS_URL: 'https://portal.example.test/status', SUBSCRIPTION_TOKEN: 'hunter2-super-secret' };
    const { result: response, lines } = await captureErrors(() => apiWorker.fetch(request, env));
    assert.equal(response.status, 503);
    assert.equal(lines.length, 1);
    assertNoSecrets(lines[0]);
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.route, 'GET /api/v1/public/businesses/:param');
    assert.equal(entry.stage, 'hosting-gate');
    assert.equal(entry.error, 'TypeError');
    assert.equal(entry.message, 'fetch failed: <url>');
    assert.match(entry.requestId, /^[0-9a-f]{8}$/);
  } finally {
    globalThis.fetch = originalFetch;
    resetHostingCache();
  }
});

test('route patterns drop ids and slugs; messages drop urls, emails and tokens', () => {
  assert.equal(routePattern('/api/v1/manage/businesses/ana-truck/orders/123e4567-e89b-12d3-a456-426614174000/status'),
    '/api/v1/manage/businesses/:param/orders/:param/status');
  assert.equal(routePattern('/uploads/123e4567-e89b-12d3-a456-426614174000.webp'), '/uploads/:param');
  const cleaned = cleanMessage(`Bearer abc.def failed for ana@example.test with ${'a'.repeat(64)} at https://x.test/?q=1 ${'x'.repeat(300)}`);
  assertNoSecrets(cleaned);
  assert.equal(cleaned.includes('abc.def'), false);
  assert.ok(cleaned.length <= 200);
});

test('login password checks log the PBKDF2 duration without user data', async () => {
  const stored = await hashPassword('hunter2-super-secret');
  const { result, lines } = await captureErrors(() => verifyLoginPassword('hunter2-super-secret', stored, 'customer'));
  assert.equal(result, true);
  assert.equal(lines.length, 1);
  assertNoSecrets(lines[0]);
  assert.equal(lines[0].includes(stored.split('$')[2]), false);
  const entry = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(entry).sort(), ['durationMs', 'event', 'impl', 'iterations', 'kind', 'source']);
  assert.equal(entry.event, 'pbkdf2');
  assert.equal(entry.kind, 'customer');
  assert.equal(entry.iterations, 600000);
  assert.equal(entry.impl, 'webcrypto');
  assert.ok(Number.isInteger(entry.durationMs) && entry.durationMs >= 0);
});
