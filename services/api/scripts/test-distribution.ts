import assert from 'node:assert/strict';

import {randomBytes} from 'node:crypto';

import {mkdirSync} from 'node:fs';

import {resolve} from 'node:path';

import {spawn} from 'node:child_process';

// @ts-ignore Local Node launcher module has no declaration file.
import EmbeddedPostgres from '../../../scripts/local-cluster.mjs';

const tsx=resolve('node_modules/tsx/dist/cli.mjs');

const scenario=process.argv.find(a=>a.startsWith('--scenario='))?.split('=')[1];

async function run(file:string,env:NodeJS.ProcessEnv,args:string[]=[]){

 await new Promise<void>((ok,fail)=>{const p=spawn(process.execPath,[tsx,file,...args],{env,stdio:'inherit',windowsHide:true});p.once('error',fail);p.once('exit',code=>code===0?ok():fail(Error(file+' failed: '+code)))});

}

if(!scenario){

 const dir=resolve('data/distribution-tests',randomBytes(6).toString('hex'));mkdirSync(dir,{recursive:true});

 const password=randomBytes(24).toString('hex'),port=Number(process.env.TEST_PG_PORT||55439);

 const pg=new EmbeddedPostgres({databaseDir:dir,user:'tester',password,port,persistent:true,postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});

 try{

  await pg.initialise();await pg.start();

  for(const mode of ['system','demo','playground']){

   await pg.createDatabase('distribution_'+mode);

   const env:NodeJS.ProcessEnv={...process.env,DATABASE_URL:`postgresql://tester:${password}@127.0.0.1:${port}/distribution_${mode}`,DEMO_MODE:mode!=='system'?'1':'0',DEMO_READ_ONLY:mode==='demo'?'1':'0',ALLOW_DEMO_SEED:'1',FOODTRUCK_NO_LISTEN:'1',API_UPDATES_MODE:'poll',COOKIE_SECURE:'0',DATA_DIRECTORY:resolve(dir,mode+'-media'),NODE_ENV:'test',INSTALL_TOKEN:'a'.repeat(64),INSTALL_TOKEN_EXPIRES_AT:new Date(Date.now()+3600000).toISOString(),CRON_SECRET:'b'.repeat(64)};

   for(const key of ['DATABASE_CA_CERT_FILE','DATABASE_CA_CERT_PEM','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','S3_BUCKET','BREVO_API_KEY','SMTP_URL','VERCEL'])delete env[key];

   await run('services/api/scripts/migrate.ts',env);await run('services/api/scripts/migrate.ts',env);

   if(mode!=='system'){await run('services/api/scripts/seed-demo.ts',env);await run('services/api/scripts/seed-demo.ts',env);}

   await run('services/api/scripts/test-distribution.ts',env,['--scenario='+mode]);

  }

  console.log('PASS: distribution installation, read-only demo and editable playground on isolated PostgreSQL.');

 }finally{await pg.stop()}

}else{

 const {default:app}=await import('../src/server.js');const {pool}=await import('../src/db.js');

 try{

  await app.ready();const status=()=>app.inject('/api/v1/installation/status');

  if(scenario==='system'){

   assert.equal((await status()).json().configured,false);

   const body={email:'admin@example.test',password:'PrivateInstall2026!',organization:'A minha rede',business:'O meu negócio'};

   const complete=(headers={})=>app.inject({method:'POST',url:'/api/v1/installation/complete',headers,payload:body});

   assert.equal((await complete()).statusCode,403);

   const expires=process.env.INSTALL_TOKEN_EXPIRES_AT!;process.env.INSTALL_TOKEN_EXPIRES_AT=new Date(0).toISOString();

   assert.equal((await complete({'x-install-token':process.env.INSTALL_TOKEN})).statusCode,403);process.env.INSTALL_TOKEN_EXPIRES_AT=expires;

   const outcomes=await Promise.all([complete({'x-install-token':process.env.INSTALL_TOKEN}),complete({'x-install-token':process.env.INSTALL_TOKEN})]);

   assert.deepEqual(outcomes.map(r=>r.statusCode).sort(),[200,409]);

   assert.equal((await status()).json().configured,true);

   const users=(await pool.query('SELECT * FROM users')).rows;assert.equal(users.length,1);assert.notEqual(users[0].password,body.password);

   assert.equal((await pool.query('SELECT count(*)::int n FROM products')).rows[0].n,0);

   assert.equal((await pool.query('SELECT count(*)::int n FROM businesses')).rows[0].n,1);

   const login=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:body.email,password:body.password}});assert.equal(login.statusCode,200);

   const cookie=String(login.headers['set-cookie']).split(';')[0];assert.ok(!String(login.headers['set-cookie']).includes('Secure'));

   const b=(await pool.query('SELECT id,slug FROM businesses')).rows[0];

   const product=await app.inject({method:'POST',url:`/api/v1/manage/businesses/${b.id}/products`,headers:{cookie},payload:{name:'Produto de teste',price_cents:500,available:1}});assert.equal(product.statusCode,200,product.body);

   const productId=product.json().id;
   const ingredient=await app.inject({method:'POST',url:`/api/v1/manage/businesses/${b.id}/inventory`,headers:{cookie},payload:{name:'Ingrediente de teste',unit:'un',quantity:10,minimum:1,supplier:'Fornecedor de teste'}});assert.equal(ingredient.statusCode,200,ingredient.body);
   const ingredientId=ingredient.json().id;
   const recipe=await app.inject({method:'POST',url:`/api/v1/manage/businesses/${b.id}/operations`,headers:{cookie},payload:{command:'recipe',product_id:productId,inventory_id:ingredientId,quantity:1}});assert.equal(recipe.statusCode,200,recipe.body);
   const sharp=(await import('sharp')).default;const image=(await sharp({create:{width:16,height:16,channels:4,background:'#ed8735'}}).png().toBuffer()).toString('base64');
   const upload=await app.inject({method:'POST',url:`/api/v1/manage/businesses/${b.id}/images`,headers:{cookie},payload:{data:image}});assert.equal(upload.statusCode,200,upload.body);assert.equal((await app.inject(upload.json().path)).statusCode,200);
   await pool.query('INSERT INTO events(id,business_id,title,address,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6)',['test-event',b.id,'Evento teste','Lisboa',Date.now(),Date.now()+86400000]);
   const menu=(await app.inject(`/api/v1/public/businesses/${b.slug}`)).json();assert.ok(menu.slots.length);
   const requestKey=randomBytes(32).toString('hex');const order=await app.inject({method:'POST',url:`/api/v1/public/businesses/${b.slug}/orders`,payload:{requestKey,name:'Cliente teste',contact:'cliente@example.test',items:[{id:productId,quantity:1}],pickupAt:menu.slots[0],expectedTotal:500}});assert.equal(order.statusCode,200,order.body);
   for(const status of ['confirmed','preparing','ready']){const changed=await app.inject({method:'PATCH',url:`/api/v1/manage/businesses/${b.id}/orders/${order.json().id}/status`,headers:{cookie},payload:{status}});assert.equal(changed.statusCode,200,changed.body);}
   assert.deepEqual((await pool.query('SELECT quantity,reserved FROM inventory WHERE id=$1',[ingredientId])).rows[0],{quantity:9,reserved:0});
   const {tick}=await import('../src/maintenance.js');

   const held=await pool.connect();await held.query('BEGIN');await held.query('SELECT pg_advisory_xact_lock(81293475)');assert.deepEqual(await tick(),{skipped:'running'});await held.query('ROLLBACK');held.release();

   assert.equal((await app.inject('/api/v1/internal/maintenance')).statusCode,401);

   const maintained=await app.inject({url:'/api/v1/internal/maintenance',headers:{authorization:'Bearer '+process.env.CRON_SECRET}});assert.equal(maintained.statusCode,200,maintained.body);

   console.log('PASS: empty setup, expired/missing token, concurrent bootstrap, login, products, inventory, recipe, upload, checkout, stock transitions and maintenance lock.');

  }else if(scenario==='playground'){
   assert.deepEqual((await status()).json(),{configured:true,demo:true,readOnly:false});
   const session=await app.inject({method:'POST',url:'/api/v1/demo/session'});assert.equal(session.statusCode,200,session.body);
   const cookie=String(session.headers['set-cookie']).split(';')[0],headers={cookie};
   const catalog=(await app.inject('/api/v1/public/businesses')).json().businesses;
   assert.deepEqual(catalog.map((b:any)=>b.demoCoverIndex).sort(),[0,1,2]);
   const redirect=await app.inject({url:'/api/v1/manage/customer-app',headers});assert.equal(redirect.statusCode,302);assert.equal(new URL(String(redirect.headers.location)).pathname,'/');
   const b=catalog[0];
   const create=await app.inject({method:'POST',url:`/api/v1/manage/businesses/${b.id}/products`,headers,payload:{name:'Experiência demo',price_cents:500,available:1}});assert.equal(create.statusCode,200,create.body);
   const id=create.json().id;
   const edit=await app.inject({method:'PATCH',url:`/api/v1/manage/businesses/${b.id}/products/${id}`,headers,payload:{name:'Demo editada',price_cents:500,available:1}});assert.equal(edit.statusCode,200,edit.body);
   const stock=await app.inject({method:'POST',url:`/api/v1/manage/businesses/${b.id}/inventory`,headers,payload:{name:'Stock demo',unit:'un',quantity:10,minimum:1,supplier:'Fornecedor demo'}});assert.equal(stock.statusCode,200,stock.body);
   const recipe=await app.inject({method:'POST',url:`/api/v1/manage/businesses/${b.id}/operations`,headers,payload:{command:'recipe',product_id:id,inventory_id:stock.json().id,quantity:1}});assert.equal(recipe.statusCode,200,recipe.body);
   const sharp=(await import('sharp')).default,image=(await sharp({create:{width:16,height:16,channels:4,background:'#ee8833'}}).png().toBuffer()).toString('base64');
   const upload=await app.inject({method:'POST',url:`/api/v1/manage/businesses/${b.id}/images`,headers,payload:{data:image}});assert.equal(upload.statusCode,200,upload.body);assert.equal((await app.inject(upload.json().path)).statusCode,200);
   const menu=(await app.inject(`/api/v1/public/businesses/${b.slug}`)).json();assert.ok(menu.slots.length);
   const order=await app.inject({method:'POST',url:`/api/v1/public/businesses/${b.slug}/orders`,payload:{requestKey:randomBytes(32).toString('hex'),name:'Cliente demo',contact:'cliente@example.test',items:[{id,quantity:1}],pickupAt:menu.slots[0],paymentMethod:'demo',expectedTotal:500}});assert.equal(order.statusCode,200,order.body);
   const email='playground@example.test',password='PlaygroundTest2026!';
   const register=await app.inject({method:'POST',url:'/api/v1/customer/register',payload:{email,password}});assert.equal(register.statusCode,200,register.body);assert.equal(register.json().demoVerified,true);
   assert.equal((await app.inject({method:'POST',url:'/api/v1/customer/login',payload:{email,password}})).statusCode,200);
   const {readFile}=await import('node:fs/promises');const outbox=await readFile(resolve(process.env.DATA_DIRECTORY!,'demo-outbox.jsonl'),'utf8');assert.ok(outbox.includes(email));
   assert.equal((await app.inject({method:'POST',url:'/api/v1/installation/complete',payload:{}})).statusCode,403);
   assert.equal((await app.inject({method:'POST',url:`/api/v1/manage/businesses/${b.id}/products`,payload:{name:'Sem sessão',price_cents:500}})).statusCode,401);
   const {tick}=await import('../src/maintenance.js');assert.deepEqual(await tick(),{skipped:'demo'});
   console.log('PASS: editable demo, catalog truck photos, main catalog redirect, product edit, inventory/recipe, uploads, simulated checkout, customer registration/login and simulated email.');
  }else{

   const data=(await status()).json();assert.deepEqual(data,{configured:true,demo:true,readOnly:true});

   const snapshot=async()=>JSON.stringify((await pool.query("SELECT (SELECT json_agg(x) FROM (SELECT id,status,payment,total_cents FROM orders ORDER BY id) x) orders,(SELECT json_agg(x) FROM (SELECT id,quantity,reserved FROM inventory ORDER BY id) x) inventory")).rows);

   const before=await snapshot();

   const session=await app.inject({method:'POST',url:'/api/v1/demo/session'});assert.equal(session.statusCode,200,session.body);const cookie=String(session.headers['set-cookie']).split(';')[0];

   const businesses=(await app.inject({url:'/api/v1/manage/businesses',headers:{cookie}})).json().businesses;assert.equal(businesses.length,3);

   const b=businesses[0];assert.equal((await pool.query('SELECT count(*)::int n FROM products')).rows[0].n,30);

   assert.equal((await pool.query('SELECT count(*)::int n FROM orders')).rows[0].n,72);

   for(const [method,url,payload] of [

    ['POST',`/api/v1/public/businesses/${b.slug}/orders`,{}],['PATCH',`/api/v1/manage/businesses/${b.id}/products/x`,{name:'Changed'}],

    ['POST',`/api/v1/manage/businesses/${b.id}/images`,{data:'AAAA'}],['POST','/api/v1/customer/register',{email:'test@example.test',password:'PrivateInstall2026!'}],

    ['POST','/api/v1/auth/forgot-password',{email:'owner@urban-burger.demo'}],['DELETE',`/api/v1/manage/businesses/${b.id}/products/x`,{}],['POST','/api/v1/installation/complete',{}]

   ] as const){const r=await app.inject({method,url,headers:{cookie},payload});assert.equal(r.statusCode,403,method+' '+url+' '+r.body);}

   const {tick}=await import('../src/maintenance.js');assert.deepEqual(await tick(),{skipped:'demo'});assert.equal(await snapshot(),before);

   for(const slug of ['urban-burger','bella-pizza','green-bowl'])assert.equal((await app.inject(`/api/v1/public/businesses/${slug}`)).statusCode,200);

   console.log('PASS: demo assets/catalog, read access, direct mutation refusal, maintenance preserves data.');

  }

 }finally{await app.close();await pool.end()}

}

