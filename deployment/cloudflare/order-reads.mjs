export function trackingToken(request, id) {
  const valid = /^[a-f0-9]{64}$/;
  const query = new URL(request.url).searchParams.get('token');
  if (query && valid.test(query)) return query;
  const prefix = `ft_track_${id}=`;
  const pair = request.headers.get('cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith(prefix));
  const cookie = pair?.slice(prefix.length);
  return cookie && valid.test(cookie) ? cookie : null;
}

export async function readTrackedOrder(db, id, tokenHash) {
  const order = await db.prepare(`SELECT o.id,o.status,o.payment,o.total_cents,o.created_at,o.pickup_at,
    o.location_snapshot,b.slug AS business_slug,b.name AS business_name,0 AS is_associated
    FROM orders o JOIN businesses b ON b.id=o.business_id WHERE o.id=? AND o.request_hash=?`).bind(id, tokenHash).first();
  if (!order) return null;
  const { results: items } = await db.prepare(`SELECT name,quantity,unit_cents,customization
    FROM order_items WHERE order_id=? ORDER BY product_id`).bind(id).all();
  return { ...order, is_associated: false, items };
}

export async function orderAccess(db, userID, businessID) {
  const access = await db.prepare(`SELECT role,permissions FROM (
    SELECT 'owner' AS role,NULL AS permissions,0 AS priority FROM organization_members om
    JOIN organization_trucks t ON t.organization_id=om.organization_id
    WHERE om.user_id=? AND t.business_id=? AND om.role IN ('network_owner','network_admin')
    UNION ALL SELECT m.role,p.permissions,1 AS priority FROM memberships m
    LEFT JOIN membership_permissions p ON p.user_id=m.user_id AND p.business_id=m.business_id
    WHERE m.user_id=? AND m.business_id=?
  ) ORDER BY priority LIMIT 1`).bind(userID, businessID, userID, businessID).first();
  if (!access || !['owner', 'truck_admin', 'manager', 'staff'].includes(access.role)) return null;
  if (access.permissions && !['owner', 'truck_admin'].includes(access.role) && JSON.parse(access.permissions).orders !== true) return null;
  return access.role;
}

export async function readManagedOrders(db, businessID, role) {
  const [orders, items] = await db.batch([
    db.prepare(`SELECT id,business_id,customer_name,${role === 'staff' ? 'NULL AS contact' : 'contact'},
      total_cents,status,payment,created_at,pickup_at,event_id,location_snapshot,customer_id,version
      FROM orders WHERE business_id=? ORDER BY created_at DESC,id`).bind(businessID),
    db.prepare(`SELECT i.* FROM order_items i JOIN orders o ON o.id=i.order_id
      WHERE o.business_id=? ORDER BY i.product_id`).bind(businessID),
  ]);
  const byID = new Map(orders.results.map(order => {
    if (role === 'staff') delete order.contact;
    order.items = [];
    return [order.id, order];
  }));
  for (const item of items.results) byID.get(item.order_id).items.push(item);
  return orders.results;
}

export async function readOrderHistory(db, businessID, orderID) {
  const order = await db.prepare('SELECT id FROM orders WHERE business_id=? AND id=?').bind(businessID, orderID).first();
  if (!order) return null;
  const { results } = await db.prepare(`SELECT action,user_id,created_at FROM audit_events
    WHERE business_id=? AND (action LIKE ? OR action LIKE ?) ORDER BY created_at,id`)
    .bind(businessID, `order:${orderID}:%`, `payment:${orderID}:%`).all();
  return results;
}
