import {randomBytes,randomUUID,scryptSync,timingSafeEqual} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import {pool} from './db.js';
import {tick} from './maintenance.js';
export const isDemo=()=>process.env.DEMO_MODE==='1';
export const isDemoReadOnly=()=>isDemo()&&process.env.DEMO_READ_ONLY==='1';
export function matchesSecret(actual:unknown,expected:string|undefined){
 if(typeof actual!=='string'||!expected||expected.length<32)return false;
 const a=Buffer.from(actual),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b);
}
export async function installationReady(){return !!(await pool.query('SELECT 1 FROM installation_state WHERE id=1 UNION ALL SELECT 1 FROM users UNION ALL SELECT 1 FROM organizations UNION ALL SELECT 1 FROM businesses LIMIT 1')).rowCount;}
export async function installationRoutes(app:FastifyInstance){
 app.get('/api/v1/installation/status',async(_req,reply)=>{
  reply.header('Cache-Control','no-store');return {configured:await installationReady(),demo:isDemo(),readOnly:isDemoReadOnly()};
 });
 app.post('/api/v1/installation/complete',{bodyLimit:4096},async(req,reply)=>{
  if(isDemo())return reply.code(403).send({message:'Demonstração — apenas consulta.'});
  const expires=Date.parse(process.env.INSTALL_TOKEN_EXPIRES_AT||'');
  if(!Number.isFinite(expires)||expires<=Date.now()||!matchesSecret(req.headers['x-install-token'],process.env.INSTALL_TOKEN))return reply.code(403).send({message:'Ligação de configuração inválida ou expirada. Gere uma nova no terminal.'});
  const b=req.body as any;
  if(!b||typeof b.email!=='string'||b.email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(b.email)||typeof b.password!=='string'||b.password.length<12||b.password.length>256||['organization','business'].some(k=>typeof b[k]!=='string'||!b[k].trim()||b[k].length>100))return reply.code(400).send({message:'Preencha nomes, email válido e palavra-passe entre 12 e 256 caracteres.'});
  const c=await pool.connect();
  try{
   await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(81293474)');
   if((await c.query('SELECT 1 FROM installation_state UNION ALL SELECT 1 FROM users UNION ALL SELECT 1 FROM organizations UNION ALL SELECT 1 FROM businesses LIMIT 1')).rowCount){await c.query('ROLLBACK');return reply.code(409).send({message:'O sistema já está configurado. Entre com a sua conta.'});}
   const user=randomUUID(),org=randomUUID(),business=randomUUID(),salt=randomBytes(16).toString('hex');
   await c.query('INSERT INTO users(id,email,password) VALUES($1,$2,$3)',[user,b.email.trim().toLowerCase(),salt+':'+scryptSync(b.password,salt,64).toString('hex')]);
   await c.query('INSERT INTO organizations(id,name) VALUES($1,$2)',[org,b.organization.trim()]);
   await c.query("INSERT INTO organization_members VALUES($1,$2,'network_owner')",[org,user]);
   await c.query("INSERT INTO businesses(id,slug,name,color) VALUES($1,$2,$3,'#ed8735')",[business,'negocio-'+business.slice(0,8),b.business.trim()]);
   await c.query("INSERT INTO memberships VALUES($1,$2,'owner')",[user,business]);
   await c.query('INSERT INTO organization_trucks(organization_id,business_id) VALUES($1,$2)',[org,business]);
   await c.query('INSERT INTO organization_settings(organization_id,company_name) VALUES($1,$2)',[org,b.organization.trim()]);
   await c.query('INSERT INTO business_settings(business_id) VALUES($1)',[business]);
   await c.query("INSERT INTO installation_state(id,mode) VALUES(1,'system')");await c.query('COMMIT');
   return {ok:true};
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 });
 app.get('/api/v1/internal/maintenance',async(req,reply)=>{
  if(!matchesSecret(req.headers.authorization?.replace(/^Bearer /,''),process.env.CRON_SECRET))return reply.code(401).send({message:'Não autorizado.'});
  reply.header('Cache-Control','no-store');
  try{return await tick();}catch{ return reply.code(503).send({message:'Manutenção falhou. Consulte os registos privados.'});}
 });
 app.post('/api/v1/demo/session',async(_req,reply)=>{
  if(!isDemo())return reply.code(404).send();
  const user=(await pool.query("SELECT u.id,u.email FROM users u JOIN organization_members m ON m.user_id=u.id WHERE m.organization_id='demo-network' AND m.role='network_owner' ORDER BY u.id LIMIT 1")).rows[0];
  if(!user)return reply.code(503).send({message:'Demo ainda não inicializada.'});
  const token=randomBytes(32).toString('hex');const {digest}=await import('./auth.js');
  await pool.query('INSERT INTO sessions VALUES($1,$2,$3)',[digest(token),user.id,Date.now()+28800000]);
  reply.header('Set-Cookie',`staff_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${process.env.COOKIE_SECURE==='0'?'':'; Secure'}`);
  return {user};
 });
}
