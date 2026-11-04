import {spawn,spawnSync} from 'node:child_process';
import net from 'node:net';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
const selectedEnv=process.env.FOODTRUCK_ENV_FILE||'.env.install';if(existsSync(selectedEnv))process.loadEnvFile(selectedEnv);
if(!process.env.DATABASE_URL&&existsSync('.env.local'))process.loadEnvFile('.env.local');
if(!process.env.DATABASE_URL&&existsSync('data/network.env'))process.loadEnvFile('data/network.env');
for(const key of ['DATA_DIRECTORY','DATABASE_CA_CERT_FILE'])if(process.env[key])process.env[key]=resolve(process.env[key]);
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required. Start npm run db:local first, or configure PostgreSQL.');
const production=process.argv.includes('--production');
const children=[];
function launch(dir,args,extra={}){const child=spawn(process.execPath,args,{cwd:dir,stdio:'inherit',env:{...process.env,...extra}});children.push(child);child.on('exit',code=>{if(!stopping){console.error(`${dir} stopped (${code}); shutting down related services`);stop(code||1);}});return child;}
let stopping=false;function stop(code=0){stopping=true;for(const child of children)child.kill('SIGTERM');setTimeout(()=>process.exit(code),1000).unref();}process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
async function listening(){const url=new URL(process.env.DATABASE_URL);return new Promise(resolve=>{const socket=net.createConnection({host:url.hostname,port:Number(url.port||5432)});socket.setTimeout(500);socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));socket.once('timeout',()=>{socket.destroy();resolve(false);});});}
if(!await listening()){
 if(!production&&existsSync('data/network.env')){launch('.',['scripts/local-postgres.mjs']);let ready=false;for(let n=0;n<120;n++){if(await listening()){ready=true;break;}await new Promise(r=>setTimeout(r,500));}if(!ready)throw new Error('Local PostgreSQL did not start');}
 else throw new Error('PostgreSQL is unavailable at DATABASE_URL');
}
const migration=spawnSync(process.execPath,['../../node_modules/tsx/dist/cli.mjs','scripts/migrate.ts'],{cwd:'services/api',env:{...process.env,DATABASE_URL:process.env.DATABASE_MIGRATION_URL||process.env.DATABASE_URL},stdio:'inherit'});if(migration.status!==0)throw new Error('Database migration failed');
launch('services/api',[production?'dist/services/api/src/server.js':'../../node_modules/tsx/dist/cli.mjs',...production?[]:['src/server.ts']],{PORT:'4000'});
launch('services/api',[production?'dist/services/api/src/worker.js':'../../node_modules/tsx/dist/cli.mjs',...production?[]:['src/worker.ts']]);
for(const [dir,port] of [['apps/customer','3000'],['apps/management','3001']])launch(dir,['../../node_modules/next/dist/bin/next',production?'start':'dev','-p',port],{INTERNAL_API_URL:'http://127.0.0.1:4000',CUSTOMER_APP_URL:process.env.CUSTOMER_APP_URL||'http://localhost:3000',MANAGEMENT_APP_URL:process.env.MANAGEMENT_APP_URL||'http://localhost:3001'});
