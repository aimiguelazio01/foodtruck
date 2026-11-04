import { commitCheckout } from './checkout-write.mjs';
import { readBoundedJSON } from './installation-worker.mjs';
import { readPublicMenu } from './menu.mjs';

const encoder = new TextEncoder();
async function hash(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

const error = (message, status = 400) => Response.json({ message }, { status, headers: { 'Cache-Control': 'no-store' } });
const accepted = (id, key) => Response.json({ id }, { headers: { 'Cache-Control': 'no-store',
  'Set-Cookie': `ft_track_${id}=${key}; HttpOnly; SameSite=Lax; Secure; Path=/; Max-Age=604800` } });

function normalize(body) {
  if (!body || typeof body.requestKey !== 'string' || !/^[a-f0-9]{64}$/.test(body.requestKey) ||
    typeof body.name !== 'string' || !body.name.trim() || body.name.length > 100 ||
    typeof body.contact !== 'string' || body.contact.trim().length < 5 || body.contact.length > 254 ||
    !Number.isSafeInteger(body.pickupAt) || (body.paymentMethod ?? 'collection') !== 'collection' ||
    !Array.isArray(body.items) || body.items.length < 1 || body.items.length > 30 ||
    (body.expectedTotal !== undefined && (!Number.isSafeInteger(body.expectedTotal) || body.expectedTotal < 0))) return null;
  const seen = new Set();
  const items = [];
  for (const item of body.items) {
    const optionIds = item?.optionIds ?? [];
    if (!item || typeof item.id !== 'string' || item.id.length > 100 || seen.has(item.id) ||
      !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20 ||
      !Array.isArray(optionIds) || optionIds.length > 100 || optionIds.some(id => typeof id !== 'string' || id.length > 100) ||
      new Set(optionIds).size !== optionIds.length || ['extra', 'variant'].some(key => item[key] !== undefined && typeof item[key] !== 'boolean')) return null;
    seen.add(item.id);
    items.push({ id: item.id, quantity: item.quantity, optionIds: [...optionIds].sort(), variant: !!item.variant, extra: !!item.extra });
  }
  return { name: body.name.trim(), contact: body.contact.trim(), pickupAt: body.pickupAt, items, expectedTotal: body.expectedTotal ?? null };
}

export async function checkoutRoute(request, db, slug) {
  const body = await readBoundedJSON(request);
  const input = normalize(body);
  if (!input) return error('Verifique o carrinho, o contacto e o horário de recolha.');
  const createdAt = Date.now();
  const menu = await readPublicMenu(db, slug, createdAt);
  if (!menu) return error('Negócio não encontrado.', 404);
  const businessId = menu.business.id;
  const [requestHash, payloadHash] = await Promise.all([hash(body.requestKey), hash(JSON.stringify({ businessId, ...input }))]);
  const existing = await db.prepare('SELECT id,business_id,payload_hash FROM orders WHERE request_hash=?').bind(requestHash).first();
  if (existing) {
    return existing.business_id === businessId && existing.payload_hash === payloadHash ? accepted(existing.id, body.requestKey) : error('Chave já utilizada para outra encomenda.', 409);
  }
  const event = menu.events.find(row => row.starts_at <= input.pickupAt && row.ends_at > input.pickupAt);
  if (!event || !menu.slots.includes(input.pickupAt)) return error('Escolha um horário de recolha disponível.', 409);
  const queries = [
    db.prepare('SELECT product_id FROM event_products WHERE event_id=?').bind(event.id),
    db.prepare(`SELECT r.product_id,r.inventory_id,r.quantity FROM recipes r JOIN products p ON p.id=r.product_id WHERE p.business_id=?`).bind(businessId),
    db.prepare(`SELECT o.id,o.inventory_id,o.quantity FROM modifier_options o JOIN modifier_groups g ON g.id=o.group_id
      JOIN products p ON p.id=g.product_id WHERE p.business_id=? AND o.inventory_id IS NOT NULL`).bind(businessId),
    db.prepare(`SELECT d.product_id,d.extra_inventory_id FROM product_details d JOIN products p ON p.id=d.product_id
      WHERE p.business_id=? AND d.extra_inventory_id IS NOT NULL`).bind(businessId),
  ];
  const [allowed, recipes, options, extras] = (await db.batch(queries)).map(row => row.results);
  const allowedProducts = new Set(allowed.map(row => row.product_id));
  const requirements = new Map();
  const add = (id, quantity) => requirements.set(id, (requirements.get(id) ?? 0) + quantity);
  const items = [];
  let total = 0;
  for (const item of input.items) {
    const product = menu.products.find(row => row.id === item.id);
    if (!product?.available || (allowedProducts.size && !allowedProducts.has(item.id))) return error('Produto indisponível nesta paragem.', 409);
    if ((item.variant && !product.variant_name) || (item.extra && !product.extra_name)) return error('Escolha inválida.');
    const labels = [item.variant && product.variant_name, item.extra && product.extra_name].filter(Boolean);
    const selected = new Set(item.optionIds);
    let unit = (product.promotion_cents ?? product.price_cents) + (item.variant ? product.variant_cents : 0) + (item.extra ? product.extra_cents : 0);
    for (const group of product.groups) {
      const choices = group.options.filter(option => selected.delete(option.id));
      if (choices.length < group.min_count || choices.length > group.max_count) return error('Verifique as opções do produto.');
      for (const choice of choices) {
        unit += choice.price_cents;
        labels.push(`${group.name}: ${choice.name}`);
        const ingredient = options.find(row => row.id === choice.id);
        if (ingredient) add(ingredient.inventory_id, ingredient.quantity * item.quantity);
      }
    }
    if (selected.size) return error('Opção inválida.');
    for (const recipe of recipes.filter(row => row.product_id === item.id)) {
      add(recipe.inventory_id, recipe.quantity * item.quantity * (item.variant ? 2 : 1));
    }
    const extra = item.extra && extras.find(row => row.product_id === item.id);
    if (extra) add(extra.extra_inventory_id, item.quantity);
    total += unit * item.quantity;
    items.push({ id: item.id, name: product.name, quantity: item.quantity, unit, customization: labels.join(' + '), category: product.category || 'Menu' });
  }
  if (input.expectedTotal !== null && input.expectedTotal !== total) return error('Os preços mudaram. Reveja o total.', 409);
  try {
    const id = await commitCheckout(db, { ...input, id: crypto.randomUUID(), businessId, requestHash, payloadHash,
      total, items, ingredients: requirements, catalogRevision: menu.catalogRevision,
      eventId: event.id, location: event.address || menu.config?.address || '', createdAt });
    return accepted(id, body.requestKey);
  } catch (err) {
    if (!/constraint failed|chave já utilizada/i.test(err.message)) throw err;
    return error('O pedido já não pode ser confirmado. Atualize o menu e reveja o horário e a disponibilidade.', 409);
  }
}
