// Request helpers shared by the API Worker entry point and its route modules.
const encoder = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');

export const sha256 = async value => hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));

export const json = (body, status = 200, headers = {}) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Foodtruck-Updates': 'poll', ...headers },
});

export function sessionToken(request) {
  return request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1] ??
    request.headers.get('cookie')?.match(/(?:^|;\s*)staff_session=([a-f0-9]{64})(?:;|$)/)?.[1];
}

export async function sessionUser(request, db) {
  const token = sessionToken(request);
  if (!token) return null;
  return db.prepare(`SELECT u.id,u.email FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.hash=? AND s.expires>?`).bind(await sha256(token), Date.now()).first();
}

/** State-changing browser requests must come from the management site (no CSRF tokens; Origin must match exactly). */
export const originAllowed = (request, env) =>
  Boolean(env.MANAGEMENT_ORIGIN) && request.headers.get('origin') === env.MANAGEMENT_ORIGIN;
