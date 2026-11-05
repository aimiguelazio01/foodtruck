import type {FastifyInstance} from 'fastify';
import {requireMember} from './auth.js';
import {db} from './db-port.js';
import {listEvents,saveEvent} from '../../../packages/backend/services/events.js';

// Business rules live in packages/backend/services/events.ts and are shared with the Cloudflare Worker.
export async function eventRoutes(app:FastifyInstance){
 app.get('/api/v1/manage/businesses/:id/events',async req=>{const {id}=req.params as any;await requireMember(req,id);return {events:await listEvents(db,id)};});
 for(const method of ['POST','PATCH'] as const)app.route({method,url:'/api/v1/manage/businesses/:id/events'+(method==='PATCH'?'/:eventId':''),handler:async req=>{
  const {id,eventId}=req.params as any;await requireMember(req,id);
  return saveEvent(db,{method,businessId:id,eventId,body:(req.body||{}) as any,userId:req.user!.id,authorizeTarget:async target=>{await requireMember(req,target);}});
 }});
}
