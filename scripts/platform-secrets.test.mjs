import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { fillSecrets, signingKeyFromEnv } from './platform-secrets.mjs';

const template = '# comment\nPLATFORM_ORIGIN=\nPLATFORM_DB_PASSWORD=\nPLATFORM_ENCRYPTION_KEY=\nPLATFORM_ADMIN_KEY=already-set\nPLATFORM_SIGNING_KEY=\n';

test('fills only empty generated values and keeps the rest of the file', () => {
  const { text, filled } = fillSecrets(template);
  assert.deepEqual(filled.sort(), ['PLATFORM_DB_PASSWORD', 'PLATFORM_ENCRYPTION_KEY', 'PLATFORM_SIGNING_KEY']);
  assert.match(text, /^# comment$/m);
  assert.match(text, /^PLATFORM_ORIGIN=$/m, 'values the operator must supply stay empty');
  assert.match(text, /^PLATFORM_ADMIN_KEY=already-set$/m);
  assert.match(text, /^PLATFORM_DB_PASSWORD=[0-9a-f]{48}$/m);
  assert.equal(Buffer.from(/^PLATFORM_ENCRYPTION_KEY=(.+)$/m.exec(text)[1], 'base64url').length, 32);
  assert.deepEqual(fillSecrets(text).filled, [], 'a second run changes nothing');
});

test('the .env signing key and the PEM are the same Ed25519 key', () => {
  const { signing } = fillSecrets(template);
  const raw = Buffer.from(signing.env, 'base64url');
  assert.equal(raw.length, 64);
  assert.equal(raw.subarray(32).toString('base64url'), signing.publicKey, 'Go layout: seed then public key');
  const message = Buffer.from('manifest');
  const signature = sign(null, message, createPrivateKey(signing.pem));
  const publicKey = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: signing.publicKey }, format: 'jwk' });
  assert.ok(verify(null, message, publicKey, signature));
  assert.equal(signingKeyFromEnv(signing.env).pem, signing.pem, 'the PEM can be rebuilt from the .env');
  assert.throws(() => signingKeyFromEnv(Buffer.alloc(64, 1).toString('base64url')), /does not match/);
});
