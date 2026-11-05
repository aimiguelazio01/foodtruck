const ACTIVE_TTL_MS = 5 * 60 * 1000;
const INACTIVE_TTL_MS = 60 * 1000;
const GRACE_MS = 72 * 60 * 60 * 1000;

// Per-isolate memory in front of the D1 table, so most requests need neither the portal nor the database.
const cache = new Map();

export function resetHostingCache() {
  cache.clear();
}

function suspended() {
  return Response.json({ message: 'O alojamento está suspenso. Contacte o responsável pela subscrição.' }, { status: 402, headers: { 'Cache-Control': 'no-store' } });
}

function unavailable() {
  return Response.json({ message: 'Não foi possível verificar o alojamento. Tente novamente mais tarde.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
}

// The last answer is kept in D1 so the 72-hour grace period survives Worker restarts. An installation
// created before this table existed simply has no stored answer; storage failures never block a request.
async function loadStored(env) {
  try {
    const row = await env.DB?.prepare('SELECT active,checked_at,last_active_at FROM hosting_status WHERE id=1').first();
    return row ? { active: row.active === 1, checkedAt: row.checked_at, lastActiveAt: row.last_active_at ?? undefined } : undefined;
  } catch {
    return undefined;
  }
}

async function saveStored(env, entry) {
  try {
    await env.DB?.prepare(`INSERT INTO hosting_status(id,active,checked_at,last_active_at) VALUES (1,?,?,?)
      ON CONFLICT(id) DO UPDATE SET active=excluded.active,checked_at=excluded.checked_at,last_active_at=excluded.last_active_at`)
      .bind(entry.active ? 1 : 0, entry.checkedAt, entry.lastActiveAt ?? null).run();
  } catch {
    // Keep serving from memory.
  }
}

export async function hostingAccess(env, now = Date.now(), trace) {
  if (!env.SUBSCRIPTION_STATUS_URL) return null;
  const key = `${env.SUBSCRIPTION_STATUS_URL}\n${env.SUBSCRIPTION_TOKEN}`;
  let known = cache.get(key);
  if (known && now - known.checkedAt < (known.active ? ACTIVE_TTL_MS : INACTIVE_TTL_MS)) {
    return known.active ? null : suspended();
  }
  if (!known) {
    known = await loadStored(env);
    if (known) {
      cache.set(key, known);
      if (now - known.checkedAt < (known.active ? ACTIVE_TTL_MS : INACTIVE_TTL_MS)) return known.active ? null : suspended();
    }
  }
  try {
    const url = new URL(env.SUBSCRIPTION_STATUS_URL);
    if (url.protocol !== 'https:' || !env.SUBSCRIPTION_TOKEN) throw new Error('Invalid hosting configuration');
    const response = await fetch(url, { headers: { Authorization: `Bearer ${env.SUBSCRIPTION_TOKEN}` }, redirect: 'manual', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Hosting status unavailable');
    const state = await response.json();
    if (state.active !== true && state.active !== false) throw new Error('Invalid hosting status');
    const entry = { active: state.active, checkedAt: now, lastActiveAt: state.active ? now : known?.lastActiveAt };
    cache.set(key, entry);
    await saveStored(env, entry);
    return state.active ? null : suspended();
  } catch (error) {
    // Portal unreachable: keep serving a site that was recently confirmed active.
    if (known?.active && known.lastActiveAt !== undefined && now - known.lastActiveAt < GRACE_MS) return null;
    if (trace) trace.cause = error;
    return unavailable();
  }
}
