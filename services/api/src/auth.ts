import {createHash,randomBytes,scryptSync,timingSafeEqual} from "node:crypto";
import type {FastifyRequest} from "fastify";
import {pool} from "./db.js";
export const digest=(value:string)=>createHash("sha256").update(value).digest("hex");
declare module "fastify" { interface FastifyRequest { user: {id:string,email:string}|null } }
export async function authenticate(req:FastifyRequest){req.user=null;const token=req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1]||req.headers.cookie?.match(/(?:^|;\s*)staff_session=([a-f0-9]{64})(?:;|$)/)?.[1];if(token){const result=await pool.query("SELECT u.id,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=$1 AND s.expires>$2",[digest(token),Date.now()]);req.user=result.rows[0]||null;}}
export const capabilities=['menus','inventory','orders','calendar','branding','customers','reports','tasks','schedule'] as const;
export type Capability=typeof capabilities[number];
export function defaultPermissions(role:string):Record<Capability,boolean>{return Object.fromEntries(capabilities.map(k=>[k,role==='staff'?['menus','orders','tasks','schedule'].includes(k):role==='manager'?k!=='branding':true])) as Record<Capability,boolean>;}
export async function accessFor(userId:string,businessId:string){
 const r=await pool.query("SELECT role FROM (SELECT 'owner' AS role,0 AS priority FROM organization_members om JOIN organization_trucks ot ON ot.organization_id=om.organization_id WHERE om.user_id=$1 AND ot.business_id=$2 AND om.role IN ('network_owner','network_admin') UNION ALL SELECT m.role,1 AS priority FROM memberships m WHERE m.user_id=$1 AND m.business_id=$2) access_rows ORDER BY priority LIMIT 1",[userId,businessId]);
 const role=r.rows[0]?.role;if(!role)return null;const isAdmin=['owner','truck_admin'].includes(role);
 const custom=(await pool.query('SELECT permissions FROM membership_permissions WHERE user_id=$1 AND business_id=$2',[userId,businessId])).rows[0]?.permissions;
 // Existing staff can view menus; editing becomes available only through an explicit grant.
 return {role,isAdmin,permissions:isAdmin?defaultPermissions('owner'):custom?Object.fromEntries(capabilities.map(k=>[k,custom[k]===true])):defaultPermissions(role),custom:!!custom};
}
function requiredCapability(req:FastifyRequest):Capability|'admin'|'images'|null{
 const path=req.url.split('?')[0],b=(req.body||{}) as any;
 if(path.includes('/tasks'))return 'tasks';
 if(path.includes('/users'))return 'admin';
 if(path.includes('/operations')){
  const c=path.endsWith('/operations')?b.command:path.split('/').at(-1);
  if(['staff','remove_staff'].includes(c))return 'admin';
  if(['stock','movements'].includes(c))return 'inventory';
  if(['customers','customer_note','customer_delete'].includes(c))return 'customers';
  if(['reports'].includes(c))return 'reports';
  if(['location','delete_location','locations','event_menu','delete_event'].includes(c))return 'calendar';
  if(['task','task_done','tasks','delete_task'].includes(c))return 'tasks';
  if(c==='branding')return 'branding';
  if(['categories','recipes','modifiers','recipe','delete_recipe','category','delete_category','modifier_group','delete_modifier_group','modifier_option','delete_modifier_option','product_details','availability'].includes(c))return 'menus';
  return null;
 }
 if(path.endsWith('/images'))return 'images';
 if(path.includes('/orders'))return 'orders';
 if(path.includes('/products'))return 'menus';
 if(path.includes('/inventory'))return 'inventory';
 if(path.includes('/events')&&path!=='/api/v1/events')return 'calendar';
 if(path.endsWith('/settings'))return 'branding';
 return null;
}
export async function requireAdministrator(req:FastifyRequest,businessId:string){const access=req.user&&await accessFor(req.user.id,businessId);if(!access?.isAdmin)throw Object.assign(new Error('Apenas o administrador pode gerir utilizadores e permissões.'),{statusCode:req.user?403:401});return access;}
export async function requireMember(req:FastifyRequest,businessId:string,roles?:string[]){
 if(!req.user)throw Object.assign(new Error('Autenticação necessária.'),{statusCode:401});const access=await accessFor(req.user.id,businessId);const cap=requiredCapability(req);
 let allowed=!!access;
 if(access&&!access.isAdmin){
  if(cap==='admin')allowed=false;
  else if(cap==='images')allowed=!!(access.permissions.menus||access.permissions.branding)&&(access.custom||access.role!=='staff');
  else if(cap){allowed=access.permissions[cap]===true;if(!access.custom&&access.role==='staff'&&cap==='menus'&&req.method!=='GET')allowed=(req.body as any)?.command==='availability';}
  else if(roles)allowed=roles.includes(access.role);
 }
 if(!allowed)throw Object.assign(new Error('Não tem permissão para esta operação.'),{statusCode:403});return access!;
}
export async function login(email:unknown,password:unknown){if(typeof email!=="string"||email.length>254||typeof password!=="string"||password.length>256)throw Object.assign(new Error("Credenciais inválidas."),{statusCode:400});email=email.trim().toLowerCase();const now=Date.now();const c=await pool.connect();try{await c.query("BEGIN");await c.query("SELECT pg_advisory_xact_lock(hashtext($1))",[email]);const a=(await c.query("SELECT * FROM login_attempts WHERE email=$1",[email])).rows[0];if(a&&Number(a.reset)>now&&a.count>=5){await c.query("COMMIT");throw Object.assign(new Error("Tente novamente dentro de 15 minutos."),{statusCode:429});}await c.query("INSERT INTO login_attempts VALUES($1,1,$2) ON CONFLICT(email) DO UPDATE SET count=CASE WHEN login_attempts.reset<=$3 THEN 1 ELSE login_attempts.count+1 END,reset=CASE WHEN login_attempts.reset<=$3 THEN $2 ELSE login_attempts.reset END",[email,now+900000,now]);const user=(await c.query("SELECT * FROM users WHERE email=$1",[email])).rows[0];const [salt,hash]=(user?.password||`${"0".repeat(32)}:${"0".repeat(128)}`).split(":");const expected=Buffer.from(hash||"","hex"),actual=scryptSync(password,salt,64);if(!user||expected.length!==actual.length||!timingSafeEqual(expected,actual)){await c.query("COMMIT");throw Object.assign(new Error("Credenciais inválidas."),{statusCode:401});}await c.query("DELETE FROM login_attempts WHERE email=$1",[email]);const token=randomBytes(32).toString("hex");await c.query("INSERT INTO sessions VALUES($1,$2,$3)",[digest(token),user.id,now+28800000]);await c.query("COMMIT");return {token,user:{id:user.id,email:user.email}};}catch(e){await c.query("ROLLBACK").catch(()=>{});throw e;}finally{c.release();}}


