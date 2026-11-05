import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { hashPassword, verifyPassword } from './passwords.mjs';

test('production PBKDF2 cap preserves 600000 rounds and compatible hashes', async () => {
  const original = crypto.subtle.deriveBits;
  crypto.subtle.deriveBits = async () => { throw new DOMException('Pbkdf2 failed: iteration counts above 100000 are not supported', 'NotSupportedError'); };
  try {
    const password = 'Strong password with ç and emojis 🚚';
    const stored = await hashPassword(password);
    const [scheme, rounds, salt, derived] = stored.split('$');
    assert.equal(scheme, 'pbkdf2-sha256');
    assert.equal(rounds, '600000');
    assert.equal(derived, pbkdf2Sync(password, Buffer.from(salt, 'hex'), 600000, 32, 'sha256').toString('hex'));
    assert.equal(await verifyPassword(password, stored), true);
    assert.equal(await verifyPassword('wrong', stored), false);
  } finally { crypto.subtle.deriveBits = original; }
});

test('unrelated WebCrypto failures are propagated', async () => {
  const original = crypto.subtle.deriveBits;
  crypto.subtle.deriveBits = async () => { throw new Error('unexpected failure'); };
  try { await assert.rejects(hashPassword('password'), /unexpected failure/); }
  finally { crypto.subtle.deriveBits = original; }
});
