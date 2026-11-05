import type {FastifyInstance} from "fastify";
import {requireMember} from "./auth.js";
import {db} from "./db-port.js";
import {createProduct,updateProduct} from "../../../packages/backend/services/products.js";

// Business rules live in packages/backend/services/products.ts and are shared with the Cloudflare Worker.
export async function managementRoutes(app:FastifyInstance){
 app.post("/api/v1/manage/businesses/:id/products",async req=>{
  const {id}=req.params as any;await requireMember(req,id,["owner","truck_admin","manager"]);
  return createProduct(db,{businessId:id,body:(req.body||{}) as any,userId:req.user!.id});
 });
 app.patch("/api/v1/manage/businesses/:id/products/:entityId",async req=>{
  const {id,entityId}=req.params as any;await requireMember(req,id,["owner","truck_admin","manager"]);
  return updateProduct(db,{businessId:id,productId:entityId,body:(req.body||{}) as any,userId:req.user!.id});
 });
}
