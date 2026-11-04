const encoder = new TextEncoder();

export async function clientRateIdentity(request) {
  const address = request.headers.get('CF-Connecting-IP');
  if (!address || address.length > 64 || !/^[0-9a-f.:]+$/i.test(address)) return 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(address));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function takeRequestSlot(db, scope, identity, limit, windowMs, now = Date.now()) {
  const result = await db.prepare(`INSERT INTO request_limits(key,count,expires) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires<=? THEN 1 ELSE count+1 END,
    expires=CASE WHEN expires<=? THEN excluded.expires ELSE expires END
    WHERE expires<=? OR count<? RETURNING count`).bind(`${scope}:${identity}`, now + windowMs, now, now, now, limit).first();
  return result !== null;
}
