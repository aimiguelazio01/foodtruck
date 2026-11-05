import {WriteConflict,audit,changed,fail,newId,type Db,type Param,type Statement} from '../db/port.js';

export interface TaskActor{userId:string;role:string}
const sees=(actor:TaskActor)=>actor.role!=='staff';

export async function listTasks(db:Db,businessId:string,actor:TaskActor){
 const all=sees(actor)?1:0;
 const tasks=await db.all(`SELECT t.*,u.email AS assigned_email FROM tasks t LEFT JOIN users u ON u.id=t.assigned_to
  WHERE t.business_id=? AND (?=1 OR t.assigned_to IS NULL OR t.assigned_to=?)
  ORDER BY t.done,t.due_at NULLS LAST,t.created_at DESC`,[businessId,all,actor.userId]);
 const assignees=await db.all(`SELECT u.id,u.email FROM memberships m JOIN users u ON u.id=m.user_id
  WHERE m.business_id=? AND (?=1 OR u.id=?) ORDER BY u.email`,[businessId,all,actor.userId]);
 return {tasks,assignees,canManageAll:sees(actor)};
}

interface TaskRow{id:string;title:string;description:string;priority:string;status:string;assigned_to:string|null;due_at:number|null;version:number}

export async function changeTask(db:Db,{method,businessId,taskId,body,actor}:{method:'POST'|'PATCH'|'DELETE';businessId:string;taskId?:string;body:Record<string,any>;actor:TaskActor}):Promise<{id:string;ok:true}>{
 const b=body||{},all=sees(actor);
 if(await db.first('SELECT 1 AS ok FROM organization_trucks WHERE business_id=? AND archived',[businessId]))fail('Reative o negócio antes de alterar tarefas.',409);
 let current:TaskRow|null=null;
 if(method!=='POST'){
  current=await db.first<TaskRow>('SELECT * FROM tasks WHERE id=? AND business_id=?',[taskId??'',businessId]);
  if(!current)fail('Tarefa não encontrada.',404);
  if(!all&&current!.assigned_to&&current!.assigned_to!==actor.userId)fail('Sem acesso a esta tarefa.',403);
  if(!Number.isSafeInteger(b.version)||b.version!==current!.version)fail('A tarefa foi alterada. Atualize a lista e tente novamente.',409);
 }
 const rowId=taskId||newId(),now=Date.now();
 const notArchived='NOT EXISTS (SELECT 1 FROM organization_trucks WHERE business_id=? AND archived)';
 const write:Statement[]=[];
 if(method==='DELETE'){
  write.push({sql:`DELETE FROM tasks WHERE id=? AND business_id=? AND version=? AND ${notArchived}`,params:[rowId,businessId,current!.version,businessId],expectChanges:1});
 }else{
  const title=b.title??current?.title,description=b.description??current?.description??'',priority=b.priority??current?.priority??'normal',status=b.status??current?.status??'pending';
  const assigned=b.assigned_to===undefined?(current?.assigned_to??(all?null:actor.userId)):b.assigned_to,due=b.due_at===undefined?(current?.due_at??null):b.due_at;
  if(typeof title!=='string'||!title.trim()||title.length>200||typeof description!=='string'||description.length>3000||!['low','normal','high'].includes(priority)||!['pending','in_progress','done'].includes(status)||due!==null&&(!Number.isSafeInteger(Number(due))||Number(due)<0))fail('Verifique o título, a descrição e o prazo.');
  if(!all&&assigned!==actor.userId&&assigned!==current?.assigned_to)fail('Só pode atribuir tarefas a si próprio.',403);
  if(assigned!==null&&(typeof assigned!=='string'||!await db.first('SELECT 1 AS ok FROM memberships WHERE user_id=? AND business_id=?',[assigned,businessId])))fail('O responsável não pertence a este negócio.');
  const member=assigned===null?'':' AND EXISTS (SELECT 1 FROM memberships WHERE user_id=? AND business_id=?)';
  const memberParams:Param[]=assigned===null?[]:[assigned,businessId];
  const done=status==='done'?1:0,dueValue=due===null?null:Number(due);
  if(method==='POST'){
   write.push({sql:`INSERT INTO tasks(id,business_id,title,description,priority,status,done,assigned_to,due_at)
    SELECT ?,?,CAST(? AS text),CAST(? AS text),CAST(? AS text),CAST(? AS text),CAST(? AS integer),CAST(? AS text),CAST(? AS bigint)
    WHERE ${notArchived}${member}`,
    params:[rowId,businessId,title.trim(),description,priority,status,done,assigned,dueValue,businessId,...memberParams],expectChanges:1});
  }else{
   write.push({sql:`UPDATE tasks SET title=?,description=?,priority=?,status=?,done=?,assigned_to=?,due_at=?,version=version+1
    WHERE id=? AND business_id=? AND version=? AND ${notArchived}${member}`,
    params:[title.trim(),description,priority,status,done,assigned,dueValue,rowId,businessId,current!.version,businessId,...memberParams],expectChanges:1});
  }
 }
 write.push(audit(businessId,actor.userId,'task:'+method.toLowerCase()+':'+rowId,now),changed(businessId,now));
 try{await db.batch(write);}
 catch(error){
  if(error instanceof WriteConflict)fail('A tarefa foi alterada. Atualize a lista e tente novamente.',409);
  throw error;
 }
 return {id:rowId,ok:true};
}
