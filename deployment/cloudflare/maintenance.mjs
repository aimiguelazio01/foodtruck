import { changeManagedOrder } from './order-change.mjs';

const day = 86_400_000;
const leaseDuration = 180_000;

export async function runMaintenance(db, now = Date.now()) {
  const mode = await db.prepare('SELECT mode FROM installation_state WHERE id=1').first();
  if (mode?.mode !== 'system') return { skipped: true };
  const owner = crypto.randomUUID();
  const started = Date.now();
  const lease = await db.prepare(`INSERT INTO worker_maintenance_lease(id,owner,expires_at) VALUES (1,?,?)
    ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at
    WHERE worker_maintenance_lease.expires_at<=? RETURNING owner`).bind(owner, started + leaseDuration, started).first();
  if (!lease) return { skipped: true };
  try {
    return await cleanExpired(db, now, owner);
  } finally {
    await db.prepare('DELETE FROM worker_maintenance_lease WHERE id=1 AND owner=?').bind(owner).run();
  }
}

async function renew(db, owner) {
  const now = Date.now();
  return db.prepare(`UPDATE worker_maintenance_lease SET expires_at=?
    WHERE id=1 AND owner=? AND expires_at>? RETURNING owner`).bind(now + leaseDuration, owner, now).first();
}

async function cleanExpired(db, now, owner) {
  const { results: expired } = await db.prepare(`SELECT id,business_id,version FROM orders
    WHERE status='pending' AND created_at<? ORDER BY created_at,id LIMIT 25`).bind(now - 900_000).all();
  let cancelled = 0;
  for (const order of expired) {
    if (!await renew(db, owner)) return { cancelled, skipped: true };
    // The version check makes each cancellation safe even if another schedule
    // or a staff member picked up the same order before this batch ran.
    const outcome = await changeManagedOrder(db, order.business_id, order.id, null, 'expiration', {
      status: 'cancelled', version: order.version,
    });
    if (outcome.status === 200) cancelled++;
    else if (outcome.status !== 404 && outcome.status !== 409) throw new Error('Maintenance could not expire an order');
  }
  const temporary = [
    ['customer_sessions', 'expires'], ['customer_verifications', 'expires'],
    ['customer_password_resets', 'expires'], ['sessions', 'expires'], ['password_resets', 'expires'],
    ['login_attempts', 'reset'], ['request_limits', 'expires'],
  ];
  if (!await renew(db, owner)) return { cancelled, skipped: true };
  await db.batch([
    db.prepare('DELETE FROM domain_events WHERE created_at<?').bind(now - 7 * day),
    db.prepare(`UPDATE orders SET customer_name='Cliente anonimizado',contact=''
      WHERE status IN ('collected','cancelled') AND (contact<>'' OR customer_name<>'Cliente anonimizado')
      AND EXISTS(SELECT 1 FROM business_settings s WHERE s.business_id=orders.business_id
        AND orders.created_at<?-s.retention_days*86400000)`).bind(now),
    db.prepare(`DELETE FROM customer_notes WHERE EXISTS(SELECT 1 FROM business_settings s WHERE s.business_id=customer_notes.business_id)
      AND NOT EXISTS(SELECT 1 FROM orders o WHERE o.business_id=customer_notes.business_id AND o.contact=customer_notes.contact)`),
    ...temporary.map(([table, column]) => db.prepare(`DELETE FROM ${table} WHERE ${column}<?`).bind(now)),
  ]);
  return { cancelled };
}
