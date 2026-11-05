import { initializeD1Business, isD1Configured } from './d1-installation.mjs';
import { hashPassword } from './passwords.mjs';
import { setupError } from './setup-errors.mjs';

const encoder = new TextEncoder();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const colorPattern = /^#[0-9a-f]{6}$/i;
const headers = { 'Cache-Control': 'no-store' };
const json = (body, status = 200) => Response.json(body, { status, headers });

export async function installationAuthorized(request, env) {
  const token = request.headers.get('x-install-token');
  const secret = env.INSTALL_TOKEN;
  if (!token || !secret || secret.length < 32 || token.length !== secret.length ||
      !(Date.parse(env.INSTALL_TOKEN_EXPIRES_AT) > Date.now())) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const payload = encoder.encode('foodtruck-bootstrap');
  const candidate = await crypto.subtle.importKey('raw', encoder.encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', candidate, payload);
  return crypto.subtle.verify('HMAC', key, signature, payload);
}

export async function readBoundedJSON(request, limit = 8192) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const data = new Uint8Array(limit);
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.length > data.length) {
        await reader.cancel();
        return null;
      }
      data.set(value, length);
      length += value.length;
    }
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(0, length)));
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

async function readInput(request) {
  const body = await readBoundedJSON(request);
  if (!body) return null;
  const limits = { email: 254, password: 256, name: 100, address: 300, phone: 50, contactEmail: 254, primaryColor: 7, secondaryColor: 7 };
  for (const [key, limit] of Object.entries(limits)) {
    if (typeof body[key] !== 'string' || body[key].length > limit) return null;
    if (key !== 'password') body[key] = body[key].trim();
  }
  if (!body.name || body.password.length < 12 || !emailPattern.test(body.email) ||
      (body.contactEmail && !emailPattern.test(body.contactEmail)) ||
      !colorPattern.test(body.primaryColor) || !colorPattern.test(body.secondaryColor)) return null;
  return body;
}

// Mount on the private API Worker. The deployment must disable public routes and previews.
export async function handleInstallation(request, env, trace) {
  const path = new URL(request.url).pathname;
  if (path === '/api/v1/installation/status' && request.method === 'GET') {
    return json({ configured: await isD1Configured(env.DB), demo: env.DEMO_MODE === '1', readOnly: false });
  }
  if (path !== '/api/v1/installation/complete' || request.method !== 'POST') return null;
  if (!await installationAuthorized(request, env)) return json({ message: 'Token de configuração inválido ou expirado.' }, 403);
  const conflict = () => json({ message: 'O sistema já está configurado.' }, 409);
  if (await isD1Configured(env.DB)) return conflict();
  const body = await readInput(request);
  if (!body) return json({ message: 'Verifique os dados de configuração.' }, 400);
  let stage = 'password';
  try {
    const passwordHash = await hashPassword(body.password);
    stage = 'business-transaction';
    await initializeD1Business(env.DB, {
      ...body, email: body.email.toLowerCase(), passwordHash, logo: '', bootstrapID: env.BOOTSTRAP_ID ?? null,
    });
    return json({ ok: true }, 201);
  } catch (error) {
    if (trace) Object.assign(trace, { stage: `installation:${stage}`, cause: error });
    if (await isD1Configured(env.DB)) return conflict();
    return setupError(stage, stage === 'password' ? 'PASSWORD_DERIVATION_FAILED' : 'BUSINESS_INITIALIZATION_FAILED');
  }
}
