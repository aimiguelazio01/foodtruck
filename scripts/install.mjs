import {existsSync,copyFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import pg from 'pg';
import {loadInstallEnv,connectionOptions} from './install-config.mjs';
const mode=process.argv[2]||'help';
try{
 if(mode==='init'){
  if(existsSync('.env.install'))throw new Error('.env.install já existe; não foi alterado.');
  const profile=process.argv.find(arg=>arg.startsWith('--profile='))?.slice(10);
  if(profile&&!['vercel','cloudflare','docker-local','docker-server'].includes(profile))throw new Error('Perfil inválido.');
  copyFileSync(profile?'deployment/profiles/'+profile+'.env.example':'.env.install.example','.env.install');console.log('Criado .env.install. Edite as ligações, domínios e segredos; depois execute npm run install:check.');
 }else if(mode==='check'||mode==='doctor'){
  loadInstallEnv();let errors=0;const check=(ok,label)=>{console.log(`${ok?'OK':'ERRO'}: ${label}`);if(!ok)errors++};
  check(Number(process.versions.node.split('.')[0])>=24,'Node.js 24 ou superior');
  for(const key of ['DATABASE_URL','CUSTOMER_APP_URL','MANAGEMENT_APP_URL','INTERNAL_API_URL','CORS_ORIGINS'])check(!!process.env[key]&&!process.env[key].includes('ALTERAR'),key+' configurada');
  for(const key of ['CUSTOMER_APP_URL','MANAGEMENT_APP_URL','INTERNAL_API_URL']){try{const u=new URL(process.env[key]);check(['http:','https:'].includes(u.protocol),key+' é um URL HTTP válido')}catch{check(false,key+' é um URL HTTP válido')}}
  const origins=(process.env.CORS_ORIGINS||'').split(',').map(s=>s.trim());for(const key of ['CUSTOMER_APP_URL','MANAGEMENT_APP_URL']){try{check(origins.includes(new URL(process.env[key]).origin),'CORS inclui '+key)}catch{}}
  check(!process.env.BREVO_API_KEY?.startsWith('xsmtpsib-'),'Brevo usa chave API, não chave SMTP');
  if(!process.env.SMTP_URL&&!(process.env.BREVO_API_KEY&&process.env.MAIL_FROM))console.log('AVISO: configure Brevo/SMTP antes de ativar registos e recuperação em produção.');
  if(!process.env.SUPABASE_URL&&!process.env.S3_BUCKET)console.log('AVISO: imagens em disco; o alojamento precisa de volume persistente.');
  if(process.env.SUPABASE_URL)check(!!process.env.SUPABASE_SERVICE_ROLE_KEY,'Storage Supabase tem chave de servidor');
  if(process.env.S3_BUCKET)check(!!(process.env.AWS_ACCESS_KEY_ID&&process.env.AWS_SECRET_ACCESS_KEY),'S3/R2 tem credenciais');
  if(mode==='doctor'&&!errors){const pool=new pg.Pool(connectionOptions());try{const r=await pool.query('SELECT current_schema() schema,version() version');console.log('OK: PostgreSQL acessível; esquema '+r.rows[0].schema);const m=await pool.query('SELECT count(*)::int n FROM schema_migrations');console.log('OK: '+m.rows[0].n+' migrações aplicadas');}finally{await pool.end()}}
  process.exitCode=errors?1:0;
 }else if(mode==='build'){
  loadInstallEnv();if(!process.env.npm_execpath)throw new Error('Execute npm run build:install.');const result=spawnSync(process.execPath,[process.env.npm_execpath,'run','build'],{env:process.env,stdio:'inherit'});process.exitCode=result.status||0;
 }else if(mode==='migrate'){
  loadInstallEnv();if(process.env.DATABASE_MIGRATION_URL)process.env.DATABASE_URL=process.env.DATABASE_MIGRATION_URL;
  connectionOptions();const r=spawnSync(process.execPath,[resolve('node_modules/tsx/dist/cli.mjs'),resolve('services/api/scripts/migrate.ts')],{env:process.env,stdio:'inherit'});if(r.status!==0)throw new Error('Migração falhou. Confirme ligação direta/session e permissões.');console.log('Migrações concluídas.');
 }else console.log('Comandos: npm run install:init | install:check | install:doctor | db:migrate | db:bootstrap');
}catch{if(mode==='init'&&existsSync('.env.install'))console.error('.env.install já existe e foi preservado. Edite-o e execute install:check.');else console.error('Não foi possível concluir '+mode+'. Confirme .env.install, rede, certificado, permissões e as instruções do manual. Nenhum segredo foi mostrado.');process.exitCode=1;}
