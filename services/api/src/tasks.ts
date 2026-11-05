import type {FastifyInstance} from 'fastify';
import {requireMember} from './auth.js';
import {db} from './db-port.js';
import {changeTask,listTasks} from '../../../packages/backend/services/tasks.js';

// Business rules live in packages/backend/services/tasks.ts and are shared with the Cloudflare Worker.
export async function taskRoutes(app:FastifyInstance){
 app.get('/api/v1/manage/businesses/:id/tasks',async req=>{
  const {id}=req.params as any,access=await requireMember(req,id);
  return listTasks(db,id,{userId:req.user!.id,role:access.role});
 });
 for(const method of ['POST','PATCH','DELETE'] as const)app.route({method,url:'/api/v1/manage/businesses/:id/tasks'+(method==='POST'?'':'/:taskId'),handler:async req=>{
  const {id,taskId}=req.params as any,access=await requireMember(req,id);
  return changeTask(db,{method,businessId:id,taskId,body:(req.body||{}) as any,actor:{userId:req.user!.id,role:access.role}});
 }});
}
