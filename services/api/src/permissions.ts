import type {FastifyInstance} from 'fastify';
import {randomBytes,scryptSync} from 'node:crypto';
import {requireAdministrator} from './auth.js';
import {db} from './db-port.js';
import {createUser,listUsers,updatePermissions} from '../../../packages/backend/services/users.js';

// Business rules live in packages/backend/services/users.ts and are shared with the Cloudflare Worker.
const hashPassword=async(password:string)=>{const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(password,salt,64).toString('hex');};
export async function permissionRoutes(app:FastifyInstance){
 app.get('/api/v1/manage/businesses/:id/users',async req=>{const {id}=req.params as any;await requireAdministrator(req,id);return listUsers(db,id);});
 app.post('/api/v1/manage/businesses/:id/users',async req=>{
  const {id}=req.params as any;await requireAdministrator(req,id);
  return createUser(db,{businessId:id,body:(req.body||{}) as any,actorId:req.user!.id,hashPassword});
 });
 app.patch('/api/v1/manage/businesses/:id/users/:userId/permissions',async req=>{
  const {id,userId}=req.params as any;await requireAdministrator(req,id);
  return updatePermissions(db,{businessId:id,userId,body:(req.body||{}) as any,actorId:req.user!.id});
 });
}
