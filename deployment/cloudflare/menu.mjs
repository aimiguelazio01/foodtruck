const quarterHour = 900_000;

function pickupSlots(config, events, capacity, preparation, now) {
  if (!config?.is_open) return [];
  const used = new Map(capacity.map(row => [row.pickup_at, row.total]));
  const slots = new Set();
  for (const event of events) {
    const start = Math.ceil(Math.max(event.starts_at, now + preparation * 60_000) / quarterHour) * quarterHour;
    for (let time = start; time < Math.min(event.ends_at, now + 604_800_000); time += quarterHour) {
      if ((used.get(time) ?? 0) < config.slot_capacity) slots.add(time);
      if (slots.size === 96) return [...slots].sort((a, b) => a - b);
    }
  }
  return [...slots].sort((a, b) => a - b);
}

export async function readPublicMenu(db, slug, now = Date.now()) {
  const record = await db.prepare(`SELECT b.id,b.slug,b.name,b.color,b.catalog_revision FROM businesses b
    LEFT JOIN organization_trucks t ON t.business_id=b.id
    WHERE b.slug=? AND COALESCE(t.archived,0)=0`).bind(slug).first();
  if (!record) return null;
  const { catalog_revision: catalogRevision, ...business } = record;
  const statements = [
    [`SELECT p.id,p.business_id,p.name,p.price_cents,
      CASE WHEN p.available=1 AND NOT EXISTS (
        SELECT 1 FROM recipes r JOIN inventory i ON i.id=r.inventory_id
        WHERE r.product_id=p.id AND i.quantity-i.reserved<r.quantity
      ) THEN 1 ELSE 0 END AS available,
      d.category,d.description,d.allergens,d.image,d.extra_name,d.extra_cents,d.variant_name,
      d.variant_cents,d.promotion_cents,d.ingredients,d.tags,d.prep_minutes
      FROM products p LEFT JOIN product_details d ON d.product_id=p.id
      WHERE p.business_id=? ORDER BY p.name,p.id`, business.id],
    [`SELECT g.id,g.product_id,g.name,g.min_count,g.max_count,o.id AS option_id,o.name AS option_name,o.price_cents
      FROM modifier_groups g JOIN products p ON p.id=g.product_id
      LEFT JOIN modifier_options o ON o.group_id=g.id WHERE p.business_id=? ORDER BY g.id,o.id`, business.id],
    [`SELECT description,contact,address,latitude,longitude,is_open,logo,secondary_color,appearance,
      accent_color,social_links,cover,background_color,font_family,page_layout,slot_capacity
      FROM business_settings WHERE business_id=?`, business.id],
    ['SELECT * FROM events WHERE business_id=? AND is_public=1 ORDER BY starts_at,id', business.id],
    [`SELECT pickup_at,COUNT(*) AS total FROM orders
      WHERE business_id=? AND pickup_at>? AND status<>'cancelled' GROUP BY pickup_at`, business.id, now],
    [`SELECT MAX(d.prep_minutes) AS minutes FROM products p JOIN product_details d ON d.product_id=p.id
      WHERE p.business_id=? AND p.available=1`, business.id],
  ];
  const [products, choices, settings, events, capacity, prep] = (await db.batch(
    statements.map(([sql, ...params]) => db.prepare(sql).bind(...params)),
  )).map(result => result.results);
  const groups = new Map();
  const groupsByProduct = new Map(products.map(product => [product.id, []]));
  for (const row of choices) {
    let group = groups.get(row.id);
    if (!group) {
      const { id, product_id, name, min_count, max_count } = row;
      group = { id, product_id, name, min_count, max_count, options: [] };
      groups.set(id, group);
      groupsByProduct.get(product_id).push(group);
    }
    if (row.option_id !== null) group.options.push({ id: row.option_id, name: row.option_name, price_cents: row.price_cents });
  }
  const { slot_capacity, ...config } = settings[0] ?? {};
  return {
    business, catalogRevision, products: products.map(product => ({ ...product, groups: groupsByProduct.get(product.id) })),
    config: settings[0] ? config : null, events,
    slots: pickupSlots(settings[0], events, capacity, prep[0]?.minutes || 15, now),
  };
}
