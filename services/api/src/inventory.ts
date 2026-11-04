import type {FastifyInstance} from 'fastify';
import {requireMember} from './auth.js';
import {db} from './db-port.js';
import {changeInventory,listInventory,listMovements,type InventoryAction} from '../../../packages/backend/services/inventory.js';

// Business rules live in packages/backend/services/inventory.ts and are shared with the Cloudflare Worker.
export async function inventoryRoutes(app:FastifyInstance){
 app.get('/api/v1/manage/businesses/:id/inventory',async req=>{
  const {id}=req.params as any;await requireMember(req,id);
  return {inventory:await listInventory(db,id,(req.query as any)?.removed==='1')};
 });
 app.get('/api/v1/manage/businesses/:id/inventory/:itemId/movements',async req=>{
  const {id,itemId}=req.params as any;await requireMember(req,id);
  return {movements:await listMovements(db,id,itemId)};
 });
 for(const action of ['create','edit','remove','restore','stock'] as InventoryAction[]){
  const method=action==='edit'?'PATCH':action==='remove'?'DELETE':'POST';
  const suffix=action==='create'?'':'/:itemId'+(['restore','stock'].includes(action)?'/'+action:'');
  app.route({method,url:'/api/v1/manage/businesses/:id/inventory'+suffix,handler:async req=>{
   const {id,itemId}=req.params as any;await requireMember(req,id);
   return changeInventory(db,{action,businessId:id,itemId,body:(req.body||{}) as Record<string,unknown>,userId:req.user!.id});
  }});
 }
}
