import {spawn} from 'node:child_process';
import {createWriteStream,existsSync} from 'node:fs';
import {mkdir,cp,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
if(existsSync('.env.local'))process.loadEnvFile('.env.local');if(existsSync('data/network.env'))process.loadEnvFile('data/network.env');
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required');
const url=new URL(process.env.DATABASE_URL),dir=resolve('data/backups',new Date().toISOString().replace(/[:.]/g,'-'));await mkdir(dir,{recursive:true});
const dump=join(dir,'database.dump');const output=createWriteStream(dump,{mode:0o600});
try{await new Promise((resolve,reject)=>{const child=spawn(process.env.PG_DUMP_BIN||'pg_dump',['--format=custom','--no-owner'],{env:{...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:url.pathname.slice(1)},stdio:['ignore','pipe','pipe']});child.stdout.pipe(output);let error='';child.stderr.on('data',chunk=>error+=chunk);child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error(error||'pg_dump failed')));});await new Promise(r=>output.close(r));const uploads=resolve(process.env.DATA_DIRECTORY||'data','uploads');if(existsSync(uploads))await cp(uploads,join(dir,'uploads'),{recursive:true});console.log('Backup created: '+dir);}catch(e){output.destroy();await unlink(dump).catch(()=>{});throw new Error('PostgreSQL backup failed; install matching PostgreSQL client utilities or set PG_DUMP_BIN. '+String(e));}
