const transitions = new Map([
  ['pending', ['confirmed', 'cancelled']], ['confirmed', ['preparing', 'cancelled']],
  ['preparing', ['ready', 'cancelled']], ['ready', ['collected', 'cancelled']],
]);

export async function changeManagedOrder(db, business, id, actor, action, input) {
  const query = (sql, ...params) => db.prepare(sql).bind(...params);
  const current = () => query('SELECT status,payment,version FROM orders WHERE business_id=? AND id=?', business, id).first();
  const order = await current();
  if (!order) return { status: 404, message: 'Encomenda não encontrada.' };
  const conflict = { status: 409, message: 'A encomenda mudou. Atualize a lista e tente novamente.' };
  if (input.version !== undefined && input.version !== order.version) return conflict;
  const paying = action === 'payment';
  const next = paying ? order.status : input.status;
  if (paying && order.status !== 'ready') return { status: 400, message: 'A encomenda deve estar pronta.' };
  if (!paying && next !== order.status && !transitions.get(order.status)?.includes(next)) {
    return { status: 400, message: 'Transição inválida.' };
  }
  if (next === 'collected' && !['paid_collection', 'demo_paid'].includes(order.payment)) {
    return { status: 400, message: 'Registe o pagamento na recolha.' };
  }
  const now = Date.now();
  const payment = paying && order.payment !== 'demo_paid' ? 'paid_collection' : order.payment;
  const statements = [
    query('UPDATE orders SET status=?,payment=?,version=version+1 WHERE business_id=? AND id=? AND version=?',
      next, payment, business, id, order.version),
    // The audit insert fails the whole batch if the version check updated no row.
    query(`INSERT INTO audit_events(id,business_id,user_id,action,created_at)
      VALUES (?,CASE WHEN changes()=1 THEN ? END,?,?,?)`,
    crypto.randomUUID(), business, actor, paying ? `payment:${id}:collection` : `order:${id}:${next}${action === 'expiration' ? ':expired' : ''}`, now),
  ];
  if (next !== order.status && (next === 'preparing' || next === 'cancelled')) {
    const consumes = next === 'preparing';
    const reservations = "SELECT inventory_id,quantity FROM reservations WHERE order_id=? AND state='reserved'";
    statements.push(query(`WITH pending AS (${reservations}) UPDATE inventory
      SET reserved=reserved-(SELECT quantity FROM pending WHERE inventory_id=inventory.id),
      quantity=quantity-?*(SELECT quantity FROM pending WHERE inventory_id=inventory.id)
      WHERE id IN (SELECT inventory_id FROM pending)`, id, consumes ? 1 : 0));
    if (consumes) {
      statements.push(query(`INSERT INTO stock_movements(id,inventory_id,delta,reason,order_id,created_at)
        SELECT lower(hex(randomblob(16))),inventory_id,-quantity,'preparation',?,? FROM (${reservations})`, id, now, id));
    } else {
      statements.push(query("UPDATE stock_movements SET reason='waste_cancelled' WHERE order_id=? AND reason='preparation'", id));
    }
    statements.push(query("UPDATE reservations SET state=? WHERE order_id=? AND state='reserved'", consumes ? 'consumed' : 'released', id));
  }
  statements.push(query("INSERT INTO domain_events(id,business_id,entity,created_at) VALUES (?,?,'orders',?)", crypto.randomUUID(), business, now));
  try {
    await db.batch(statements);
  } catch (error) {
    if ((await current())?.version !== order.version) return conflict;
    throw error;
  }
  return { status: 200 };
}
