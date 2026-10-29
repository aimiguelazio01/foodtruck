import { randomUUID } from 'node:crypto';
import { membership } from './auth.mjs';

export function operationsSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS business_settings(business_id TEXT PRIMARY KEY REFERENCES businesses(id),description TEXT NOT NULL DEFAULT '',contact TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '',latitude REAL NOT NULL DEFAULT 38.7223,longitude REAL NOT NULL DEFAULT -9.1393,is_open INTEGER NOT NULL DEFAULT 1,slot_capacity INTEGER NOT NULL DEFAULT 5 CHECK(slot_capacity BETWEEN 1 AND 100),retention_days INTEGER NOT NULL DEFAULT 90);
    CREATE TABLE IF NOT EXISTS inventory(id TEXT PRIMARY KEY,business_id TEXT NOT NULL REFERENCES businesses(id),name TEXT NOT NULL,unit TEXT NOT NULL DEFAULT 'un',quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity>=0),reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved>=0 AND reserved<=quantity),minimum INTEGER NOT NULL DEFAULT 5 CHECK(minimum>=0),supplier TEXT NOT NULL DEFAULT '',UNIQUE(business_id,name));
    CREATE TABLE IF NOT EXISTS recipes(product_id TEXT NOT NULL REFERENCES products(id),inventory_id TEXT NOT NULL REFERENCES inventory(id),quantity INTEGER NOT NULL CHECK(quantity>0),PRIMARY KEY(product_id,inventory_id));
    CREATE TABLE IF NOT EXISTS stock_movements(id TEXT PRIMARY KEY,inventory_id TEXT NOT NULL REFERENCES inventory(id),delta INTEGER NOT NULL,reason TEXT NOT NULL,order_id TEXT,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS reservations(order_id TEXT NOT NULL REFERENCES orders(id),inventory_id TEXT NOT NULL REFERENCES inventory(id),quantity INTEGER NOT NULL CHECK(quantity>0),state TEXT NOT NULL DEFAULT 'reserved',PRIMARY KEY(order_id,inventory_id));
    CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,business_id TEXT NOT NULL REFERENCES businesses(id),title TEXT NOT NULL,address TEXT NOT NULL,starts_at INTEGER NOT NULL,ends_at INTEGER NOT NULL CHECK(ends_at>starts_at),is_public INTEGER NOT NULL DEFAULT 1 CHECK(is_public IN (0,1)),type TEXT NOT NULL DEFAULT 'market');
    CREATE TABLE IF NOT EXISTS product_details(product_id TEXT PRIMARY KEY REFERENCES products(id),category TEXT NOT NULL DEFAULT 'Menu',description TEXT NOT NULL DEFAULT '',allergens TEXT NOT NULL DEFAULT '',image TEXT NOT NULL DEFAULT '',extra_name TEXT NOT NULL DEFAULT '',extra_cents INTEGER NOT NULL DEFAULT 0 CHECK(extra_cents>=0),prep_minutes INTEGER NOT NULL DEFAULT 15 CHECK(prep_minutes BETWEEN 1 AND 180));
    CREATE TABLE IF NOT EXISTS audit_events(id TEXT PRIMARY KEY,business_id TEXT NOT NULL REFERENCES businesses(id),user_id TEXT,action TEXT NOT NULL,created_at INTEGER NOT NULL);
  `);
  const cols=db.prepare('PRAGMA table_info(orders)').all();
  if(!cols.some(c=>c.name==='pickup_at')) db.exec('ALTER TABLE orders ADD COLUMN pickup_at INTEGER');
  for(const [name,type] of [['event_id','TEXT'],['location_snapshot',"TEXT NOT NULL DEFAULT ''"]])if(!cols.some(c=>c.name===name))db.exec(`ALTER TABLE orders ADD COLUMN ${name} ${type}`);
  const itemCols=db.prepare('PRAGMA table_info(order_items)').all();
  if(!itemCols.some(c=>c.name==='customization')) db.exec("ALTER TABLE order_items ADD COLUMN customization TEXT NOT NULL DEFAULT ''");
  if(!itemCols.some(c=>c.name==='category'))db.exec("ALTER TABLE order_items ADD COLUMN category TEXT NOT NULL DEFAULT 'Menu'");
  if(!db.prepare('PRAGMA table_info(product_details)').all().some(c=>c.name==='extra_inventory_id'))db.exec('ALTER TABLE product_details ADD COLUMN extra_inventory_id TEXT REFERENCES inventory(id)');
  const detailCols=db.prepare('PRAGMA table_info(product_details)').all();for(const [name,type] of [['variant_name',"TEXT NOT NULL DEFAULT ''"],['variant_cents','INTEGER NOT NULL DEFAULT 0'],['promotion_cents','INTEGER'],['ingredients',"TEXT NOT NULL DEFAULT ''"],['tags',"TEXT NOT NULL DEFAULT ''"]])if(!detailCols.some(c=>c.name===name))db.exec(`ALTER TABLE product_details ADD COLUMN ${name} ${type}`);
  const settingCols=db.prepare('PRAGMA table_info(business_settings)').all();
  for(const [name,sql] of [['logo',"TEXT NOT NULL DEFAULT ''"],['secondary_color',"TEXT NOT NULL DEFAULT '#283820'"],['appearance',"TEXT NOT NULL DEFAULT 'light'"],['location_updated_at','INTEGER'],['location_source',"TEXT NOT NULL DEFAULT 'manual'"],['gps_updated_at','INTEGER']])if(!settingCols.some(c=>c.name===name))db.exec(`ALTER TABLE business_settings ADD COLUMN ${name} ${sql}`);
  for(const [name,type] of [['accent_color',"TEXT NOT NULL DEFAULT '#f0a76d'"],['social_links',"TEXT NOT NULL DEFAULT ''"],['cover',"TEXT NOT NULL DEFAULT ''"]])if(!settingCols.some(c=>c.name===name))db.exec(`ALTER TABLE business_settings ADD COLUMN ${name} ${type}`);
  db.exec(`CREATE TABLE IF NOT EXISTS saved_locations(id TEXT PRIMARY KEY,business_id TEXT NOT NULL REFERENCES businesses(id),name TEXT NOT NULL,address TEXT NOT NULL,latitude REAL NOT NULL,longitude REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,business_id TEXT NOT NULL REFERENCES businesses(id),title TEXT NOT NULL,done INTEGER NOT NULL DEFAULT 0,assigned_to TEXT REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS password_resets(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS request_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL);`);
  db.exec(`CREATE TABLE IF NOT EXISTS categories(business_id TEXT NOT NULL REFERENCES businesses(id),name TEXT NOT NULL,display_order INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(business_id,name));
    CREATE TABLE IF NOT EXISTS customer_notes(business_id TEXT NOT NULL REFERENCES businesses(id),contact TEXT NOT NULL,note TEXT NOT NULL,PRIMARY KEY(business_id,contact));
    CREATE TABLE IF NOT EXISTS event_products(event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,product_id TEXT NOT NULL REFERENCES products(id),PRIMARY KEY(event_id,product_id));
    CREATE TABLE IF NOT EXISTS modifier_groups(id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id),name TEXT NOT NULL,min_count INTEGER NOT NULL DEFAULT 0,max_count INTEGER NOT NULL DEFAULT 1 CHECK(max_count>=min_count AND max_count<=10));
    CREATE TABLE IF NOT EXISTS modifier_options(id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,name TEXT NOT NULL,price_cents INTEGER NOT NULL DEFAULT 0 CHECK(price_cents>=0),inventory_id TEXT REFERENCES inventory(id),quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity>0));
    INSERT OR IGNORE INTO categories(business_id,name) SELECT p.business_id,d.category FROM products p JOIN product_details d ON d.product_id=p.id;`);
}

export function authorize(db,userId,businessId,roles=['owner','manager']) {
  const member=membership(db,userId,businessId);
  if(!member||!roles.includes(member.role))throw new Error('Sem permissão para esta operação.');
  return member;
}
export function audit(db,businessId,userId,action){db.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?)').run(randomUUID(),businessId,userId,action,Date.now());}
export function settings(db,businessId){return db.prepare('SELECT * FROM business_settings WHERE business_id=?').get(businessId);}
export function adjustStock(db,userId,businessId,id,delta,reason) {
  authorize(db,userId,businessId);if(!Number.isInteger(delta)||delta===0||Math.abs(delta)>1000000||!['restock','adjustment','waste'].includes(reason))throw new Error('Movimento inválido.');
  if(reason==='restock'&&delta<0||reason==='waste'&&delta>0)throw new Error('Quantidade inválida.');
  db.exec('BEGIN IMMEDIATE');try{const item=db.prepare('SELECT * FROM inventory WHERE id=? AND business_id=?').get(id,businessId);if(!item||item.quantity+delta<item.reserved)throw new Error('Stock insuficiente ou reservado.');db.prepare('UPDATE inventory SET quantity=quantity+? WHERE id=?').run(delta,id);db.prepare('INSERT INTO stock_movements VALUES(?,?,?,?,?,?)').run(randomUUID(),id,delta,reason,null,Date.now());audit(db,businessId,userId,`stock:${reason}:${id}:${delta}`);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
}
export function reserveStock(db,orderId,items) {
  const needs=new Map();
  for(const item of items){for(const option of item.optionIngredients||[])needs.set(option.id,(needs.get(option.id)||0)+option.quantity*item.quantity);for(const r of db.prepare('SELECT r.*,i.business_id FROM recipes r JOIN inventory i ON i.id=r.inventory_id WHERE r.product_id=?').all(item.id)){if(r.business_id!==item.business_id)throw new Error('Receita inválida.');needs.set(r.inventory_id,(needs.get(r.inventory_id)||0)+r.quantity*item.quantity*(item.stockFactor||1));}if(item.hasExtra){const extra=db.prepare('SELECT i.id,i.business_id FROM product_details d JOIN inventory i ON i.id=d.extra_inventory_id WHERE d.product_id=?').get(item.id);if(extra){if(extra.business_id!==item.business_id)throw new Error('Extra inválido.');needs.set(extra.id,(needs.get(extra.id)||0)+item.quantity);}}}
  for(const [id,qty] of needs){const result=db.prepare('UPDATE inventory SET reserved=reserved+? WHERE id=? AND quantity-reserved>=?').run(qty,id,qty);if(!result.changes)throw new Error('Ingredientes sem stock suficiente.');db.prepare('INSERT INTO reservations(order_id,inventory_id,quantity) VALUES(?,?,?)').run(orderId,id,qty);}
}
export function applyStockTransition(db,orderId,status) {
  if(!['preparing','cancelled'].includes(status))return;
  for(const r of db.prepare("SELECT * FROM reservations WHERE order_id=? AND state='reserved'").all(orderId)){
    if(status==='preparing'){db.prepare('UPDATE inventory SET quantity=quantity-?,reserved=reserved-? WHERE id=?').run(r.quantity,r.quantity,r.inventory_id);db.prepare('INSERT INTO stock_movements VALUES(?,?,?,?,?,?)').run(randomUUID(),r.inventory_id,-r.quantity,'preparation',orderId,Date.now());}
    else db.prepare('UPDATE inventory SET reserved=reserved-? WHERE id=?').run(r.quantity,r.inventory_id);
    db.prepare('UPDATE reservations SET state=? WHERE order_id=? AND inventory_id=?').run(status==='preparing'?'consumed':'released',orderId,r.inventory_id);
  }
  if(status==='cancelled')db.prepare("UPDATE stock_movements SET reason='waste_cancelled' WHERE order_id=? AND reason='preparation'").run(orderId);
}
export function pickupSlots(db,businessId,now=Date.now()){
  const config=settings(db,businessId);if(!config?.is_open)return [];
  const sessions=db.prepare('SELECT starts_at,ends_at FROM events WHERE business_id=? AND is_public=1 AND ends_at>? AND starts_at<? ORDER BY starts_at').all(businessId,now,now+7*86400000);
  const prep=db.prepare('SELECT MAX(d.prep_minutes) AS n FROM product_details d JOIN products p ON p.id=d.product_id WHERE p.business_id=? AND p.available=1').get(businessId).n||15;
  const result=[];
  for(const event of sessions){for(let slot=Math.ceil(Math.max(event.starts_at,now+prep*60000)/900000)*900000;slot<event.ends_at;slot+=900000){if(result.includes(slot))continue;const count=db.prepare("SELECT count(*) AS n FROM orders WHERE business_id=? AND pickup_at=? AND status!='cancelled'").get(businessId,slot).n;if(count<config.slot_capacity)result.push(slot);if(result.length>=96)return result;}}
  return result;
}
export function expireOrders(db,now=Date.now()){
  db.exec('BEGIN IMMEDIATE');try{for(const o of db.prepare("SELECT id FROM orders WHERE status='pending' AND created_at<?").all(now-15*60000)){applyStockTransition(db,o.id,'cancelled');db.prepare("UPDATE orders SET status='cancelled' WHERE id=?").run(o.id);}db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
}
export function analytics(db,businessId,since=0,until=Date.now(),filters={}){
 const clauses=['o.business_id=?','o.created_at>=?','o.created_at<=?'];const params=[businessId,since,until];
 if(filters.status){clauses.push('o.status=?');params.push(filters.status);}
 if(filters.location){clauses.push('o.location_snapshot=?');params.push(filters.location==='__none__'?'':filters.location);}
 if(filters.event){clauses.push('o.event_id=?');params.push(filters.event);}
 if(filters.category){clauses.push('EXISTS(SELECT 1 FROM order_items item WHERE item.order_id=o.id AND item.category=?)');params.push(filters.category);}
 const scope='WITH filtered AS (SELECT o.* FROM orders o WHERE '+clauses.join(' AND ')+') ';
 const query=sql=>db.prepare(scope+sql);
 const totals=query("SELECT count(*) orders,COALESCE(sum(total_cents),0) placed_cents,COALESCE(sum(CASE WHEN status='collected' THEN total_cents ELSE 0 END),0) sales_cents,COALESCE(sum(CASE WHEN payment='paid_collection' THEN total_cents ELSE 0 END),0) paid_cents,COALESCE(sum(CASE WHEN payment='demo_paid' THEN total_cents ELSE 0 END),0) simulated_cents,COALESCE(sum(CASE WHEN status='cancelled' THEN 1 ELSE 0 END),0) cancelled FROM filtered").get(...params);
 const daily=query("SELECT date(created_at/1000,'unixepoch') day,sum(total_cents) cents FROM filtered WHERE status='collected' GROUP BY day ORDER BY day").all(...params);
 const products=query("SELECT i.name,sum(i.quantity) quantity,sum(i.unit_cents*i.quantity) cents FROM order_items i JOIN filtered o ON o.id=i.order_id WHERE o.status='collected' GROUP BY i.name ORDER BY quantity DESC LIMIT 10").all(...params);
 const locations=query("SELECT CASE WHEN location_snapshot='' THEN 'Local não registado' ELSE location_snapshot END location,sum(total_cents) cents FROM filtered WHERE status='collected' GROUP BY location_snapshot ORDER BY cents DESC").all(...params);
 const availability=db.prepare('SELECT count(*) products,COALESCE(sum(available),0) available FROM products WHERE business_id=?').get(businessId);
 const statuses=query('SELECT status,count(*) count FROM filtered GROUP BY status').all(...params);
 const hours=query("SELECT strftime('%H',created_at/1000,'unixepoch') hour,count(*) count FROM filtered GROUP BY hour ORDER BY count DESC LIMIT 5").all(...params);
 return {totals,daily,products,locations,availability,statuses,hours};
}
