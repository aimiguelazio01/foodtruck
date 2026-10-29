import {randomUUID,createHash} from 'node:crypto';
import {operationsSchema,reserveStock,applyStockTransition,pickupSlots,settings,expireOrders,audit} from './operations.mjs';
import {canTransition} from './order-state.mjs';
import {membership} from './auth.mjs';
import {validateModifiers} from './modifiers.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
export function orderSchema(db){db.exec(`
CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,business_id TEXT NOT NULL REFERENCES businesses(id),request_hash TEXT NOT NULL UNIQUE,customer_name TEXT NOT NULL,contact TEXT NOT NULL,total_cents INTEGER NOT NULL CHECK(total_cents>=0),status TEXT NOT NULL DEFAULT 'pending',payment TEXT NOT NULL DEFAULT 'unpaid',created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS order_items(order_id TEXT NOT NULL REFERENCES orders(id),product_id TEXT NOT NULL,name TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 20),unit_cents INTEGER NOT NULL CHECK(unit_cents>=0),PRIMARY KEY(order_id,product_id));
CREATE INDEX IF NOT EXISTS orders_business_date ON orders(business_id,created_at);
`);operationsSchema(db);}
export function placeOrder(db,{businessId,requestKey,name,contact,items,pickupAt,paymentMethod='collection',expectedTotal}){
 if(typeof requestKey!=='string'||!/^[a-f0-9]{64}$/.test(requestKey))throw new Error('Chave de encomenda inválida.');
 if(typeof name!=='string'||!name.trim()||name.length>100||typeof contact!=='string'||contact.length<5||contact.length>254)throw new Error('Preencha o nome e contacto.');
 if(!['collection','demo'].includes(paymentMethod))throw new Error('Método de pagamento inválido.');
 if(!Array.isArray(items)||items.length<1||items.length>30)throw new Error('Carrinho inválido.');
 db.exec('BEGIN IMMEDIATE');try{
 const existing=db.prepare('SELECT id,business_id FROM orders WHERE request_hash=?').get(hash(requestKey));
 if(existing){if(existing.business_id!==businessId)throw new Error('Chave já utilizada.');db.exec('COMMIT');return existing.id;}
 const pending=db.prepare("SELECT count(*) AS n FROM orders WHERE business_id=? AND contact=? AND status='pending'").get(businessId,contact.trim());if(pending.n>=5)throw new Error('Já existem pedidos pendentes para este contacto. Aguarde a confirmação.');
 const config=settings(db,businessId);
 if(config&&(!Number.isInteger(pickupAt)||!pickupSlots(db,businessId).includes(pickupAt)))throw new Error('Escolha um horário de recolha disponível.');
 const event=pickupAt?db.prepare('SELECT * FROM events WHERE business_id=? AND is_public=1 AND starts_at<=? AND ends_at>? ORDER BY starts_at LIMIT 1').get(businessId,pickupAt,pickupAt):null;
 const eventMenu=event?db.prepare('SELECT product_id FROM event_products WHERE event_id=?').all(event.id):[];if(eventMenu.length&&items.some(item=>!eventMenu.some(p=>p.product_id===item.id)))throw new Error('Um produto não está disponível na paragem escolhida.');
 const seen=new Set();let total=0;const snapshot=items.map(item=>{if(!item||typeof item.id!=='string'||seen.has(item.id)||!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>20)throw new Error('Quantidade inválida.');seen.add(item.id);const product=db.prepare('SELECT * FROM products WHERE id=? AND business_id=? AND available=1').get(item.id,businessId);if(!product)throw new Error('Produto indisponível.');const detail=db.prepare('SELECT * FROM product_details WHERE product_id=?').get(item.id);const extra=item.extra===true;if(extra&&!detail?.extra_name)throw new Error('Extra inválido.');const variant=item.variant===true;if(variant&&!detail?.variant_name)throw new Error('Variação inválida.');const modifiers=validateModifiers(db,item.id,businessId,item.optionIds||[]);const unit=modifiers.cents+(detail?.promotion_cents??product.price_cents)+(extra?detail.extra_cents:0)+(variant?detail.variant_cents:0);total+=unit*item.quantity;return {...product,price_cents:unit,customization:[variant?detail.variant_name:'',extra?detail.extra_name:'',...modifiers.labels].filter(Boolean).join(' + '),optionIngredients:modifiers.ingredients,hasExtra:extra,stockFactor:variant?2:1,quantity:item.quantity};});
 if(expectedTotal!==undefined&&expectedTotal!==total)throw new Error('Os preços mudaram. Reveja o total atualizado antes de confirmar.');
 const id=randomUUID();db.prepare('INSERT INTO orders(id,business_id,request_hash,customer_name,contact,total_cents,created_at) VALUES(?,?,?,?,?,?,?)').run(id,businessId,hash(requestKey),name.trim(),contact.trim(),total,Date.now());
 db.prepare('UPDATE orders SET pickup_at=?,payment=?,event_id=?,location_snapshot=? WHERE id=?').run(pickupAt||null,paymentMethod==='demo'?'demo_paid':'unpaid',event?.id||null,event?.address||config?.address||'',id);
 const insert=db.prepare('INSERT INTO order_items(order_id,product_id,name,quantity,unit_cents,customization,category) VALUES(?,?,?,?,?,?,?)');for(const p of snapshot){const category=db.prepare('SELECT category FROM product_details WHERE product_id=?').get(p.id)?.category||'Menu';insert.run(id,p.id,p.name,p.quantity,p.price_cents,p.customization,category);}
 reserveStock(db,id,snapshot);
 db.exec('COMMIT');return id;
 }catch(e){db.exec('ROLLBACK');throw e;}
}
export function trackOrder(db,id,token){if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return null;const order=db.prepare('SELECT id,status,payment,total_cents,created_at,pickup_at FROM orders WHERE id=? AND request_hash=?').get(id,hash(token));if(!order)return null;return {...order,items:db.prepare('SELECT name,quantity,unit_cents,customization FROM order_items WHERE order_id=?').all(id)};}
export function changeOrder(db,userId,id,status){db.exec('BEGIN IMMEDIATE');try{const order=db.prepare('SELECT * FROM orders WHERE id=?').get(id);if(!order||!membership(db,userId,order.business_id))throw new Error('Sem acesso.');if(order.status===status){db.exec('COMMIT');return;}if(!canTransition(order.status,status))throw new Error('Transição inválida.');if(status==='collected'&&!['paid_collection','demo_paid'].includes(order.payment))throw new Error('Registe o pagamento na recolha.');applyStockTransition(db,id,status);db.prepare('UPDATE orders SET status=? WHERE id=?').run(status,id);audit(db,order.business_id,userId,`order:${id}:${status}`);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
export function collectPayment(db,userId,id){db.exec('BEGIN IMMEDIATE');try{const order=db.prepare('SELECT * FROM orders WHERE id=?').get(id);if(!order||!membership(db,userId,order.business_id))throw new Error('Sem acesso.');if(order.status!=='ready')throw new Error('A encomenda deve estar pronta.');if(order.payment!=='paid_collection'){db.prepare("UPDATE orders SET payment='paid_collection' WHERE id=?").run(id);audit(db,order.business_id,userId,`payment:${id}:collection`);}db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
