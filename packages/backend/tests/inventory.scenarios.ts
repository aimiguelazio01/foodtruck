import assert from 'node:assert/strict';
import {HttpError,newId,type Db} from '../db/port.js';
import {changeInventory,listInventory,listMovements} from '../services/inventory.js';

// Runtime-independent scenarios: the same file runs against PostgreSQL and against a real D1 (workerd).
export interface Scenario{name:string;run:(db:Db)=>Promise<void>}

async function business(db:Db){
 const id='b'+newId().slice(0,8);
 await db.batch([{sql:'INSERT INTO businesses(id,slug,name,color) VALUES(?,?,?,?)',params:[id,id,'Truck '+id,'#112233']}]);
 return id;
}
const call=(db:Db,businessId:string,action:any,body:Record<string,unknown>,itemId?:string)=>changeInventory(db,{action,businessId,itemId,body,userId:'owner'});
const status=async(promise:Promise<unknown>)=>promise.then(()=>200,(error:unknown)=>error instanceof HttpError?error.statusCode:(()=>{throw error;})());
const row=async(db:Db,id:string)=>(await db.first<any>('SELECT * FROM inventory WHERE id=?',[id]))!;
const count=async(db:Db,sql:string,params:any[])=>Number((await db.first<any>(sql,params))!.n);

export const inventoryScenarios:Scenario[]=[
 {name:'create stores stock, ledger, audit and a change event',run:async db=>{
  const b=await business(db);
  const {id}=await call(db,b,'create',{name:'Farinha',unit:'g',quantity:100,minimum:20,supplier:'Fornecedor'});
  assert.equal((await row(db,id)).quantity,100);
  assert.equal(await count(db,'SELECT count(*) AS n FROM stock_movements WHERE inventory_id=? AND delta=100',[id]),1);
  assert.equal(await count(db,"SELECT count(*) AS n FROM audit_events WHERE business_id=? AND action=?",[b,'inventory:create:'+id]),1);
  assert.equal(await count(db,'SELECT count(*) AS n FROM domain_events WHERE business_id=?',[b]),1);
  const listed=await listInventory(db,b,false) as any[];
  assert.equal(listed.length,1);assert.equal(Number(listed[0].recipe_count),0);
  assert.equal((await listInventory(db,b,true)).length,0);
 }},
 {name:'duplicate names are rejected case-insensitively and per business',run:async db=>{
  const b=await business(db),other=await business(db);
  await call(db,b,'create',{name:'Queijo',unit:'g',quantity:0});
  assert.equal(await status(call(db,b,'create',{name:' queijo ',unit:'g',quantity:0})),409);
  assert.equal(await status(call(db,other,'create',{name:'Queijo',unit:'g',quantity:0})),200);
  assert.equal(await count(db,'SELECT count(*) AS n FROM inventory WHERE business_id=?',[b]),1);
 }},
 {name:'validation errors write nothing',run:async db=>{
  const b=await business(db);
  assert.equal(await status(call(db,b,'create',{name:'',unit:'g'})),400);
  assert.equal(await status(call(db,b,'create',{name:'X',unit:'g',quantity:-1})),400);
  assert.equal(await count(db,'SELECT count(*) AS n FROM inventory WHERE business_id=?',[b]),0);
  assert.equal(await count(db,'SELECT count(*) AS n FROM domain_events WHERE business_id=?',[b]),0);
 }},
 {name:'edit needs the current version and cannot change stock',run:async db=>{
  const b=await business(db);
  const {id}=await call(db,b,'create',{name:'Sal',unit:'g',quantity:0,minimum:5});
  const current=await row(db,id);
  assert.equal(await status(call(db,b,'edit',{name:'Sal fino',version:current.version+7},id)),409);
  assert.equal(await status(call(db,b,'edit',{name:'Sal fino',version:current.version,quantity:9},id)),400);
  assert.equal(await status(call(db,b,'edit',{name:'Sal fino',version:current.version},id)),200);
  const edited=await row(db,id);
  assert.equal(edited.name,'Sal fino');assert.ok(edited.version>current.version);
  assert.equal(await status(call(db,b,'edit',{name:'Sal',version:current.version},id)),409,'stale version rejected');
 }},
 {name:'stock movements keep reserved quantities and bounds',run:async db=>{
  const b=await business(db);
  const {id}=await call(db,b,'create',{name:'Pão',unit:'un',quantity:10});
  await db.batch([{sql:'UPDATE inventory SET reserved=4 WHERE id=?',params:[id],expectChanges:1}]);
  let v=(await row(db,id)).version;
  assert.equal(await status(call(db,b,'stock',{quantity:7,reason:'waste',version:v},id)),409,'reserved stock cannot be withdrawn');
  assert.equal(await status(call(db,b,'stock',{quantity:6,reason:'waste',version:v},id)),200);
  assert.equal((await row(db,id)).quantity,4);
  v=(await row(db,id)).version;
  assert.equal(await status(call(db,b,'stock',{quantity:0,reason:'restock',version:v},id)),400);
  assert.equal(await status(call(db,b,'stock',{quantity:5,reason:'nope',version:v},id)),400);
  assert.equal(await status(call(db,b,'stock',{quantity:5,reason:'adjustment',version:v},id)),400);
  assert.equal(await status(call(db,b,'stock',{quantity:2147483647,reason:'restock',version:v},id)),409);
  assert.equal(await status(call(db,b,'stock',{quantity:5,reason:'adjustment',direction:'in',version:v},id)),200);
  assert.equal((await row(db,id)).quantity,9);
  const movements=await listMovements(db,b,id) as any[];
  assert.deepEqual(movements.map(m=>Number(m.delta)).sort((x,y)=>x-y),[-6,5,10]);
  assert.equal(await status(listMovements(db,'other-business',id)),404);
 }},
 {name:'unit changes only on unused ingredients',run:async db=>{
  const b=await business(db);
  const {id}=await call(db,b,'create',{name:'Molho',unit:'ml',quantity:50});
  assert.equal(await status(call(db,b,'edit',{unit:'l',version:(await row(db,id)).version},id)),409);
  const emptied=(await call(db,b,'create',{name:'Vazio',unit:'ml',quantity:5})).id;
  await call(db,b,'stock',{quantity:5,reason:'waste',version:(await row(db,emptied)).version},emptied);
  assert.equal((await row(db,emptied)).quantity,0);
  assert.equal(await status(call(db,b,'edit',{unit:'l',version:(await row(db,emptied)).version},emptied)),409,'movement history blocks it too');
  const fresh=(await call(db,b,'create',{name:'Novo',unit:'ml',quantity:0})).id;
  assert.equal(await status(call(db,b,'edit',{unit:'l',version:(await row(db,fresh)).version},fresh)),200,'unused ingredient may change unit');
 }},
 {name:'remove and restore follow stock, reservation and recipe rules',run:async db=>{
  const b=await business(db);
  const {id}=await call(db,b,'create',{name:'Tomate',unit:'un',quantity:3});
  assert.equal(await status(call(db,b,'remove',{version:(await row(db,id)).version},id)),409,'stock must be zero');
  await call(db,b,'stock',{quantity:3,reason:'waste',version:(await row(db,id)).version},id);
  await db.batch([
   {sql:'INSERT INTO products(id,business_id,name,price_cents) VALUES(?,?,?,?)',params:['p'+id,b,'Salada',500]},
   {sql:'INSERT INTO recipes(product_id,inventory_id,quantity) VALUES(?,?,1)',params:['p'+id,id]},
  ]);
  assert.equal(await status(call(db,b,'remove',{version:(await row(db,id)).version},id)),409,'recipe link blocks removal');
  await db.batch([{sql:'DELETE FROM recipes WHERE inventory_id=?',params:[id]}]);
  assert.equal(await status(call(db,b,'remove',{version:(await row(db,id)).version},id)),200);
  assert.equal((await listInventory(db,b,false)).length,0);assert.equal((await listInventory(db,b,true)).length,1);
  assert.equal(await status(call(db,b,'edit',{name:'Novo',version:(await row(db,id)).version},id)),409,'removed items are read-only');
  assert.equal(await status(call(db,b,'create',{name:'tomate',unit:'un'})),409,'removed names stay reserved');
  assert.equal(await status(call(db,b,'restore',{version:(await row(db,id)).version},id)),200);
  assert.equal(await status(call(db,b,'restore',{version:(await row(db,id)).version},id)),409,'already active');
  assert.equal((await listInventory(db,b,false)).length,1);
 }},
 {name:'archived trucks cannot change inventory',run:async db=>{
  const b=await business(db);
  const org='o'+b;
  await db.batch([
   {sql:'INSERT INTO organizations(id,name) VALUES(?,?)',params:[org,'Org']},
   {sql:'INSERT INTO organization_trucks(organization_id,business_id,archived) VALUES(?,?,true)',params:[org,b]},
  ]);
  assert.equal(await status(call(db,b,'create',{name:'Qualquer',unit:'un'})),409);
 }},
 {name:'two simultaneous withdrawals of the same stock: exactly one wins',run:async db=>{
  const b=await business(db);
  const {id}=await call(db,b,'create',{name:'Último',unit:'un',quantity:10});
  const version=(await row(db,id)).version;
  const results=await Promise.all([1,2,3,4].map(()=>status(call(db,b,'stock',{quantity:8,reason:'waste',version},id))));
  assert.equal(results.filter(code=>code===200).length,1,JSON.stringify(results));
  assert.ok(results.every(code=>code===200||code===409),JSON.stringify(results));
  assert.equal((await row(db,id)).quantity,2);
  assert.equal(await count(db,'SELECT count(*) AS n FROM stock_movements WHERE inventory_id=? AND delta=-8',[id]),1);
 }},
 {name:'simultaneous creates of one name produce one ingredient',run:async db=>{
  const b=await business(db);
  const results=await Promise.all([1,2,3,4,5].map(()=>status(call(db,b,'create',{name:'Manteiga',unit:'g',quantity:5}))));
  assert.equal(results.filter(code=>code===200).length,1,JSON.stringify(results));
  assert.equal(await count(db,'SELECT count(*) AS n FROM inventory WHERE business_id=?',[b]),1);
  assert.equal(await count(db,'SELECT count(*) AS n FROM stock_movements WHERE inventory_id IN (SELECT id FROM inventory WHERE business_id=?)',[b]),1);
 }},
 {name:'a failed batch leaves no partial writes',run:async db=>{
  const b=await business(db);
  const {id}=await call(db,b,'create',{name:'Atómico',unit:'un',quantity:5});
  const before=await row(db,id);
  await assert.rejects(db.batch([
   {sql:'UPDATE inventory SET quantity=quantity+1 WHERE id=?',params:[id],expectChanges:1},
   {sql:'INSERT INTO stock_movements(id,inventory_id,delta,reason,created_at) VALUES(?,?,1,?,?)',params:[newId(),id,'restock',1]},
   {sql:'UPDATE inventory SET quantity=quantity+1 WHERE id=?',params:['missing'],expectChanges:1},
  ]),/Write conflict|changed rows|constraint/i);
  assert.equal((await row(db,id)).quantity,before.quantity);
  assert.equal(await count(db,'SELECT count(*) AS n FROM stock_movements WHERE inventory_id=?',[id]),1);
 }},
];
