import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomBytes} from 'node:crypto';import pg from 'pg';import Fastify from 'fastify';import sharp from 'sharp';
const admin=new pg.Pool({connectionString:process.env.DATABASE_URL});const schema='test_permissions_'+randomBytes(6).toString('hex');await admin.query(`CREATE SCHEMA "${schema}"`);const url=new URL(process.env.DATABASE_URL!);url.searchParams.set('options',`-c search_path=${schema}`);process.env.DATABASE_URL=url.toString();const tmp=await mkdtemp(join(tmpdir(),'ft-permissions-'));process.env.DATA_DIRECTORY=tmp;
const {pool}=await import('../src/db.js');const {inventoryRoutes}=await import('../src/inventory.js');const {permissionRoutes}=await import('../src/permissions.js');const {managementRoutes}=await import('../src/management.js');const {operationsRoutes}=await import('../src/operations.js');const {mediaRoutes}=await import('../src/media.js');const {companyRoutes}=await import('../src/company.js');const {taskRoutes}=await import('../src/tasks.js');const {requireMember}=await import('../src/auth.js');const app=Fastify();app.decorateRequest('user',null);app.addHook('onRequest',async req=>{req.user={id:String(req.headers['x-user']||'owner'),email:'test@example.test'}});await companyRoutes(app);await taskRoutes(app);await permissionRoutes(app);await inventoryRoutes(app);await managementRoutes(app);await operationsRoutes(app);await mediaRoutes(app);app.get('/api/v1/manage/businesses/:id/orders',async req=>{await requireMember(req,(req.params as any).id);return {orders:[]}});
const request=(method:any,path:string,body?:any,user='owner')=>app.inject({method,url:'/api/v1/manage/businesses/'+path,payload:body,headers:{'x-user':user}});
try{
 for(const name of (await readdir(new URL('../migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort())await pool.query(await readFile(new URL('../migrations/'+name,import.meta.url),'utf8'));
 await pool.query("INSERT INTO businesses VALUES('b','b','Truck','#112233'),('other','other','Other','#112233');INSERT INTO business_settings(business_id) VALUES('b');INSERT INTO users VALUES('owner','owner@test.test','unused');INSERT INTO memberships VALUES('owner','b','owner')");
 let r=await request('POST','b/users',{email:'limited@example.test',password:'TestPassword2026!',role:'staff',permissions:{menus:true,inventory:true}});assert.equal(r.statusCode,200,r.body);const uid=r.json().id;
 const data=(await sharp({create:{width:16,height:16,channels:4,background:'#ffaa00'}}).png().toBuffer()).toString('base64');r=await request('POST','b/images',{data},uid);assert.equal(r.statusCode,200,r.body);const image=r.json().path;
 r=await request('POST','b/products',{name:'Product',price_cents:850,available:1,description:'Full description',category:'Menu',image},uid);assert.equal(r.statusCode,200,r.body);const pid=r.json().id;const product=(await pool.query('SELECT p.name,d.description,d.image FROM products p JOIN product_details d ON d.product_id=p.id WHERE p.id=$1',[pid])).rows[0];assert.equal(product.description,'Full description');assert.equal(product.image,image);
 assert.equal((await request('POST','b/inventory',{name:'Ingredient',unit:'un',minimum:1},uid)).statusCode,200);
 assert.equal((await request('GET','b/orders',undefined,uid)).statusCode,403);
 assert.equal((await request('GET','b/users',undefined,uid)).statusCode,403);
 assert.equal((await request('POST','b/operations',{command:'staff',email:'escape@test.test',password:'EscapePassword2026!',role:'manager'},uid)).statusCode,403);
 assert.equal((await request('POST','b/operations',{command:'branding',name:'No',color:'#000000'},uid)).statusCode,403);
 assert.equal((await request('POST','other/products',{name:'Escape',price_cents:1},uid)).statusCode,403);
 assert.equal((await request('PATCH',`b/users/${uid}/permissions`,{permissions:{orders:true}},uid)).statusCode,403);
 r=await request('PATCH',`b/users/${uid}/permissions`,{permissions:{orders:true}});assert.equal(r.statusCode,200,r.body);
 assert.equal((await request('GET','b/orders',undefined,uid)).statusCode,200);
 assert.equal((await request('PATCH',`b/products/${pid}`,{name:'Denied'},uid)).statusCode,403);
 assert.equal((await request('POST','b/images',{data},uid)).statusCode,403);
 r=await request('PATCH','b/products/'+pid,{name:'Product',description:'Updated',image:''});assert.equal(r.statusCode,200,r.body);assert.equal((await pool.query('SELECT image FROM product_details WHERE product_id=$1',[pid])).rows[0].image,'');
 r=await request('POST','b/products',{name:'Invalid',price_cents:200,image:'https://unsafe.test/image.png'});assert.equal(r.statusCode,400);assert.equal((await pool.query("SELECT count(*)::int n FROM products WHERE name='Invalid'")).rows[0].n,0);
 r=await request('POST','b/tasks',{title:'Preparar balcão',description:'Higienizar superfícies',priority:'high',due_at:Date.now()+3600000,assigned_to:uid});assert.equal(r.statusCode,200,r.body);const tid=r.json().id;
 assert.equal((await request('GET','b/tasks',undefined,uid)).statusCode,403);
 assert.equal((await request('PATCH',`b/users/${uid}/permissions`,{permissions:{tasks:true}})).statusCode,200);
 r=await request('GET','b/tasks',undefined,uid);assert.equal(r.statusCode,200);assert.equal(r.json().tasks.length,1);assert.equal(r.json().assignees.length,1);
 assert.equal((await request('PATCH',`b/tasks/${tid}`,{status:'in_progress',version:1},uid)).statusCode,200);
 assert.equal((await request('PATCH',`b/tasks/${tid}`,{status:'done',version:1},uid)).statusCode,409);
 assert.equal((await request('PATCH',`b/tasks/${tid}`,{status:'done',version:2},uid)).statusCode,200);
 assert.equal((await request('PATCH',`b/tasks/${tid}`,{assigned_to:'owner',version:3},uid)).statusCode,403);
 assert.equal((await request('PATCH',`other/tasks/${tid}`,{title:'Escape',version:3},uid)).statusCode,403);
 r=await request('POST','b/tasks',{title:'Tarefa pessoal'},uid);assert.equal(r.statusCode,200);const personal=r.json().id;
 assert.equal((await request('POST','b/tasks',{title:'Administrador',assigned_to:'owner'},uid)).statusCode,403);
 assert.equal((await request('DELETE',`b/tasks/${personal}`,{version:1},uid)).statusCode,200);
 assert.equal((await request('DELETE',`b/tasks/${tid}`,{version:3})).statusCode,200);
 await pool.query("INSERT INTO organizations VALUES('org','Original'); INSERT INTO organization_members VALUES('org','owner','network_owner'); INSERT INTO organization_trucks VALUES('org','b',false)");
 const company={company_name:'Empresa Teste',legal_name:'Nome fiscal privado',tax_id:'123456789',address:'Morada privada',contact_email:'public@test.test',contact_phone:'12345',website:'https://example.test'};
 let response=await app.inject({method:'POST',url:'/api/v1/network/org/company',payload:company,headers:{'x-user':uid}});assert.equal(response.statusCode,403);
 response=await app.inject({method:'POST',url:'/api/v1/network/org/company',payload:company});assert.equal(response.statusCode,200,response.body);
 const branding={app_name:'Marca Teste',logo:image,primary_color:'#111111',secondary_color:'#ffffff',accent_color:'#123456'};
 response=await app.inject({method:'POST',url:'/api/v1/network/org/branding',payload:branding});assert.equal(response.statusCode,200,response.body);
 response=await app.inject({method:'GET',url:'/api/v1/public/app-settings'});assert.equal(response.json().app_name,'Marca Teste');assert.equal(response.json().company_name,'Empresa Teste');assert.equal(response.json().tax_id,undefined);assert.equal(response.json().legal_name,undefined);assert.equal(response.json().address,undefined);assert.equal(response.json().logo,image);
 response=await app.inject({method:'POST',url:'/api/v1/network/org/branding',payload:{...branding,primary_color:'bad'}});assert.equal(response.statusCode,400);
 response=await app.inject({method:'POST',url:'/api/v1/network/org/company/images',payload:{data},headers:{'x-user':uid}});assert.equal(response.statusCode,403);

 // Full identity save, including default values sent by a newly-created truck editor.
 const identity={command:'branding',name:'Truck',color:'#e1ba2d',description:'',contact:'',cover:image,logo:image,secondary_color:'#283820',accent_color:'#f0a76d',appearance:'light',social_links:'',slot_capacity:5,retention_days:90};
 r=await request('POST','b/operations',identity);assert.equal(r.statusCode,200,r.body);
 const identitySettings=(await pool.query("SELECT cover,logo FROM business_settings WHERE business_id='b'")).rows[0];assert.equal(identitySettings.cover,image);assert.equal(identitySettings.logo,image);
 for(const [field,value,label] of [['slot_capacity',0,'Capacidade por horário'],['retention_days',0,'Retenção dos contactos'],['color','yellow','Cor principal'],['cover','not-an-upload','Fotografia da carrinha'],['logo','not-an-upload','Logótipo'],['social_links','not a valid address','Redes sociais e site']] as const){
  r=await request('POST','b/operations',{...identity,name:'Must roll back',[field]:value});assert.equal(r.statusCode,400,r.body);assert.ok(r.json().message.includes(label),r.body);assert.equal((await pool.query("SELECT name FROM businesses WHERE id='b'")).rows[0].name,'Truck');
 }
 r=await request('POST','b/operations',{...identity,social_links:'https://example.test/one\r\nhttps://example.test/two'});assert.equal(r.statusCode,200,r.body);
 assert.equal((await pool.query("SELECT social_links FROM business_settings WHERE business_id='b'")).rows[0].social_links,'https://example.test/one\nhttps://example.test/two');

 r=await request('POST','b/operations',{...identity,social_links:'instagram.com/test\nwww.example.test/menu, https://example.test/one; instagram.com/test'});
 assert.equal(r.statusCode,200,r.body);
 assert.equal((await pool.query("SELECT social_links FROM business_settings WHERE business_id='b'")).rows[0].social_links,'https://instagram.com/test\nhttps://www.example.test/menu\nhttps://example.test/one');
 for(const link of ['javascript:alert(1)','data:text/html,test','ftp://example.test/test','not a valid address']){
  r=await request('POST','b/operations',{...identity,social_links:link});assert.equal(r.statusCode,400,r.body);
 }
 r=await request('POST','b/operations',{...identity,social_links:'   '});assert.equal(r.statusCode,200,r.body);
 assert.equal((await pool.query("SELECT social_links FROM business_settings WHERE business_id='b'")).rows[0].social_links,'');
 console.log('PASS: social links without protocol, comma/semicolon/newline separators, deduplication, blank field, unsafe and invalid URLs rejected.');
 console.log('PASS: new-truck full identity save with photo/logo; actionable field errors; invalid save rollback; multiple social links.');
 console.log('PASS: administrator-only company/branding settings; public branding; private fiscal data excluded; invalid color rejected; logo upload authorization.');
 console.log('PASS: task creation, assignment, status transitions, stale version protection, task permission denial, personal scope and deletion.');
 console.log('PASS: product description/image atomic save; limited menu/inventory user; order denial; administrator-only grants; cross-truck denial; immediate revocation; image removal; rollback invalid product.');
}finally{await app.close();await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();await rm(tmp,{recursive:true,force:true})}
