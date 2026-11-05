import {WriteConflict,assertThat,audit,changed,fail,newId,type Db} from '../db/port.js';
import {accessFor,capabilities} from '../auth/access.js';

/** Only the known capability keys, each a boolean; anything else is rejected. */
export function grants(value:unknown):Record<string,boolean>{
 const given=value as Record<string,unknown>|null;
 if(!given||typeof given!=='object'||Array.isArray(given)||Object.keys(given).some(k=>!(capabilities as readonly string[]).includes(k)||typeof given[k]!=='boolean'))fail('Permissões inválidas.');
 return Object.fromEntries(capabilities.map(k=>[k,given![k]===true]));
}

export async function listUsers(db:Db,businessId:string){
 const users=await db.all<{id:string;email:string;role:string}>('SELECT u.id,u.email,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.business_id=? ORDER BY u.email',[businessId]);
 return {capabilities,users:await Promise.all(users.map(async user=>({...user,...await accessFor(db,user.id,businessId)})))};
}

/** `hashPassword` is injected because the hashing primitive differs per runtime (scrypt on Node, PBKDF2 on Workers). */
export async function createUser(db:Db,{businessId,body,actorId,hashPassword}:{businessId:string;body:Record<string,any>;actorId:string;hashPassword:(password:string)=>Promise<string>}){
 const b=body||{};
 const email=typeof b.email==='string'?b.email.trim().toLowerCase():'';
 if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||email.length>254||typeof b.password!=='string'||b.password.length<12||b.password.length>256||!['manager','staff'].includes(b.role))fail('Preencha email, função e palavra-passe com pelo menos 12 caracteres.');
 const permissions=grants(b.permissions),id=newId(),now=Date.now();
 try{
  await db.batch([
   {sql:'INSERT INTO users(id,email,password) VALUES(?,?,?)',params:[id,email,await hashPassword(b.password)],expectChanges:1},
   {sql:'INSERT INTO memberships(user_id,business_id,role) VALUES(?,?,?)',params:[id,businessId,b.role]},
   {sql:'INSERT INTO membership_permissions(user_id,business_id,permissions) VALUES(?,?,?)',params:[id,businessId,JSON.stringify(permissions)]},
   audit(businessId,actorId,'user:create:'+id,now),changed(businessId,now),
  ]);
 }catch(error){
  if(error instanceof WriteConflict)fail('Este email já existe. Associe o utilizador existente à carrinha na Rede.',409);
  throw error;
 }
 return {id};
}

export async function updatePermissions(db:Db,{businessId,userId,body,actorId}:{businessId:string;userId:string;body:Record<string,any>;actorId:string}){
 const permissions=grants(body?.permissions);
 if(!await db.first('SELECT 1 AS ok FROM memberships WHERE user_id=? AND business_id=?',[userId,businessId]))fail('Utilizador não encontrado.',404);
 if((await accessFor(db,userId,businessId))?.isAdmin)fail('O administrador mantém controlo total.',403);
 const now=Date.now();
 try{
  await db.batch([
   assertThat("EXISTS (SELECT 1 FROM memberships WHERE user_id=? AND business_id=? AND role NOT IN ('owner','truck_admin'))",[userId,businessId]),
   {sql:`INSERT INTO membership_permissions(user_id,business_id,permissions) VALUES(?,?,?)
    ON CONFLICT(user_id,business_id) DO UPDATE SET permissions=excluded.permissions`,params:[userId,businessId,JSON.stringify(permissions)]},
   audit(businessId,actorId,'permissions:update:'+userId,now),changed(businessId,now),
  ]);
 }catch(error){
  if(error instanceof WriteConflict)fail('Utilizador não encontrado ou função alterada. Atualize e tente novamente.',409);
  throw error;
 }
 return {ok:true};
}
