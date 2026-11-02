import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';import Fastify from 'fastify';
const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='test_claims_'+randomBytes(6).toString('hex');await admin.query('CREATE SCHEMA "'+schema+'"');
const url=new URL(process.env.DATABASE_URL!);url.searchParams.set('options','-c search_path='+schema);process.env.DATABASE_URL=url.href;
const {pool}=await import('../src/db.js');const {digest}=await import('../src/auth.js');const {customerRoutes}=await import('../src/customer.js');
const app=Fastify();await customerRoutes(app);
const session1=randomBytes(32).toString('hex'),session2=randomBytes(32).toString('hex'),proof=randomBytes(32).toString('hex'),id=randomUUID(),pickup=Date.now()+86400000;
const request=(path:string,body?:any,cookie?:string)=>app.inject({method:body?'POST':'GET',url:'/api/v1/customer/'+path,payload:body,headers:cookie?{cookie}:{}});
const cookie1='customer_session='+session1,cookie2='customer_session='+session2;
try{
 for(const file of (await readdir(new URL('../migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort())await pool.query(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
 await pool.query("INSERT INTO businesses VALUES('b','b','Carrinha Teste','#112233');INSERT INTO customers VALUES('c1','c1@test.test','unused',1,1),('c2','c2@test.test','unused',1,1)");
 await pool.query('INSERT INTO customer_sessions VALUES($1,$2,$3),($4,$5,$3)',[digest(session1),'c1',Date.now()+3600000,digest(session2),'c2']);
 await pool.query("INSERT INTO orders(id,business_id,request_hash,customer_name,contact,total_cents,created_at,pickup_at,location_snapshot) VALUES($1,'b',$2,'Cliente','12345',550,$3,$4,'Praça Teste')",[id,digest(proof),Date.now(),pickup]);
 await pool.query("INSERT INTO order_items(order_id,product_id,name,quantity,unit_cents) VALUES($1,'p','Hotdog',1,550)",[id]);
 assert.equal((await request('claim-order',{id,token:proof})).statusCode,401);
 assert.equal((await request('claim-order',{id},cookie1)).statusCode,404,'id alone cannot claim a guest order');
 assert.equal((await request('claim-order',{id,token:'0'.repeat(64)},cookie1)).statusCode,404);
 assert.equal((await request('claim-order',{id,token:'bad'},cookie1)).statusCode,400);
 assert.equal((await request('history',undefined,cookie1)).json().orders.length,0);
 let response=await request('claim-order',{id},cookie1+'; ft_track_'+id+'='+proof);assert.equal(response.statusCode,200,response.body);
 response=await request('history',undefined,cookie1);const order=response.json().orders[0];assert.equal(order.id,id);assert.equal(order.status,'pending');assert.equal(order.pickup_at,pickup);assert.equal(order.business_name,'Carrinha Teste');assert.equal(order.location_snapshot,'Praça Teste');assert.equal(order.items[0].name,'Hotdog');
 assert.equal((await request('claim-order',{id},cookie1)).statusCode,200,'association is idempotent without proof for owner');
 assert.equal((await request('claim-order',{id,token:proof},cookie2)).statusCode,404,'another account cannot take ownership');
 assert.equal((await request('history',undefined,cookie2)).json().orders.length,0);
 await pool.query("UPDATE orders SET status='ready' WHERE id=$1",[id]);assert.equal((await request('history',undefined,cookie1)).json().orders[0].status,'ready');
 assert.equal((await pool.query('SELECT customer_id FROM orders WHERE id=$1',[id])).rows[0].customer_id,'c1');
 console.log('PASS: login required; tracking-cookie claim; wrong/missing proof rejected; safe idempotent claim; no reassignment to other customers; private history with collection number, current status, truck, location and pickup.');
}finally{await app.close();await pool.end();await admin.query('DROP SCHEMA "'+schema+'" CASCADE');await admin.end();}

