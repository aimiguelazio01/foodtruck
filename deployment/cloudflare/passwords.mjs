const encoder = new TextEncoder();
const iterations = 600_000;
const algorithm = 'pbkdf2-sha256';
const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
const fromHex = value => Uint8Array.from(value.match(/../g), pair => Number.parseInt(pair, 16));

async function derive(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations, salt }, key, 256);
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
