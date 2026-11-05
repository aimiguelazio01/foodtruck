import assert from 'node:assert/strict';
import {HttpError,newId,type Db} from '../db/port.js';
import {accessFor} from '../auth/access.js';
import {changeTask,listTasks} from '../services/tasks.js';
import {createUser,listUsers,updatePermissions} from '../services/users.js';
import type {Scenario} from './inventory.scenarios.js';

const status=async(promise:Promise<unknown>)=>promise.then(()=>200,(error:unknown)=>error instanceof HttpError?error.statusCode:(()=>{throw error;})());
const count=async(db:Db,sql:string,params:any[])=>Number((await db.first<any>(sql,params))!.n);
const hashPassword=async(password:string)=>'test-hash:'+password.length;

async function setup(db:Db){
 const id='p'+newId().slice(0,8),owner='o'+id,manager='m'+id,staff='s'+id,other='x'+id;
 await db.batch([
  {sql:'INSERT INTO businesses(id,slug,name,color) VALUES(?,?,?,?)',params:[id,id,'Truck '+id,'#112233']},
  ...[[owner,'owner'],[manager,'manager'],[staff,'staff'],[other,'staff']].flatMap(([user,role])=>[
   {sql:'INSERT INTO users(id,email,password) VALUES(?,?,?)',params:[user!,user+'@example.test','x']},
   ...(user===other?[]:[{sql:'INSERT INTO memberships(user_id,business_id,role) VALUES(?,?,?)',params:[user!,id,role!]}]),
  ]),
 ]);
 return {id,owner,manager,staff,other};
}
const task=(db:Db,method:any,businessId:string,userId:string,role:string,body:any,taskId?:string)=>
 changeTask(db,{method,businessId,taskId,body,actor:{userId,role}});

export const peopleScenarios:Scenario[]=[
 {name:'tasks: managers manage all tasks, staff only their own and unassigned ones',run:async db=>{
  const t=await setup(db);
  const open=await task(db,'POST',t.id,t.manager,'manager',{title:'Limpar grelhador'});
  const mine=await task(db,'POST',t.id,t.staff,'staff',{title:'Preparar molhos'});
  const theirs=await task(db,'POST',t.id,t.manager,'manager',{title:'Contar caixa',assigned_to:t.owner});
  assert.equal((await db.first<any>('SELECT assigned_to FROM tasks WHERE id=?',[mine.id]))!.assigned_to,t.staff,'staff tasks default to themselves');
  const staffView=await listTasks(db,t.id,{userId:t.staff,role:'staff'}) as any;
  assert.deepEqual(staffView.tasks.map((x:any)=>x.id).sort(),[open.id,mine.id].sort());
  assert.equal(staffView.canManageAll,false);assert.deepEqual(staffView.assignees.map((x:any)=>x.id),[t.staff]);
  const managerView=await listTasks(db,t.id,{userId:t.manager,role:'manager'}) as any;
  assert.equal(managerView.tasks.length,3);assert.equal(managerView.canManageAll,true);assert.equal(managerView.assignees.length,3);
  assert.equal(await status(task(db,'PATCH',t.id,t.staff,'staff',{title:'x',version:1},theirs.id)),403,'staff cannot touch others');
  assert.equal(await status(task(db,'POST',t.id,t.staff,'staff',{title:'Para outro',assigned_to:t.manager})),403,'staff can only self-assign');
  assert.equal(await status(task(db,'POST',t.id,t.manager,'manager',{title:'Fora',assigned_to:t.other})),400,'assignee must belong to the business');
 }},
 {name:'tasks: validation, status transitions, versions and deletion',run:async db=>{
  const t=await setup(db);
  assert.equal(await status(task(db,'POST',t.id,t.manager,'manager',{title:''})),400);
  assert.equal(await status(task(db,'POST',t.id,t.manager,'manager',{title:'x',priority:'urgent'})),400);
  assert.equal(await status(task(db,'POST',t.id,t.manager,'manager',{title:'x',status:'blocked'})),400);
  assert.equal(await status(task(db,'POST',t.id,t.manager,'manager',{title:'x',due_at:-5})),400);
  assert.equal(await count(db,'SELECT count(*) AS n FROM tasks WHERE business_id=?',[t.id]),0);
  const {id}=await task(db,'POST',t.id,t.manager,'manager',{title:'Fechar',priority:'high',due_at:Date.now()+1000});
  assert.equal(await status(task(db,'PATCH',t.id,t.manager,'manager',{status:'done'},id)),409,'version is required');
  assert.equal(await status(task(db,'PATCH',t.id,t.manager,'manager',{status:'done',version:99},id)),409);
  await task(db,'PATCH',t.id,t.manager,'manager',{status:'done',version:1},id);
  const done=(await db.first<any>('SELECT status,done,version,title FROM tasks WHERE id=?',[id]))!;
  assert.deepEqual({...done},{status:'done',done:1,version:2,title:'Fechar'});
  assert.equal(await status(task(db,'PATCH',t.id,t.manager,'manager',{status:'pending',version:1},id)),409,'stale');
  assert.equal(await status(task(db,'PATCH',t.id,t.manager,'manager',{title:'x',version:2},'missing')),404);
  assert.equal(await status(task(db,'DELETE',t.id,t.manager,'manager',{version:1},id)),409);
  await task(db,'DELETE',t.id,t.manager,'manager',{version:2},id);
  assert.equal(await count(db,'SELECT count(*) AS n FROM tasks WHERE id=?',[id]),0);
  assert.equal(await count(db,"SELECT count(*) AS n FROM audit_events WHERE business_id=? AND action LIKE 'task:%'",[t.id]),3);
 }},
 {name:'tasks: simultaneous updates with one version apply once; archived trucks are read-only',run:async db=>{
  const t=await setup(db);
  const {id}=await task(db,'POST',t.id,t.manager,'manager',{title:'Disputada'});
  const results=await Promise.all([1,2,3,4].map(n=>status(task(db,'PATCH',t.id,t.manager,'manager',{title:'Versão '+n,version:1},id))));
  assert.equal(results.filter(code=>code===200).length,1,JSON.stringify(results));
  assert.equal((await db.first<any>('SELECT version FROM tasks WHERE id=?',[id]))!.version,2);
  await db.batch([
   {sql:'INSERT INTO organizations(id,name) VALUES(?,?)',params:['o'+t.id,'Org']},
   {sql:'INSERT INTO organization_trucks(organization_id,business_id,archived) VALUES(?,?,true)',params:['o'+t.id,t.id]},
  ]);
  assert.equal(await status(task(db,'POST',t.id,t.manager,'manager',{title:'Nova'})),409);
 }},
 {name:'users: creation hashes through the injected hasher and stores explicit permissions',run:async db=>{
  const t=await setup(db);
  const initialMembers=await count(db,'SELECT count(*) AS n FROM memberships WHERE business_id=?',[t.id]);
  const body={email:' New.User@Example.test ',password:'a-long-enough-pass',role:'staff',permissions:{menus:true,inventory:true}};
  const {id}=await createUser(db,{businessId:t.id,body,actorId:t.owner,hashPassword});
  const user=(await db.first<any>('SELECT email,password FROM users WHERE id=?',[id]))!;
  assert.deepEqual({...user},{email:'new.user@example.test',password:'test-hash:18'});
  const access=(await accessFor(db,id,t.id))!;
  assert.equal(access.custom,true);assert.equal(access.role,'staff');assert.equal(access.isAdmin,false);
  assert.equal(access.permissions.inventory,true);assert.equal(access.permissions.orders,false,'unspecified capabilities are off');
  assert.equal(await count(db,'SELECT count(*) AS n FROM memberships WHERE business_id=?',[t.id]),initialMembers+1,'creation adds one membership');
  assert.equal(await status(createUser(db,{businessId:t.id,body,actorId:t.owner,hashPassword})),409,'email already exists');
  assert.equal(await count(db,'SELECT count(*) AS n FROM memberships WHERE business_id=?',[t.id]),initialMembers+1,'failed duplicate left no membership');
  for(const bad of [{...body,email:'nope'},{...body,email:'a@b.test',password:'short'},{...body,email:'a@b.test',role:'owner'},{...body,email:'a@b.test',permissions:{menus:'yes'}},{...body,email:'a@b.test',permissions:{admin:true}}]){
   assert.equal(await status(createUser(db,{businessId:t.id,body:bad,actorId:t.owner,hashPassword})),400);
  }
  const listed=await listUsers(db,t.id) as any;
  assert.equal(listed.users.length,initialMembers+1);assert.ok(listed.users.every((u:any)=>typeof u.isAdmin==='boolean'&&u.permissions));
 }},
 {name:'users: permission updates, administrator protection and default role access',run:async db=>{
  const t=await setup(db);
  assert.equal((await accessFor(db,t.staff,t.id))!.custom,false);
  assert.equal((await accessFor(db,t.staff,t.id))!.permissions.menus,true);
  assert.equal((await accessFor(db,t.staff,t.id))!.permissions.inventory,false);
  assert.equal((await accessFor(db,t.manager,t.id))!.permissions.branding,false);
  assert.equal(await accessFor(db,t.other,t.id),null);
  await updatePermissions(db,{businessId:t.id,userId:t.staff,body:{permissions:{inventory:true}},actorId:t.owner});
  const updated=(await accessFor(db,t.staff,t.id))!;
  assert.equal(updated.custom,true);assert.equal(updated.permissions.inventory,true);assert.equal(updated.permissions.menus,false);
  await updatePermissions(db,{businessId:t.id,userId:t.staff,body:{permissions:{orders:true}},actorId:t.owner});
  assert.equal((await accessFor(db,t.staff,t.id))!.permissions.inventory,false,'a new grant replaces the previous one');
  assert.equal(await count(db,'SELECT count(*) AS n FROM membership_permissions WHERE user_id=?',[t.staff]),1);
  assert.equal(await status(updatePermissions(db,{businessId:t.id,userId:t.owner,body:{permissions:{menus:false}},actorId:t.owner})),403,'owner keeps full control');
  assert.equal(await status(updatePermissions(db,{businessId:t.id,userId:t.other,body:{permissions:{menus:true}},actorId:t.owner})),404);
  assert.equal(await status(updatePermissions(db,{businessId:t.id,userId:t.staff,body:{permissions:{menus:1}},actorId:t.owner})),400);
  assert.equal(await status(updatePermissions(db,{businessId:t.id,userId:t.staff,body:{permissions:[]},actorId:t.owner})),400);
 }},
];
