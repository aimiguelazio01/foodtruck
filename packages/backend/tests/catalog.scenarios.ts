import assert from 'node:assert/strict';
import {HttpError,newId,type Db} from '../db/port.js';
import {createProduct,updateProduct} from '../services/products.js';
import {listEvents,saveEvent} from '../services/events.js';
import type {Scenario} from './inventory.scenarios.js';

const hour=3600_000,day=24*hour;
async function business(db:Db){
 const id='c'+newId().slice(0,8);
 await db.batch([{sql:'INSERT INTO businesses(id,slug,name,color) VALUES(?,?,?,?)',params:[id,id,'Truck '+id,'#112233']}]);
 return id;
}
const status=async(promise:Promise<unknown>)=>promise.then(()=>200,(error:unknown)=>error instanceof HttpError?error.statusCode:(()=>{throw error;})());
const count=async(db:Db,sql:string,params:any[])=>Number((await db.first<any>(sql,params))!.n);
const archive=async(db:Db,businessId:string)=>db.batch([
 {sql:'INSERT INTO organizations(id,name) VALUES(?,?)',params:['o'+businessId,'Org']},
 {sql:'INSERT INTO organization_trucks(organization_id,business_id,archived) VALUES(?,?,true)',params:['o'+businessId,businessId]},
]);
const product=(db:Db,businessId:string,body:any)=>createProduct(db,{businessId,body,userId:'owner'});
const event=(db:Db,businessId:string,body:any,eventId?:string,authorizeTarget:(id:string)=>Promise<void>=async()=>{})=>
 saveEvent(db,{method:eventId?'PATCH':'POST',businessId,eventId,body,userId:'owner',authorizeTarget});
const base=()=>{const start=(Math.floor(Date.now()/day)+10)*day;return {title:'Mercado',address:'Praça 1',starts_at:start+9*hour,ends_at:start+13*hour};};

export const catalogScenarios:Scenario[]=[
 {name:'products: create with details, update, and details-only upsert',run:async db=>{
  const b=await business(db);
  const {id}=await product(db,b,{name:'Hambúrguer',price_cents:850,available:1,description:'Carne',category:'Pratos',tags:'carne'});
  const row=await db.first<any>('SELECT p.name,p.price_cents,p.available,d.description,d.category,d.tags FROM products p JOIN product_details d ON d.product_id=p.id WHERE p.id=?',[id]);
  assert.deepEqual({...row},{name:'Hambúrguer',price_cents:850,available:1,description:'Carne',category:'Pratos',tags:'carne'});
  await updateProduct(db,{businessId:b,productId:id,body:{price_cents:900,description:'Carne e queijo'},userId:'owner'});
  const after=await db.first<any>('SELECT p.price_cents,d.description FROM products p JOIN product_details d ON d.product_id=p.id WHERE p.id=?',[id]);
  assert.deepEqual({...after},{price_cents:900,description:'Carne e queijo'});
  assert.equal(await count(db,"SELECT count(*) AS n FROM audit_events WHERE business_id=? AND action LIKE 'products:%'",[b]),2);
  assert.equal(await count(db,'SELECT count(*) AS n FROM domain_events WHERE business_id=?',[b]),2);
 }},
 {name:'products: invalid input, unknown product, other business and archived trucks write nothing',run:async db=>{
  const b=await business(db),other=await business(db);
  assert.equal(await status(product(db,b,{price_cents:100})),400,'name required');
  assert.equal(await status(product(db,b,{name:'X',price_cents:-1})),400);
  assert.equal(await status(product(db,b,{name:'X',available:2})),400);
  assert.equal(await status(product(db,b,{name:'X',image:'/uploads/not-a-real-file.png'})),400);
  assert.equal(await status(product(db,b,{name:'X',description:'x'.repeat(1001)})),400);
  assert.equal(await count(db,'SELECT count(*) AS n FROM products WHERE business_id=?',[b]),0);
  const {id}=await product(db,b,{name:'Real',price_cents:100});
  assert.equal(await status(updateProduct(db,{businessId:b,productId:id,body:{description:'only details'},userId:'owner'})),400,'at least one product field');
  assert.equal(await status(updateProduct(db,{businessId:b,productId:'missing',body:{name:'Y'},userId:'owner'})),404);
  assert.equal(await status(updateProduct(db,{businessId:other,productId:id,body:{name:'Y'},userId:'owner'})),404,'tenant isolation');
  await archive(db,b);
  assert.equal(await status(product(db,b,{name:'Novo'})),409);
  assert.equal(await status(updateProduct(db,{businessId:b,productId:id,body:{name:'Y'},userId:'owner'})),409);
 }},
 {name:'events: create, list, overlap and validation rules',run:async db=>{
  const b=await business(db),e=base();
  const first=await event(db,b,e);
  assert.equal(first.business_id,b);
  assert.equal((await listEvents(db,b)).length,1);
  assert.equal(await status(event(db,b,{...e,title:'Outro',starts_at:e.starts_at+hour,ends_at:e.ends_at+hour})),409,'overlap');
  assert.equal(await status(event(db,b,{...e,title:'Depois',starts_at:e.ends_at,ends_at:e.ends_at+hour})),200,'touching events are allowed');
  assert.equal(await status(event(db,b,{...e,title:'',starts_at:e.ends_at+day,ends_at:e.ends_at+day+hour})),400);
  assert.equal(await status(event(db,b,{...e,starts_at:e.ends_at+day,ends_at:e.ends_at+day-1})),400,'end after start');
  assert.equal(await status(event(db,b,{...e,starts_at:e.ends_at+day,ends_at:e.ends_at+day+hour,is_public:2})),400);
  assert.equal(await status(event(db,b,{...e,starts_at:e.ends_at+day,ends_at:e.ends_at+day+hour,latitude:40})),400,'latitude needs longitude');
  assert.equal(await status(event(db,b,{...e,starts_at:e.ends_at+day,ends_at:e.ends_at+day+hour,latitude:95,longitude:0})),400);
  assert.equal(await status(event(db,b,{...e,address:'',starts_at:e.ends_at+day,ends_at:e.ends_at+day+hour})),400,'address or coordinates');
  assert.equal(await status(event(db,b,{...e,address:'',latitude:38.7,longitude:-9.1,starts_at:e.ends_at+day,ends_at:e.ends_at+day+hour})),200);
  assert.equal(await count(db,'SELECT count(*) AS n FROM events WHERE business_id=?',[b]),3);
 }},
 {name:'events: simultaneous overlapping creates produce one event',run:async db=>{
  const b=await business(db),e=base();
  const results=await Promise.all([1,2,3,4].map(()=>status(event(db,b,e))));
  assert.equal(results.filter(code=>code===200).length,1,JSON.stringify(results));
  assert.ok(results.every(code=>code===200||code===409),JSON.stringify(results));
  assert.equal(await count(db,'SELECT count(*) AS n FROM events WHERE business_id=?',[b]),1);
 }},
 {name:'events: edits need the current version and cannot overlap siblings',run:async db=>{
  const b=await business(db),e=base();
  const {id}=await event(db,b,e);
  const sibling=await event(db,b,{...e,title:'Seguinte',starts_at:e.ends_at+hour,ends_at:e.ends_at+2*hour});
  const current=(await db.first<any>('SELECT version FROM events WHERE id=?',[id]))!;
  assert.equal(await status(event(db,b,{title:'Renomeado',version:current.version+5},id)),409);
  assert.equal(await status(event(db,b,{title:'Renomeado',version:current.version},id)),200);
  assert.equal((await db.first<any>('SELECT title FROM events WHERE id=?',[id]))!.title,'Renomeado');
  assert.equal(await status(event(db,b,{ends_at:e.ends_at+3*hour},id)),409,'now overlaps the sibling');
  assert.equal(await status(event(db,b,{title:'x'},'missing')),404);
  const stale=(await db.first<any>('SELECT version FROM events WHERE id=?',[sibling.id]))!.version;
  const results=await Promise.all([1,2,3].map(n=>status(event(db,b,{title:'Corrida '+n,version:stale},sibling.id))));
  assert.equal(results.filter(code=>code===200).length,1,JSON.stringify(results));
 }},
 {name:'events: orders in progress block schedule changes; moving needs authorization and no orders',run:async db=>{
  const b=await business(db),target=await business(db),e=base();
  const {id}=await event(db,b,e);
  await db.batch([{sql:`INSERT INTO orders(id,business_id,request_hash,customer_name,contact,total_cents,status,payment,created_at,pickup_at,event_id)
   VALUES(?,?,?,?,?,?,?,?,?,?,?)`,params:['ord'+id,b,newId().replace(/-/g,'')+newId().replace(/-/g,''),'Ana','910000000',500,'pending','unpaid',Date.now(),e.starts_at+hour,id]}]);
  assert.equal(await status(event(db,b,{starts_at:e.starts_at+hour},id)),409,'schedule locked by a pending order');
  assert.equal(await status(event(db,b,{title:'Só o título'},id)),200,'title does not affect orders');
  let asked='';
  assert.equal(await status(event(db,b,{business_id:target},id,async t=>{asked=t;throw new HttpError('Não tem permissão para esta operação.',403);})),403);
  assert.equal(asked,target);
  assert.equal(await status(event(db,b,{business_id:target},id)),409,'event with orders cannot move');
  await db.batch([{sql:"UPDATE orders SET status='collected' WHERE event_id=?",params:[id]}]);
  assert.equal(await status(event(db,b,{starts_at:e.starts_at+hour},id)),200,'finished orders no longer block');
  const free=await event(db,b,{...e,title:'Livre',starts_at:e.ends_at+day,ends_at:e.ends_at+day+hour});
  await db.batch([{sql:"UPDATE orders SET event_id=NULL WHERE event_id=?",params:[id]}]);
  assert.equal(await status(event(db,b,{business_id:target},free.id)),200);
  assert.equal((await db.first<any>('SELECT business_id FROM events WHERE id=?',[free.id]))!.business_id,target);
  assert.equal(await count(db,"SELECT count(*) AS n FROM audit_events WHERE action=?",['events:update:'+free.id]),2,'both trucks audited');
 }},
 {name:'events: archived trucks cannot change events',run:async db=>{
  const b=await business(db);
  await archive(db,b);
  assert.equal(await status(event(db,b,base())),409);
 }},
];
