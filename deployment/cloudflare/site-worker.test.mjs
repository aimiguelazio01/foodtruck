import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withFoodtruckAPI } from './site-worker.mjs';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stageSite } from './stage-site.mjs';

test('staging wraps the OpenNext entry and keeps its named exports', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'foodtruck-cloudflare-'));
  try {
    await mkdir(join(dir, '.open-next', 'assets'), { recursive: true });
    await writeFile(join(dir, 'package.json'), '{"type":"module"}');
    await writeFile(join(dir, 'wrangler.json'), '{}');
    await writeFile(join(dir, '.open-next', 'worker.js'), `export const cache = 'named export';
      export default { fetch: () => new Response('OpenNext') };`);
    const config = await stageSite({ directory: dir, profile: 'management', name: 'foodtruck-management', apiName: 'foodtruck-api' });
    const entry = await import(pathToFileURL(join(dir, config.main)).href);
    assert.equal(entry.cache, 'named export');
    assert.equal(await (await entry.default.fetch(new Request('https://test.invalid/'), {})).text(), 'OpenNext');
    assert.deepEqual(config.assets.run_worker_first, ['/api/v1/*', '/uploads/*']);
    assert.equal(config.services[1].service, 'foodtruck-api');
    assert.equal(config.workers_dev, false);
    assert.equal(await readFile(join(dir, 'wrangler.json'), 'utf8'), '{}');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('site wrapper separates public and management API traffic', async () => {
  const site = { fetch: () => new Response('Next') };
  const customer = withFoodtruckAPI(site, 'customer');
  const management = withFoodtruckAPI(site, 'management');
  let requests = 0;
  const env = { FOODTRUCK_API: { async fetch(request) {
    requests++;
    assert.equal(request.redirect, 'manual');
    if (request.method === 'POST') {
      assert.equal(request.headers.get('origin'), 'https://manage.example.test');
      assert.equal(request.headers.get('cookie'), 'staff_session=test');
      assert.equal(await request.text(), 'body');
    }
    return new Response('API', { headers: { 'Set-Cookie': 'test=value' } });
  } } };
  const get = path => new Request(`https://orders.example.test${path}`);
  assert.equal(await (await customer.fetch(get('/images/trucks.webp'), env)).text(), 'Next');
  assert.equal(await (await customer.fetch(get('/uploads/image.webp'), env)).text(), 'API');
  assert.equal((await customer.fetch(get('/api/v1/manage/businesses'), env)).status, 404);
  assert.equal((await customer.fetch(get('/api/v1/installation/complete'), env)).status, 404);
  assert.equal((await customer.fetch(get('/api/v1/public/businesses'), {})).status, 503);
  const result = await management.fetch(new Request('https://manage.example.test/api/v1/auth/login', {
    method: 'POST', headers: { origin: 'https://manage.example.test', cookie: 'staff_session=test' }, body: 'body',
  }), env);
  assert.equal(result.headers.get('set-cookie'), 'test=value');
  assert.equal(requests, 2);
});
