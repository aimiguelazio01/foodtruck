import {readFile} from 'node:fs/promises';
import {test} from 'node:test';import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {applyD1Migrations} from './d1-migrate.mjs';import {loadD1Migrations} from './d1-schema.mjs';

// Logical dump/import over real local D1 bindings. This does not simulate or prove
// Cloudflare's remote presigned SQL import API, which has separate mock tests.
async function copyDatabase(source,target){
 const schema=(await source.prepare("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all()).results;
 const statements=[target.prepare('PRAGMA defer_foreign_keys=ON')];
 const tables=schema.filter(row=>row.type==='table');
 for(const table of tables)statements.push(target.prepare(table.sql));
 for(const table of tables){
  const name='"'+table.name.replaceAll('"','""')+'"';
  for(const row of (await source.prepare('SELECT * FROM '+name).all()).results){const keys=Object.keys(row);statements.push(target.prepare('INSERT INTO '+name+' ('+keys.map(k=>'"'+k.replaceAll('"','""')+'"').join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')').bind(...keys.map(k=>row[k])))}
 }
 for(const item of schema.filter(row=>row.type!=='table'))statements.push(target.prepare(item.sql));
 await target.batch(statements);
}
test('restored D1/R2 copy supports login, menus, images and inventory without altering source',{timeout:120000},async()=>{
 const bundle=await build({entryPoints:[fileURLToPath(new URL('./api-worker.mjs',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
 const create=origin=>new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-11-03',d1Databases:['DB'],r2Buckets:['MEDIA'],bindings:{MANAGEMENT_ORIGIN:origin,INSTALL_TOKEN:'a'.repeat(64),INSTALL_TOKEN_EXPIRES_AT:new Date(Date.now()+300000).toISOString(),BOOTSTRAP_ID:'foodtruck-'+ 'b'.repeat(32)}}));
 const origin='https://management.source.test',copyOrigin='https://management.copy.test';const source=create(origin),copy=create(copyOrigin);
 const send=(runtime,host,method,path,body,cookie,headers={})=>runtime.dispatchFetch(host+'/api/v1'+path,{method,headers:{origin:host,...(cookie?{cookie}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const json=async response=>{const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data};
 try{
  const db=await source.getD1Database('DB'),restored=await copy.getD1Database('DB');await applyD1Migrations(db,await loadD1Migrations());
  const admin={email:'restore-owner@example.test',password:'a strong restore test password'};
  const installed=await send(source,origin,'POST','/installation/complete',{...admin,name:'Snapshot Truck',address:'',phone:'',contactEmail:'',primaryColor:'#123456',secondaryColor:'#654321'},undefined,{'x-install-token':'a'.repeat(64)});assert.equal(installed.status,201,await installed.text());
  const sourceLogin=await send(source,origin,'POST','/auth/login',admin);assert.equal(sourceLogin.status,200);const sourceCookie=sourceLogin.headers.get('set-cookie').split(';')[0];
  const [business]=(await json(await send(source,origin,'GET','/manage/businesses',undefined,sourceCookie))).businesses;
  const key='uploads/12345678-1234-1234-1234-123456789abc.webp';const image=new Uint8Array([82,73,70,70,1,2,3]);
  await (await source.getR2Bucket('MEDIA')).put(key,image,{httpMetadata:{contentType:'image/webp'}});
  const product=await json(await send(source,origin,'POST',`/manage/businesses/${business.id}/products`,{name:'Menu de teste',price_cents:900,available:1,image:'/'+key},sourceCookie));
  const ingredient=await json(await send(source,origin,'POST',`/manage/businesses/${business.id}/inventory`,{name:'Farinha',unit:'g',quantity:100,minimum:2,supplier:''},sourceCookie));
  const eventId=crypto.randomUUID();
  await db.batch([
   db.prepare('INSERT INTO recipes(product_id,inventory_id,quantity) VALUES (?,?,2)').bind(product.id,ingredient.id),
   db.prepare('INSERT INTO events(id,business_id,title,address,starts_at,ends_at) VALUES (?,?,?,?,?,?)').bind(eventId,business.id,'Mercado de teste','Local de teste',Date.now()-60000,Date.now()+7200000),
  ]);
  await copyDatabase(db,restored);
  const resetSQL=await readFile(new URL('../../desktop/launcher/cloudflare/restore-session-reset.sql',import.meta.url),'utf8');
  await restored.batch(resetSQL.split(';').map(s=>s.trim()).filter(Boolean).map(sql=>restored.prepare(sql)));
  assert.equal((await send(copy,copyOrigin,'GET','/auth/me',undefined,sourceCookie)).status,401,'source cookie is invalid in restored copy');
  await (await copy.getR2Bucket('MEDIA')).put(key,image,{httpMetadata:{contentType:'image/webp'}});
  const login=await send(copy,copyOrigin,'POST','/auth/login',admin);assert.equal(login.status,200,await login.clone().text());const cookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await json(await send(copy,copyOrigin,'GET','/auth/me',undefined,cookie))).user.email,admin.email);
  const products=(await json(await send(copy,copyOrigin,'GET',`/manage/businesses/${business.id}/products`,undefined,cookie))).products;assert.equal(products.find(p=>p.id===product.id).image,'/'+key);
  assert.equal((await json(await send(copy,copyOrigin,'GET','/public/businesses'))).businesses[0].name,'Snapshot Truck');
  const photo=await copy.dispatchFetch(copyOrigin+'/'+key);assert.equal(photo.status,200);assert.deepEqual(new Uint8Array(await photo.arrayBuffer()),image);
  const inventory=(await json(await send(copy,copyOrigin,'GET',`/manage/businesses/${business.id}/inventory`,undefined,cookie))).inventory;const item=inventory.find(row=>row.id===ingredient.id);
  await json(await send(copy,copyOrigin,'POST',`/manage/businesses/${business.id}/inventory/${item.id}/stock`,{quantity:7,reason:'waste',version:item.version},cookie));
  assert.equal((await restored.prepare('SELECT quantity FROM inventory WHERE id=?').bind(item.id).first()).quantity,93);
  assert.equal((await db.prepare('SELECT quantity FROM inventory WHERE id=?').bind(item.id).first()).quantity,100);
  const menu=await json(await send(copy,copyOrigin,'GET',`/public/businesses/${business.slug}`));assert.ok(menu.slots.length>0);
  const checkout={name:'Cliente de teste',contact:'customer@example.test',requestKey:'e'.repeat(64),pickupAt:menu.slots[0],items:[{id:product.id,quantity:1}],expectedTotal:900,paymentMethod:'collection'};
  const order=await json(await send(copy,copyOrigin,'POST',`/public/businesses/${business.slug}/orders`,checkout));
  assert.equal((await json(await send(copy,copyOrigin,'POST',`/public/businesses/${business.slug}/orders`,checkout))).id,order.id,'checkout retry is idempotent');
  assert.equal((await restored.prepare('SELECT reserved FROM inventory WHERE id=?').bind(item.id).first()).reserved,2);
  const managed=await json(await send(copy,copyOrigin,'GET',`/manage/businesses/${business.id}/orders`,undefined,cookie));assert.ok(managed.orders.some(row=>row.id===order.id));
  await json(await send(copy,copyOrigin,'PATCH',`/manage/businesses/${business.id}/orders/${order.id}/status`,{status:'cancelled',version:1},cookie));
  assert.equal((await restored.prepare('SELECT reserved FROM inventory WHERE id=?').bind(item.id).first()).reserved,0);
  assert.equal((await db.prepare('SELECT count(*) n FROM orders').first()).n,0,'source has no test orders');
  assert.equal((await db.prepare('SELECT reserved FROM inventory WHERE id=?').bind(item.id).first()).reserved,0,'source has no test reservations');

  assert.equal((await db.prepare('SELECT count(*) n FROM sessions').first()).n,1,'source sessions unaffected');
 }finally{await Promise.all([source.dispose(),copy.dispose()])}
});
