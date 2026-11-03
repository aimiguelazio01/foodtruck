import {randomBytes,randomUUID,scryptSync} from 'node:crypto';
import {createInterface,emitKeypressEvents} from 'node:readline';
import {stdin,stdout} from 'node:process';
import pg from 'pg';
import {loadInstallEnv,connectionOptions} from './install-config.mjs';
loadInstallEnv();
async function passwordPrompt(){
 if(!stdin.isTTY)throw new Error('Defina BOOTSTRAP_PASSWORD no ambiente privado ou use um terminal interativo.');
 stdout.write('Palavra-passe (oculta, mínimo 12 caracteres): ');emitKeypressEvents(stdin);stdin.setRawMode(true);stdin.resume();
 return new Promise((resolve,reject)=>{let value='';const stop=()=>{stdin.off('keypress',listener);stdin.setRawMode(false);stdin.pause();stdout.write('\n')};const listener=(str,key)=>{if(key?.ctrl&&key.name==='c'){stop();reject(new Error('Cancelado.'))}else if(key?.name==='return'){stop();resolve(value)}else if(key?.name==='backspace'){value=value.slice(0,-1)}else if(str&&!key?.ctrl)value+=str};stdin.on('keypress',listener)});
}
let pool;
try{
 let email=process.env.BOOTSTRAP_EMAIL,name=process.env.BOOTSTRAP_ORGANIZATION||'A minha rede';
 if(!email){if(!stdin.isTTY)throw new Error('Defina BOOTSTRAP_EMAIL.');const rl=createInterface({input:stdin,output:stdout});email=await new Promise(r=>rl.question('Email do administrador: ',r));name=await new Promise(r=>rl.question('Nome da organização: ',v=>r(v||name)));rl.close()}
 email=email.trim().toLowerCase();const password=process.env.BOOTSTRAP_PASSWORD||await passwordPrompt();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||name.length>100||password.length<12||password.length>256)throw new Error('Email/nome inválido ou palavra-passe fora de 12 a 256 caracteres.');
 pool=new pg.Pool(connectionOptions(process.env.DATABASE_MIGRATION_URL||process.env.DATABASE_URL));const c=await pool.connect();
 try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(81293474)');const existing=await c.query('SELECT (SELECT count(*) FROM users)+(SELECT count(*) FROM organizations)+(SELECT count(*) FROM businesses) AS n');if(Number(existing.rows[0].n))throw new Error('Bootstrap recusado: a base já tem contas, organizações ou negócios. Use a gestão existente.');
 const uid=randomUUID(),oid=randomUUID(),salt=randomBytes(16).toString('hex');await c.query('INSERT INTO users(id,email,password) VALUES($1,$2,$3)',[uid,email,salt+':'+scryptSync(password,salt,64).toString('hex')]);await c.query('INSERT INTO organizations(id,name) VALUES($1,$2)',[oid,name]);await c.query("INSERT INTO organization_members VALUES($1,$2,'network_owner')",[oid,uid]);await c.query('COMMIT');console.log('Administrador e organização criados. Entre na gestão e abra Rede > Negócios para criar a primeira carrinha.');
 }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
}catch(e){console.error(e.code?'Falha de PostgreSQL: confirme migrações, ligação e permissões (detalhes privados não mostrados).':e.message);process.exitCode=1}finally{await pool?.end();delete process.env.BOOTSTRAP_PASSWORD}
