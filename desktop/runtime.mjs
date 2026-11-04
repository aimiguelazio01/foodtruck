import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import net from 'node:net';
import Cluster from '../scripts/local-cluster.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');process.chdir(root);
const children=new Set();let cluster,stopping=false;
const emit=(type,message,url)=>process.stdout.write(JSON.stringify({Type:type,Message:message,URL:url})+'\n');
async function stop(code=0){
 if(stopping)return;stopping=true;
 await Promise.all([...children].map(p=>new Promise(done=>{
  if(p.exitCode!==null)return done();
  if(process.platform==='win32'){const killer=spawn('taskkill',['/PID',String(p.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.once('error',done);killer.once('exit',done)}
  else{p.once('exit',done);try{process.kill(-p.pid,'SIGTERM')}catch{done()}setTimeout(()=>{try{process.kill(-p.pid,'SIGKILL')}catch{}done()},5000).unref()}
 })));
 try{await cluster?.stop()}catch{emit('error','Não foi possível terminar a base. Aguarde antes de voltar a abrir.');code=1}
 process.exitCode=code;
 input.close();process.stdin.destroy();
}
const input=createInterface({input:process.stdin});input.on('line',line=>{if(line.trim()==='stop')void stop()});input.on('close',()=>void stop());
for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.on(signal,()=>void stop());
function start(args,env,cwd=root,service=false){
 if(stopping)throw Error('Arranque interrompido.');
 const p=spawn(process.execPath,args,{cwd,env,windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});children.add(p);
 p.stdout.on('data',data=>process.stderr.write(data));p.stderr.on('data',data=>process.stderr.write(data));
 p.once('exit',code=>{children.delete(p);if(service&&!stopping){emit('error','Um serviço terminou. Volte ao ecrã inicial para abrir de novo.');void stop(code||1)}});p.on('error',()=>{if(service){emit('error','Não foi possível iniciar um serviço.');void stop(1)}});return p;
}
async function command(args,env){const p=start(args,env);await new Promise((ok,fail)=>{p.once('error',fail);p.once('exit',code=>code===0?ok():fail(Error('Não foi possível preparar a base. Consulte o diagnóstico.')))})}
async function free(port){await new Promise((ok,fail)=>{const s=net.createServer();s.once('error',()=>fail(Error(`A porta ${port} está ocupada. Termine a outra instalação e tente novamente.`)));s.listen(port,'127.0.0.1',()=>s.close(ok))})}
async function ready(url){for(let i=0;i<240;i++){if(stopping)throw Error('Arranque interrompido.');try{if((await fetch(url,{signal:AbortSignal.timeout(1500)})).ok)return}catch{}await new Promise(r=>setTimeout(r,500))}throw Error('A aplicação não ficou disponível. Consulte o diagnóstico.')}
try{
 const mode=process.argv.includes('--demo')?'demo':'system',dataRoot=process.env.FOODTRUCK_DATA_ROOT;
 if(!dataRoot)throw Error('Abra a aplicação pelo ícone Food Truck Live.');
 for(const port of [3000,3001,4000,mode==='demo'?5434:5433])await free(port);
 const dir=resolve(dataRoot,mode);mkdirSync(dir,{recursive:true});
 const secret=join(dir,'postgres-secret');if(!existsSync(secret))writeFileSync(secret,randomBytes(24).toString('hex'),{mode:0o600});const password=readFileSync(secret,'utf8'),port=mode==='demo'?5434:5433;
 emit('phase','A abrir a base de dados local…');
 cluster=new Cluster({databaseDir:join(dir,'postgres'),user:'foodtruck',password,port,persistent:true,onLog:()=>{},onError:()=>{}});
 if(!existsSync(join(dir,'postgres/PG_VERSION')))await cluster.initialise();if(stopping)throw Error('Arranque interrompido.');await cluster.start();
 const client=cluster.getPgClient();await client.connect();try{if(!(await client.query("SELECT 1 FROM pg_database WHERE datname='foodtruck'")).rowCount)await client.query('CREATE DATABASE foodtruck')}finally{await client.end()}
 const env={...process.env};for(const key of ['DATABASE_CA_CERT_FILE','DATABASE_CA_CERT_PEM','VERCEL','FOODTRUCK_NO_LISTEN','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','S3_BUCKET','S3_ENDPOINT','BREVO_API_KEY','SMTP_URL','MAIL_FROM','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','PUBLIC_ORGANIZATION_ID','PGOPTIONS'])delete env[key];
 Object.assign(env,{NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',DATABASE_URL:`postgresql://foodtruck:${password}@127.0.0.1:${port}/foodtruck`,DATA_DIRECTORY:dir,DEMO_MODE:mode==='demo'?'1':'0',DEMO_READ_ONLY:'0',ALLOW_DEMO_SEED:mode==='demo'?'1':'0',HOST:'127.0.0.1',PORT:'4000',COOKIE_SECURE:'0',API_UPDATES_MODE:'poll',CUSTOMER_APP_URL:'http://localhost:3000',MANAGEMENT_APP_URL:'http://localhost:3001',INTERNAL_API_URL:'http://127.0.0.1:4000',CORS_ORIGINS:'http://localhost:3000,http://localhost:3001',INSTALL_TOKEN:randomBytes(32).toString('hex'),INSTALL_TOKEN_EXPIRES_AT:new Date(Date.now()+3600000).toISOString()});
 emit('phase','A preparar o seu espaço…');
 await command(['desktop-dist/services/api/scripts/migrate.js'],env);if(mode==='demo')await command(['desktop-dist/services/api/scripts/seed-demo.js'],env);
 start([join(root,'desktop-dist/services/api/src/server.js')],env,root,true);
 if(mode!=='demo')start([join(root,'desktop-dist/services/api/src/worker.js')],env,root,true);
 for(const [app,port] of [['customer','3000'],['management','3001']])start([join(root,'node_modules/next/dist/bin/next'),'start','-H','127.0.0.1','-p',port],env,join(root,'apps',app),true);
 emit('phase','A abrir a aplicação…');await ready('http://127.0.0.1:4000/api/v1/health');await ready('http://localhost:3001');await ready('http://localhost:3000');
 const status=await (await fetch('http://127.0.0.1:4000/api/v1/installation/status')).json();
 const url=mode==='demo'?'http://localhost:3001/demo':status.configured?'http://localhost:3001':'http://localhost:3001/setup#token='+env.INSTALL_TOKEN;
 emit('ready','Aplicação pronta.',url);
}catch(e){if(!stopping)emit('error',e.message||'Não foi possível iniciar.');await stop(stopping?0:1)}
