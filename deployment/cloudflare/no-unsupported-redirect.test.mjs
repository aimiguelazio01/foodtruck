import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

// The Workers runtime throws "Invalid redirect value" for redirect: 'error'; that made every
// freshly installed site answer HTTP 503 (hosting gate) and silently broke account email.
test('Worker code never passes redirect: "error" to fetch', () => {
  const directory = new URL('.', import.meta.url);
  const offenders = readdirSync(directory)
    .filter((name) => name.endsWith('.mjs') && !name.endsWith('.test.mjs'))
    .filter((name) => /redirect\s*:\s*['"]error['"]/.test(readFileSync(new URL(name, directory), 'utf8')));
  assert.deepEqual(offenders, []);
});
