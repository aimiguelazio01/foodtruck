// The caller calculates prices and ingredient requirements from the catalogue.
// Commit the resulting snapshot and reservations in one D1 transaction.
export async function commitCheckout(db, order) {
  const { id, businessId, requestHash, payloadHash, name, contact, total, pickupAt,
    eventId, location, items, ingredients, customerId, createdAt, catalogRevision } = order;
  const query = (sql, ...params) => db.prepare(sql).bind(...params);
  const statements = [query(`INSERT INTO orders (
    id,business_id,request_hash,payload_hash,customer_name,contact,total_cents,created_at,
    pickup_at,event_id,location_snapshot,customer_id
  ) SELECT ?,CASE WHEN EXISTS (
    SELECT 1 FROM business_settings s LEFT JOIN organization_trucks t ON t.business_id=s.business_id
    JOIN events e ON e.business_id=s.business_id
    JOIN businesses b ON b.id=s.business_id
    WHERE s.business_id=? AND b.catalog_revision=? AND s.is_open=1 AND COALESCE(t.archived,0)=0
    AND e.id=? AND e.is_public=1 AND e.starts_at<=? AND e.ends_at>?
    AND s.slot_capacity>(SELECT COUNT(*) FROM orders o WHERE o.business_id=s.business_id
      AND o.pickup_at=? AND o.status<>'cancelled')
    AND 5>(SELECT COUNT(*) FROM orders o WHERE o.business_id=s.business_id AND o.contact=? AND o.status='pending')
  ) THEN ? ELSE NULL END,?,?,?,?,?,?,?,?,?,?`, id, businessId, catalogRevision, eventId, pickupAt, pickupAt,
  pickupAt, contact, businessId, requestHash, payloadHash, name, contact, total, createdAt,
  pickupAt, eventId, location, customerId ?? null)];

  for (const item of items) {
    statements.push(query(`INSERT INTO order_items(order_id,product_id,name,quantity,unit_cents,customization,category)
      VALUES (?,?,?,?,?,?,?)`, id, item.id, item.name, item.quantity, item.unit, item.customization, item.category));
  }
  for (const [ingredientID, quantity] of ingredients) {
    // A missing or foreign ingredient fails the reservation's NOT NULL constraint.
    // Insufficient stock fails inventory's reserved <= quantity constraint.
    statements.push(query(`INSERT INTO reservations(order_id,inventory_id,quantity)
      VALUES (?, (SELECT id FROM inventory WHERE id=? AND business_id=? AND deleted_at IS NULL), ?)`,
    id, ingredientID, businessId, quantity));
    statements.push(query('UPDATE inventory SET reserved=reserved+? WHERE id=? AND business_id=?', quantity, ingredientID, businessId));
  }
  statements.push(query("INSERT INTO domain_events(id,business_id,entity,created_at) VALUES (?,?,'orders',?)", crypto.randomUUID(), businessId, createdAt));
  try {
    await db.batch(statements);
    return id;
  } catch (error) {
    const existing = await query('SELECT id,business_id,payload_hash FROM orders WHERE request_hash=?', requestHash).first();
    if (!existing) throw error;
    if (existing.business_id !== businessId || existing.payload_hash !== payloadHash) {
      throw new Error('Chave já utilizada para outra encomenda.', { cause: error });
    }
    return existing.id;
  }
}
