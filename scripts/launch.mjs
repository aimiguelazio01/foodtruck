import {findNpmCli} from './npm-cli.mjs';
import {existsSync,mkdirSync,readFileSync,writeFileSync,unlinkSync,readdirSync} from 'node:fs';

import {resolve,dirname,join} from 'node:path';

import {fileURLToPath} from 'node:url';

import {randomBytes,createHash} from 'node:crypto';

import {spawn} from 'node:child_process';

import {createInterface} from 'node:readline/promises';

import net from 'node:net';

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)),'..'));

const children=new Set();let postgres,lockOwned=false,stopping=false;

const dataRoot=resolve(process.env.FOODTRUCK_DATA_ROOT||'data');
const lock=join(dataRoot,'launcher.lock');

async function stop(code=0){

 if(stopping)return;stopping=true;

 await Promise.all([...children].map(child=>new Promise(done=>{

  if(child.exitCode!==null)return done();

  if(process.platform==='win32'){const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});killer.once('close',done);killer.once('error',done);}

  else{try{process.kill(-child.pid,'SIGTERM')}catch{}child.once('close',done);setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL')}catch{}done()},5000).unref();}

 })));

 try{await postgres?.stop();}catch(e){console.error('Não foi possível terminar PostgreSQL. Os dados foram preservados.');console.error(e.message);code=1;}

 if(lockOwned)try{unlinkSync(lock)}catch{}

 process.exitCode=code;if(process.connected)process.disconnect();

}

process.on('message',message=>{if(message==='foodtruck:stop')void stop()});

process.on('SIGHUP',()=>void stop());if(process.platform==='win32')process.on('SIGBREAK',()=>void stop());
process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());

function child(command,args,env,cwd='.'){

 const p=spawn(command,args,{cwd,env,stdio:'inherit',windowsHide:true,detached:process.platform!=='win32'});children.add(p);

 p.once('error',()=>{console.error('Não foi possível iniciar um serviço.');void stop(1)});

 p.once('exit',code=>{children.delete(p);if(p.service&&!stopping){console.error('Um serviço terminou. A encerrar esta sessão.');void stop(code||1)}});return p;

}

async function run(args,env,cwd='.'){

 if(stopping)throw Error('Arranque interrompido.');

 const p=child(process.execPath,args,env,cwd);

 await new Promise((ok,fail)=>{p.once('error',fail);p.once('close',code=>code===0?ok():fail(Error('O comando falhou. Consulte a mensagem anterior.')))});

}

async function free(port){await new Promise((ok,fail)=>{const server=net.createServer();server.once('error',()=>fail(Error(`A porta ${port} está ocupada. Feche a outra instância e tente novamente.`)));server.listen(port,'127.0.0.1',()=>server.close(ok))})}

async function healthy(url){for(let n=0;n<240;n++){if(stopping)throw Error('Arranque interrompido.');try{const r=await fetch(url,{signal:AbortSignal.timeout(1500)});if(r.ok)return}catch{}await new Promise(r=>setTimeout(r,500))}throw Error('O serviço não ficou disponível: '+new URL(url).origin)}

function fingerprint(){const hash=createHash('sha256');const walk=dir=>{for(const entry of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){if(['node_modules','.next','dist','.open-next','.wrangler'].includes(entry.name))continue;const path=join(dir,entry.name);if(entry.isDirectory())walk(path);else if(!/next-env\.d\.ts|\.tsbuildinfo$/.test(path)){hash.update(path);hash.update(readFileSync(path));}}};for(const dir of ['apps','services/api/src','packages'])walk(dir);hash.update(readFileSync('package-lock.json'));return hash.digest('hex')}

try{

 if(Number(process.versions.node.split('.')[0])<24)throw Error('Instale Node.js 24 ou superior.');

 mkdirSync(dataRoot,{recursive:true});

 if(existsSync(lock)){

  const old=JSON.parse(readFileSync(lock,'utf8'));let alive=false;try{process.kill(old.pid,0);alive=true}catch(e){if(e.code!=='ESRCH')alive=true}

  if(alive)throw Error('Já existe um lançador ativo. Termine-o antes de abrir outro.');unlinkSync(lock);

 }

 writeFileSync(lock,JSON.stringify({pid:process.pid}),{flag:'wx',mode:0o600});lockOwned=true;

 let mode=process.argv.find(v=>['--demo','--system'].includes(v))?.slice(2);

 if(!mode){

  const rl=createInterface({input:process.stdin,output:process.stdout});

  console.log('\nFood Truck Live\n1 — Abrir demo (pode experimentar e editar)\n2 — Criar sistema novo / abrir o meu sistema\n');

  try{const answer=await rl.question('Escolha 1 ou 2: ');if(!['1','2'].includes(answer.trim()))throw Error('Escolha inválida. Volte a abrir INICIAR.cmd.');mode=answer.trim()==='1'?'demo':'system';}finally{rl.close()}

 }

 for(const port of [3000,3001,4000,mode==='demo'?5434:5433])await free(port);

 const dir=join(dataRoot,mode);mkdirSync(dir,{recursive:true});

 const probe=join(dir,'.write-check');writeFileSync(probe,'ok');unlinkSync(probe);

 const env={...process.env,NEXT_TELEMETRY_DISABLED:'1',NODE_ENV:'production',HOST:'127.0.0.1',PORT:'4000',COOKIE_SECURE:'0',DEMO_MODE:mode==='demo'?'1':'0',DEMO_READ_ONLY:'0',ALLOW_DEMO_SEED:mode==='demo'?'1':'0',API_UPDATES_MODE:'poll',DATA_DIRECTORY:dir,CUSTOMER_APP_URL:'http://localhost:3000',MANAGEMENT_APP_URL:'http://localhost:3001',INTERNAL_API_URL:'http://127.0.0.1:4000',CORS_ORIGINS:'http://localhost:3000,http://localhost:3001',FOODTRUCK_ENV_FILE:join(dir,'profile.env')};

 for(const key of ['VERCEL','DATABASE_CA_CERT_FILE','DATABASE_CA_CERT_PEM','DATABASE_MIGRATION_URL','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','S3_BUCKET','S3_ENDPOINT','BREVO_API_KEY','SMTP_URL','MAIL_FROM','INSTALL_TOKEN','INSTALL_TOKEN_EXPIRES_AT','CRON_SECRET','FOODTRUCK_NO_LISTEN','PGOPTIONS','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','PUBLIC_ORGANIZATION_ID','DATABASE_URL'])delete env[key];

 const npmCli=findNpmCli();

 if(!existsSync(npmCli))throw Error('Não foi encontrado npm. Instale a distribuição oficial Node.js com npm.');

 const lockHash=createHash('sha256').update(readFileSync('package-lock.json')).digest('hex');

 if(!existsSync('node_modules/.foodtruck-dependencies')||readFileSync('node_modules/.foodtruck-dependencies','utf8')!==lockHash){

  console.log('A instalar dependências. A primeira utilização precisa de internet…');

  await run([npmCli,'ci','--include=dev','--no-audit','--no-fund'],{...env,NODE_ENV:'development'});

  writeFileSync('node_modules/.foodtruck-dependencies',lockHash);

 }

 const EmbeddedPostgres=(await import('./local-cluster.mjs')).default;

 const secrets=join(dir,'postgres-secret');if(!existsSync(secrets))writeFileSync(secrets,randomBytes(24).toString('hex'),{mode:0o600});

 const password=readFileSync(secrets,'utf8');const port=mode==='demo'?5434:5433;

 postgres=new EmbeddedPostgres({databaseDir:join(dir,'postgres'),user:'foodtruck',password,port,persistent:true,postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>console.error('PostgreSQL: consulte o diagnóstico de instalação.')});

 if(!existsSync(join(dir,'postgres/PG_VERSION')))await postgres.initialise();

 await postgres.start();const client=postgres.getPgClient();await client.connect();try{if(!(await client.query("SELECT 1 FROM pg_database WHERE datname='foodtruck'")).rowCount)await client.query('CREATE DATABASE foodtruck')}finally{await client.end()}

 env.DATABASE_URL=`postgresql://foodtruck:${password}@127.0.0.1:${port}/foodtruck`;

 env.INSTALL_TOKEN=randomBytes(32).toString('hex');env.INSTALL_TOKEN_EXPIRES_AT=new Date(Date.now()+3600000).toISOString();

 writeFileSync(join(dir,'profile.env'),Object.entries(env).filter(([k])=>['DATABASE_URL','DATA_DIRECTORY','DEMO_MODE','DEMO_READ_ONLY','COOKIE_SECURE','INSTALL_TOKEN','INSTALL_TOKEN_EXPIRES_AT','CUSTOMER_APP_URL','MANAGEMENT_APP_URL','INTERNAL_API_URL','CORS_ORIGINS','HOST','PORT','API_UPDATES_MODE'].includes(k)).map(([k,v])=>`${k}=${JSON.stringify(v)}`).join('\n')+'\n',{mode:0o600});

 const tsx=resolve('node_modules/tsx/dist/cli.mjs');

 console.log('A verificar a base de dados…');await run([tsx,'services/api/scripts/migrate.ts'],env);

 if(mode==='demo')await run([tsx,'services/api/scripts/seed-demo.ts'],env);

 const hash=fingerprint(),marker=join(dataRoot,'build-fingerprint');

 if(!existsSync(marker)||readFileSync(marker,'utf8')!==hash||!existsSync('apps/customer/.next/BUILD_ID')||!existsSync('apps/management/.next/BUILD_ID')||!existsSync('services/api/dist/services/api/src/server.js')){

  console.log('A preparar a aplicação para utilização. Esta etapa pode demorar alguns minutos…');

  await run([npmCli,'run','build'],env);writeFileSync(marker,hash);

 }

 child(process.execPath,['dist/services/api/src/server.js'],env,'services/api').service=true;

 if(mode!=='demo')child(process.execPath,['dist/services/api/src/worker.js'],env,'services/api').service=true;

 for(const [app,port] of [['customer','3000'],['management','3001']])child(process.execPath,['../../node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',port],env,'apps/'+app).service=true;

 await healthy('http://127.0.0.1:4000/api/v1/health');await healthy('http://localhost:3001');await healthy('http://localhost:3000');

 const status=await (await fetch('http://127.0.0.1:4000/api/v1/installation/status')).json();

 const url=mode==='demo'?'http://localhost:3001/demo':status.configured?'http://localhost:3001':'http://localhost:3001/setup#token='+env.INSTALL_TOKEN;

 console.log('\nAplicação pronta. Site de clientes: http://localhost:3000\nGestão: '+url+'\nMantenha esta janela aberta. Prima Ctrl+C para terminar.');

 if(!process.argv.includes('--no-browser')){

  const command=process.platform==='win32'?'rundll32':process.platform==='darwin'?'open':'xdg-open';

  const args=process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url];const browser=spawn(command,args,{stdio:'ignore',windowsHide:true});browser.on('error',()=>console.log('Abra manualmente o endereço acima.'));browser.unref();

 }

}catch(e){console.error('\n'+(e instanceof Error?e.message:'Falha no arranque.'));await stop(1);}

