import { json, originAllowed, sha256 } from './http.mjs';
import { clientRateIdentity, takeRequestSlot } from './rate-limits.mjs';

// Shared demonstration site: DEMO_MODE=1 on the API Worker. Visitors enter as a fixed demo user without a password,
// can look around and edit a little, but cannot touch payments, company settings, images, accounts or email.
export const isDemo = env => env.DEMO_MODE === '1';

const sessionSeconds = 3_600;
const blockedMessage = 'Demonstração: esta ação não está disponível. Instale a sua própria aplicação para a usar.';

// Method + path patterns that stay closed in the demonstration.
const blocked = [
  ['POST', /^\/api\/v1\/manage\/businesses\/[a-zA-Z0-9-]{1,100}\/orders\/[0-9a-f-]{36}\/payment$/],
  ['POST', /^\/api\/v1\/network\/[a-zA-Z0-9-]{1,100}\/(company|branding)$/],
  ['POST', /^\/api\/v1\/network\/[a-zA-Z0-9-]{1,100}\/company\/images$/],
  ['POST', /^\/api\/v1\/manage\/businesses\/[a-zA-Z0-9-]{1,100}\/images$/],
  ['POST', /^\/api\/v1\/manage\/businesses\/[a-zA-Z0-9-]{1,100}\/users$/],
  ['PATCH', /^\/api\/v1\/manage\/businesses\/[a-zA-Z0-9-]{1,100}\/users\/[a-zA-Z0-9-]{1,100}\/permissions$/],
  ['POST', /^\/api\/v1\/customer\/(register|verify|resend-verification|forgot-password|reset-password)$/],
  ['POST', /^\/api\/v1\/auth\/(forgot-password|reset-password)$/],
];

/** A 403 for actions the demonstration does not allow, otherwise null. Always null outside demo mode. */
export function demoBlock(request, env) {
  if (!isDemo(env)) return null;
  const { pathname } = new URL(request.url);
  return blocked.some(([method, pattern]) => request.method === method && pattern.test(pathname))
    ? json({ message: blockedMessage }, 403) : null;
}

/** POST /api/v1/demo/session: starts a one-hour session for the demo owner. Does not exist outside demo mode. */
export async function demoSession(request, env) {
  if (!isDemo(env)) return null;
  if (!originAllowed(request, env)) return json({ message: 'Origem do pedido inválida.' }, 403);
  if (!await takeRequestSlot(env.DB, 'demo-session', await clientRateIdentity(request), 30, 900_000)) {
    return json({ message: 'Demasiados pedidos. Tente novamente mais tarde.' }, 429, { 'Retry-After': '900' });
  }
  const owner = await env.DB.prepare(`SELECT u.id,u.email FROM users u JOIN organization_members m ON m.user_id=u.id
    WHERE m.role='network_owner' ORDER BY u.email LIMIT 1`).first();
  if (!owner) return json({ message: 'A demonstração ainda não tem dados.' }, 503);
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
  await env.DB.prepare('INSERT INTO sessions(hash,user_id,expires) VALUES (?,?,?)')
    .bind(await sha256(token), owner.id, Date.now() + sessionSeconds * 1000).run();
  return json({ user: { id: owner.id, email: owner.email }, demo: true }, 200, {
    'Set-Cookie': `staff_session=${token}; HttpOnly; SameSite=Lax; Secure; Path=/; Max-Age=${sessionSeconds}`,
  });
}
