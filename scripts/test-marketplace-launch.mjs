import assert from 'node:assert/strict';
import {cp,mkdir,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
const version=JSON.parse(await readFile('package.json','utf8')).version;
const folder=resolve('tmp','marketplace-acceptance-'+Date.now());await mkdir(folder,{recursive:true});
for(const name of ['INICIAR.mjs',`Food_Truck_Live-${version}.zip`])await cp(join('release/marketplace',name),join(folder,name));
async function run(mode,verify){
 const child=spawn(process.execPath,[join(folder,'INICIAR.mjs'),'--'+mode,'--no-browser'],{cwd:folder,env:process.env,stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
 let log='',exitCode=null;const done=new Promise(r=>child.once('close',code=>{exitCode=code;r(code)}));
 for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{log+=data;for(const line of String(data).split('\n'))if(line.trim()&&!line.startsWith('{'))process.stdout.write(line.replace(/#token=[a-f0-9]+/g,'#token=[private]')+'\n')});
 try{
  for(let n=0;n<1200&&!log.includes('Aplicação pronta.');n++){if(exitCode!==null)throw Error('Starter failed: '+log.slice(-2000));await new Promise(r=>setTimeout(r,500))}
  assert.ok(log.includes('Aplicação pronta.'),'readiness');await verify(log);
 }finally{
  if(child.connected)child.send('foodtruck:stop');
  assert.equal(await Promise.race([done,new Promise(r=>setTimeout(()=>r('timeout'),90000).unref())]),0,'starter and services exit cleanly');
 }
}
const api='http://127.0.0.1:4000/api/v1';
await run('demo',async()=>{
 const status=await (await fetch(api+'/installation/status')).json();assert.equal(status.readOnly,true);
 assert.equal((await (await fetch(api+'/public/businesses')).json()).businesses.length,3);
 assert.equal((await fetch(api+'/customer/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'invalid@example.test',password:'PrivateTest2026!'})})).status,403);
});
await run('system',async log=>{
 const status=await (await fetch(api+'/installation/status')).json();assert.equal(status.configured,false);assert.equal(status.demo,false);
 const token=log.match(/#token=([a-f0-9]{64})/)?.[1];assert.ok(token);
 const response=await fetch(api+'/installation/complete',{method:'POST',headers:{'content-type':'application/json','x-install-token':token},body:JSON.stringify({organization:'Rede universal',business:'Carrinha universal',email:'universal@example.test',password:'UniversalTest2026!'})});assert.equal(response.status,200,await response.text());
});
await run('system',async log=>{
 assert.ok(!log.includes('/setup#token='));
 const response=await fetch(api+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'universal@example.test',password:'UniversalTest2026!'})});assert.equal(response.status,200);
 assert.equal((await (await fetch(api+'/public/businesses')).json()).businesses[0].name,'Carrinha universal');
});
console.log('PASS: two-file universal starter, automatic extraction, clean dependency installation/build, demo, new system, persistent restart and shutdown.');
