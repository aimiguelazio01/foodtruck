import type {FastifyInstance} from 'fastify';
import {randomUUID} from 'node:crypto';
import {pool} from './db.js';
import {requireMember} from './auth.js';
import {notify} from './orders.js';
const fail=(message:string,statusCode=400):never=>{throw Object.assign(new Error(message),{statusCode});};
export async function taskRoutes(app:FastifyInstance){
 app.get('/api/v1/manage/businesses/:id/tasks',async req=>{const {id}=req.params as any,access=await requireMember(req,id);const all=access.role!=='staff';const tasks=(await pool.query('SELECT t.*,u.email assigned_email FROM tasks t LEFT JOIN users u ON u.id=t.assigned_to WHERE t.business_id=$1 AND ($2 OR t.assigned_to IS NULL OR t.assigned_to=$3) ORDER BY t.done,t.due_at NULLS LAST,t.created_at DESC',[id,all,req.user!.id])).rows;const assignees=(await pool.query('SELECT u.id,u.email FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.business_id=$1 AND ($2 OR u.id=$3) ORDER BY u.email',[id,all,req.user!.id])).rows;return {tasks,assignees,canManageAll:all};});
 for(const method of ['POST','PATCH','DELETE'] as const)app.route({method,url:'/api/v1/manage/businesses/:id/tasks'+(method==='POST'?'':'/:taskId'),handler:async req=>{
  const {id,taskId}=req.params as any,access=await requireMember(req,id),b=(req.body||{}) as any,c=await pool.connect();const all=access.role!=='staff';
  try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[id]);if((await c.query('SELECT 1 FROM organization_trucks WHERE business_id=$1 AND archived',[id])).rowCount)fail('Reative o negócio antes de alterar tarefas.',409);
   let current:any=null;if(method!=='POST'){current=(await c.query('SELECT * FROM tasks WHERE id=$1 AND business_id=$2 FOR UPDATE',[taskId,id])).rows[0];if(!current)fail('Tarefa não encontrada.',404);if(!all&&current.assigned_to&&current.assigned_to!==req.user!.id)fail('Sem acesso a esta tarefa.',403);if(!Number.isSafeInteger(b.version)||b.version!==current.version)fail('A tarefa foi alterada. Atualize a lista e tente novamente.',409);}
   const rowId=taskId||randomUUID();
   if(method==='DELETE')await c.query('DELETE FROM tasks WHERE id=$1',[rowId]);else{
    const title=b.title??current?.title,description=b.description??current?.description??'',priority=b.priority??current?.priority??'normal',status=b.status??current?.status??'pending',assigned=b.assigned_to===undefined?(current?.assigned_to??(all?null:req.user!.id)):b.assigned_to,due=b.due_at===undefined?(current?.due_at??null):b.due_at;
    if(typeof title!=='string'||!title.trim()||title.length>200||typeof description!=='string'||description.length>3000||!['low','normal','high'].includes(priority)||!['pending','in_progress','done'].includes(status)||due!==null&&(!Number.isSafeInteger(Number(due))||Number(due)<0))fail('Verifique o título, a descrição e o prazo.');
    if(!all&&assigned!==req.user!.id&&assigned!==current?.assigned_to)fail('Só pode atribuir tarefas a si próprio.',403);
    if(assigned!==null){if(typeof assigned!=='string'||!(await c.query('SELECT 1 FROM memberships WHERE user_id=$1 AND business_id=$2',[assigned,id])).rowCount)fail('O responsável não pertence a este negócio.');}
    if(method==='POST')await c.query('INSERT INTO tasks(id,business_id,title,description,priority,status,done,assigned_to,due_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[rowId,id,title.trim(),description,priority,status,status==='done'?1:0,assigned,due]);
    else await c.query('UPDATE tasks SET title=$1,description=$2,priority=$3,status=$4,done=$5,assigned_to=$6,due_at=$7,version=version+1 WHERE id=$8',[title.trim(),description,priority,status,status==='done'?1:0,assigned,due,rowId]);
   }
   await c.query('INSERT INTO audit_events VALUES($1,$2,$3,$4,$5)',[randomUUID(),id,req.user!.id,'task:'+method.toLowerCase()+':'+rowId,Date.now()]);await notify(c,id);await c.query('COMMIT');return {id:rowId,ok:true};
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }});
}
