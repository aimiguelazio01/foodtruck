import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

const encoder = new TextEncoder();
const iterations = 600_000;
const algorithm = 'pbkdf2-sha256';
const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
const fromHex = value => Uint8Array.from(value.match(/../g), pair => Number.parseInt(pair, 16));

async function derive(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  try {
    return await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations, salt }, key, 256);
  } catch (error) {
    // Production Workers can enforce a lower cap than local workerd.
    if (error?.name !== 'NotSupportedError' || !/iteration.*(?:100000|100,000|not supported|limit)/i.test(error.message)) throw error;
    return pbkdf2Async(sha256, encoder.encode(password), salt, { c: iterations, dkLen: 32 });
  }
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `${algorithm}$${iterations}$${hex(salt)}$${hex(await derive(password, salt))}`;
}

export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || password.length > 256) return false;
  const [scheme, rounds, salt, hash, ...extra] = (stored ?? '').split('$');
  const valid = scheme === algorithm && rounds === String(iterations) && /^[0-9a-f]{32}$/.test(salt) &&
    /^[0-9a-f]{64}$/.test(hash) && extra.length === 0;
  const actual = new Uint8Array(await derive(password, valid ? fromHex(salt) : new Uint8Array(16)));
  const expected = valid ? fromHex(hash) : new Uint8Array(32);
  let difference = 0;
  for (let i = 0; i < actual.length; i++) difference |= actual[i] ^ expected[i];
  return valid && difference === 0;
}
