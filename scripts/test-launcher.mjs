// Run against a newly extracted release; no operational database is touched.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {readFileSync,mkdirSync} from 'node:fs';
import {cp} from 'node:fs/promises';
const root=resolve(process.argv[2]||'.');
const {chromium}=await import('playwright');
const dataRoot=resolve(root,'data','acceptance-'+Date.now());
const out=resolve('output/distribution');mkdirSync(out,{recursive:true});
async function session(mode,verify){
 const p=spawn(process.execPath,['scripts/launch.mjs','--'+mode,'--no-browser'],{cwd:root,env:{...process.env,FOODTRUCK_DATA_ROOT:dataRoot},stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
 let log='',closed=false;const done=new Promise(r=>p.once('close',code=>{closed=true;r(code)}));
 for(const stream of [p.stdout,p.stderr])stream.on('data',data=>{log+=data;const safe=String(data).replace(/#token=[a-f0-9]+/g,'#token=[private]');process.stdout.write(safe)});
 try{
  for(let n=0;n<1200&&!log.includes('Aplicação pronta.');n++){if(closed)throw Error('Launcher failed: '+log.slice(-2000));await new Promise(r=>setTimeout(r,500))}
  assert.ok(log.includes('Aplicação pronta.'),'launcher readiness');
  await verify(log);
 }finally{
  if(p.connected)p.send('foodtruck:stop');
  const code=await Promise.race([done,new Promise(r=>setTimeout(()=>r('timeout'),90000).unref())]);assert.equal(code,0,'graceful launcher shutdown');
 }
}
const browser=await chromium.launch({headless:true});
try{
 await session('demo',async()=>{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto('http://localhost:3001/demo');await page.waitForURL('http://localhost:3001/');await page.getByRole('button',{name:'Inventário',exact:true}).click();
  await page.getByRole('heading',{name:'Ingredientes e stock'}).waitFor();assert.equal(await page.getByRole('button',{name:'Adicionar ingrediente',exact:true}).isDisabled(),true);
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('.inventory-table tbody tr')).length>0);await page.screenshot({path:out+'/demo-desktop.png',fullPage:true});
  const denied=await page.request.post('http://localhost:3001/api/v1/customer/register',{data:{email:'x@example.test',password:'ValidPassword2026!'}});assert.equal(denied.status(),403);
  await page.goto('http://localhost:3000/b/urban-burger');await page.getByText('Demonstração — apenas consulta',{exact:true}).waitFor();
  await page.setViewportSize({width:375,height:900});await page.screenshot({path:out+'/demo-mobile.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await page.close();
 });
 await session('system',async log=>{
  const url=log.match(/Gestão: (http[^\s]+)/)?.[1];assert.ok(url?.includes('/setup#token='));
  const page=await browser.newPage({viewport:{width:375,height:900}});await page.goto(url);await page.getByLabel('Organização',{exact:true}).fill('Rede instalada');await page.getByLabel('Primeiro negócio',{exact:true}).fill('Carrinha instalada');
  await page.getByLabel('Email do administrador',{exact:true}).fill('instalador@example.test');await page.getByLabel('Palavra-passe',{exact:true}).fill('InstallOnly2026!');await page.getByLabel('Confirmar palavra-passe',{exact:true}).fill('InstallOnly2026!');
  await page.screenshot({path:out+'/setup-mobile.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.getByRole('button',{name:'Criar sistema',exact:true}).click();await page.getByRole('heading',{name:'O sistema está pronto'}).waitFor();
  const status=await (await page.request.get('http://localhost:3001/api/v1/installation/status')).json();assert.equal(status.configured,true);assert.equal(status.demo,false);await page.close();
 });
 await session('system',async log=>{
  assert.ok(!log.includes('/setup#token='),'restart opens existing login');
  const page=await browser.newPage();await page.goto('http://localhost:3001');await page.getByLabel('Email',{exact:true}).fill('instalador@example.test');await page.getByLabel('Palavra-passe',{exact:true}).fill('InstallOnly2026!');await page.getByRole('button',{name:'Entrar →',exact:true}).click();
  await page.getByRole('button',{name:'Inventário',exact:true}).waitFor();await page.getByRole('button',{name:'Menu digital',exact:true}).click();
  const businesses=await (await page.request.get('http://localhost:3001/api/v1/manage/businesses')).json();assert.equal(businesses.businesses.length,1);assert.equal(businesses.businesses[0].name,'Carrinha instalada');await page.close();
 });
 const backup=resolve(out,'cold-backup-'+Date.now());await cp(resolve(dataRoot,'system'),backup,{recursive:true});
 const restore=resolve(out,'restored-'+Date.now());await cp(backup,restore,{recursive:true});
 const EmbeddedPostgres=(await import('./local-cluster.mjs')).default;
 const pg=new EmbeddedPostgres({databaseDir:resolve(restore,'postgres'),user:'foodtruck',password:readFileSync(resolve(restore,'postgres-secret'),'utf8'),port:55440,persistent:true,postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
 try{await pg.start();const client=pg.getPgClient('foodtruck');await client.connect();try{
  assert.equal((await client.query('SELECT count(*)::int n FROM users')).rows[0].n,1);assert.equal((await client.query('SELECT name FROM businesses')).rows[0].name,'Carrinha instalada');
 }finally{await client.end()}}finally{await pg.stop()}
 console.log('PASS: extracted release first install, demo UI, protected setup, restart, login, mobile layout, graceful shutdown and cold-backup restore.');
}finally{await browser.close()}
