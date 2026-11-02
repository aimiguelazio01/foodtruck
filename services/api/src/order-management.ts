import type {FastifyInstance} from 'fastify';
import type {PoolClient} from 'pg';
import {pool} from './db.js';
import {requireMember} from './auth.js';
import {ordersWorkbook} from './orders-workbook.js';

async function readOrders(c:PoolClient,businessId:string,hideContact:boolean){
 const orders=(await c.query(`SELECT o.id,o.business_id,o.customer_name,o.contact,o.total_cents,o.status,o.payment,o.created_at,o.pickup_at,o.event_id,o.location_snapshot,o.version,
 (o.customer_id IS NOT NULL) AS has_customer_account,b.name AS business_name,
 e.title AS event_title,e.venue_name AS event_venue,e.address AS event_address,e.starts_at AS event_starts_at,e.ends_at AS event_ends_at,e.latitude AS event_latitude,e.longitude AS event_longitude,e.is_public AS event_is_public
 FROM orders o JOIN businesses b ON b.id=o.business_id LEFT JOIN events e ON e.id=o.event_id AND e.business_id=o.business_id
 WHERE o.business_id=$1 ORDER BY COALESCE(o.pickup_at,o.created_at) DESC,o.created_at DESC,o.id`,[businessId])).rows;
 const items=(await c.query('SELECT i.* FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.business_id=$1 ORDER BY i.order_id,i.name,i.product_id',[businessId])).rows;
 const grouped=new Map<string,any[]>();
 for(const item of items){const rows=grouped.get(item.order_id)||[];rows.push(item);grouped.set(item.order_id,rows);}
 for(const order of orders){order.items=grouped.get(order.id)||[];if(hideContact)delete order.contact;}
 return orders;
}
export async function orderManagementRoutes(app:FastifyInstance){
 app.get('/api/v1/manage/businesses/:id/orders',async req=>{
  const {id}=req.params as any,access=await requireMember(req,id),c=await pool.connect();
  try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const orders=await readOrders(c,id,access.role==='staff');await c.query('COMMIT');return {orders};}
  catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 });
 app.get('/api/v1/manage/businesses/:id/orders/export.xlsx',async(req,reply)=>{
  const {id}=req.params as any,access=await requireMember(req,id),c=await pool.connect();
  let orders:any[],history:any[],business:any;
  try{
   await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   business=(await c.query('SELECT name,slug FROM businesses WHERE id=$1',[id])).rows[0];
   if(!business)throw Object.assign(new Error('Carrinha não encontrada.'),{statusCode:404});
   orders=await readOrders(c,id,access.role==='staff');
   history=(await c.query(`SELECT a.id,a.action,a.created_at,a.user_id
    FROM audit_events a WHERE a.business_id=$1 AND EXISTS(SELECT 1 FROM orders o WHERE o.business_id=$1 AND (a.action LIKE 'order:'||o.id||':%' OR a.action LIKE 'payment:'||o.id||':%')) ORDER BY a.created_at,a.id`,[id])).rows;
   await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  const buffer=await ordersWorkbook(business.name,orders,history);
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Lisbon',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const filename='encomendas-'+business.slug.replace(/[^a-z0-9-]/gi,'-')+'-'+day+'.xlsx';
  return reply.header('Cache-Control','private, no-store').header('Content-Disposition','attachment; filename="'+filename+'"').type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(buffer);
 });
}
