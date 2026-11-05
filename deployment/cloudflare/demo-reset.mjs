import { buildDemoSeed } from '../demo/seed-d1.mjs';
import { isDemo } from './demo-mode.mjs';

// The seed package ({ fixture, schema }, built by deployment/demo/build-seed-package.mjs) lives in the demonstration's own
// R2 bucket under this key, not in the Worker bundle, so ordinary customer installations do not carry the fictional data.
export const seedKey = 'demo/fixture.json';
const stampKey = 'demo/last-reset';
const day = 86_400_000;
const chunk = 80;

/** Wipes the demonstration's volatile data and loads the fixture again, dates shifted to now. */
export async function resetDemo(env, now = Date.now()) {
  const object = await env.MEDIA?.get(seedKey);
  if (!object) return { skipped: true, reason: 'no-seed' };
  const { fixture, schema } = await object.json();
  const statements = buildDemoSeed(fixture, schema, now);
  for (let index = 0; index < statements.length; index += chunk) {
    await env.DB.batch(statements.slice(index, index + chunk).map(({ sql, params }) => env.DB.prepare(sql).bind(...params)));
  }
  await env.MEDIA.put(stampKey, String(now));
  return { reset: true, statements: statements.length };
}

const encoder = new TextEncoder();
const maxSeed = 2_000_000;

// Constant-time comparison of two secrets of any length: HMAC both under a throw-away key and compare the digests.
async function sameSecret(candidate, secret) {
  const key = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const [a, b] = await Promise.all([candidate, secret].map(value => crypto.subtle.sign('HMAC', key, encoder.encode(value))));
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}

/** PUT /api/v1/demo/seed: the operator stores the seed package in R2 and resets the demonstration at once. Token only. */
export async function demoSeedRoute(request, env) {
  if (!isDemo(env) || request.method !== 'PUT') return null;
  const json = (body, status) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  const token = request.headers.get('x-demo-token');
  if (!env.DEMO_TOKEN || env.DEMO_TOKEN.length < 32 || !token || !await sameSecret(token, env.DEMO_TOKEN)) {
    return json({ message: 'Token da demonstração inválido.' }, 403);
  }
  const text = await request.text();
  if (text.length > maxSeed) return json({ message: 'Pacote demasiado grande.' }, 413);
  let seed;
  try { seed = JSON.parse(text); } catch { return json({ message: 'Pacote inválido.' }, 400); }
  if (!seed?.fixture?.tables || !seed.schema || typeof seed.fixture.capturedAt !== 'number') return json({ message: 'Pacote inválido.' }, 400);
  await env.MEDIA.put(seedKey, text);
  return json(await resetDemo(env), 200);
}

/** Called from the cron trigger: at most one reset per day, and only in demo mode. */
export async function resetDemoIfDue(env, now = Date.now()) {
  if (!isDemo(env)) return { skipped: true };
  const last = Number(await (await env.MEDIA?.get(stampKey))?.text());
  if (Number.isFinite(last) && now - last < day) return { skipped: true, reason: 'recent' };
  return resetDemo(env, now);
}
