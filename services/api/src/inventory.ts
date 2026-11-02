import type {FastifyInstance} from 'fastify';
import type {PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import {pool} from './db.js';
import {requireMember} from './auth.js';
import {notify} from './orders.js';

const fail=(message:string,statusCode=400):never=>{throw Object.assign(new Error(message),{statusCode});};
const integer=(value:unknown,label:string)=>{if(!Number.isSafeInteger(value)||Number(value)<0||Number(value)>2147483647)fail(label+' deve ser um número inteiro positivo ou zero.');return Number(value);};
const text=(value:unknown,label:string,max:number,optional=false)=>{if(typeof value!=='string'||value.length>max||!optional&&!value.trim())fail('Verifique '+label+'.');return (value as string).trim();};
async function links(c:PoolClient,id:string){
 const r=await c.query(`SELECT
 (SELECT count(*)::int FROM recipes WHERE inventory_id=$1) recipes,
 (SELECT count(*)::int FROM product_details WHERE extra_inventory_id=$1) extras,
 (SELECT count(*)::int FROM modifier_options WHERE inventory_id=$1) modifiers,
 (SELECT count(*)::int FROM network_transfer_items ti JOIN network_transfers t ON t.id=ti.transfer_id WHERE (ti.source_inventory_id=$1 OR ti.destination_inventory_id=$1) AND t.status IN ('draft','dispatched')) transfers`,[id]);
 return r.rows[0];
}
export async function inventoryRoutes(app:FastifyInstance){
 app.get('/api/v1/manage/businesses/:id/inventory',async req=>{
  const {id}=req.params as any;await requireMember(req,id);
  const removed=(req.query as any)?.removed==='1';
  return {inventory:(await pool.query(`SELECT i.*,
   (SELECT count(*)::int FROM recipes r WHERE r.inventory_id=i.id) recipe_count
   FROM inventory i WHERE i.business_id=$1 AND (i.deleted_at IS NOT NULL)=$2 ORDER BY lower(i.name),i.id`,[id,removed])).rows};
 });
 app.get('/api/v1/manage/businesses/:id/inventory/:itemId/movements',async req=>{
  const {id,itemId}=req.params as any;await requireMember(req,id);
  if(!(await pool.query('SELECT 1 FROM inventory WHERE id=$1 AND business_id=$2',[itemId,id])).rowCount)fail('Ingrediente não encontrado.',404);
  return {movements:(await pool.query('SELECT id,delta,reason,created_at FROM stock_movements WHERE inventory_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100',[itemId])).rows};
 });
 for(const action of ['create','edit','remove','restore','stock'] as const){
  const method=action==='edit'?'PATCH':action==='remove'?'DELETE':'POST';
  const suffix=action==='create'?'':'/:itemId'+(['restore','stock'].includes(action)?'/'+action:'');
  app.route({method,url:'/api/v1/manage/businesses/:id/inventory'+suffix,handler:async req=>{
   const {id,itemId}=req.params as any;await requireMember(req,id);const b=(req.body||{}) as any,c=await pool.connect();
   try{
    await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[id]);
    if((await c.query('SELECT 1 FROM organization_trucks WHERE business_id=$1 AND archived',[id])).rowCount)fail('Reative o negócio antes de alterar o inventário.',409);
    const current=action==='create'?null:(await c.query('SELECT * FROM inventory WHERE id=$1 AND business_id=$2 FOR UPDATE',[itemId,id])).rows[0];
    if(action!=='create'&&!current)fail('Ingrediente não encontrado.',404);
    if(current&&b.version!==current.version)fail('O ingrediente ou o stock foi alterado. Atualize a lista e volte a abrir o formulário.',409);
    if(current?.deleted_at&&action!=='restore')fail('Restaure o ingrediente antes de o alterar.',409);
    const entityId=itemId||randomUUID();
    if(action==='remove'){
     if(current.reserved>0||(await c.query("SELECT 1 FROM reservations WHERE inventory_id=$1 AND state='reserved'",[itemId])).rowCount)fail('Existem quantidades reservadas para encomendas. Aguarde a sua conclusão ou cancele as encomendas.',409);
     const refs=await links(c,itemId);
     if(refs.recipes||refs.extras||refs.modifiers)fail('Este ingrediente está associado a receitas ou extras. Remova essas associações em Operações antes de o remover.',409);
     if(refs.transfers)fail('Conclua ou cancele as transferências deste ingrediente antes de o remover.',409);
     if(current.quantity!==0)fail('O ingrediente ainda tem stock. Registe a saída ou uma correção antes de o remover.',409);
     await c.query('UPDATE inventory SET deleted_at=$1 WHERE id=$2',[Date.now(),itemId]);
    }else if(action==='restore'){
     if(!current.deleted_at)fail('O ingrediente já está ativo.',409);
     await c.query('UPDATE inventory SET deleted_at=NULL WHERE id=$1',[itemId]);
    }else if(action==='stock'){
     const amount=integer(b.quantity,'A quantidade');if(amount===0)fail('Indique uma quantidade superior a zero.');
     if(!['restock','waste','adjustment'].includes(b.reason))fail('Escolha um motivo para o movimento.');
     if(b.reason==='adjustment'&&!['in','out'].includes(b.direction))fail('Escolha entrada ou saída.');
     const delta=b.reason==='waste'||b.reason==='adjustment'&&b.direction==='out'?-amount:amount;
     const updated=await c.query('UPDATE inventory SET quantity=quantity+$1 WHERE id=$2 AND quantity::bigint+$1>=reserved AND quantity::bigint+$1<=2147483647 RETURNING id',[delta,itemId]);
     if(!updated.rowCount)fail('A saída excede o stock disponível. As quantidades reservadas não podem ser retiradas.',409);
     await c.query('INSERT INTO stock_movements(id,inventory_id,delta,reason,created_at) VALUES($1,$2,$3,$4,$5)',[randomUUID(),itemId,delta,b.reason,Date.now()]);
    }else{
     if(action==='edit'&&('quantity' in b||'reserved' in b))fail('Use Registar movimento para alterar o stock.');
     const name=text(b.name??current?.name,'o nome',100),unit=text(b.unit??current?.unit??'un','a unidade',20);
     const supplier=text(b.supplier??current?.supplier??'','o fornecedor',200,true);
     const minimum=integer(b.minimum??current?.minimum??0,'O stock mínimo');
     const duplicate=await c.query('SELECT id,deleted_at FROM inventory WHERE business_id=$1 AND lower(trim(name))=lower($2) AND id<>$3',[id,name,entityId]);
     if(duplicate.rowCount)fail(duplicate.rows[0].deleted_at?'Já existe um ingrediente removido com esse nome. Restaure-o na lista de removidos.':'Já existe um ingrediente com esse nome.',409);
     if(action==='edit'&&unit!==current.unit){
      const refs=await links(c,itemId);
      if(current.quantity||current.reserved||refs.recipes||refs.extras||refs.modifiers||refs.transfers||(await c.query('SELECT 1 FROM stock_movements WHERE inventory_id=$1 LIMIT 1',[itemId])).rowCount)fail('A unidade não pode mudar num ingrediente com stock, histórico ou associações. Crie outro ingrediente com a unidade correta.',409);
     }
     if(action==='create'){
      const quantity=integer(b.quantity??0,'A quantidade inicial');
      await c.query('INSERT INTO inventory(id,business_id,name,unit,quantity,minimum,supplier) VALUES($1,$2,$3,$4,$5,$6,$7)',[entityId,id,name,unit,quantity,minimum,supplier]);
      if(quantity)await c.query("INSERT INTO stock_movements(id,inventory_id,delta,reason,created_at) VALUES($1,$2,$3,'restock',$4)",[randomUUID(),entityId,quantity,Date.now()]);
     }else await c.query('UPDATE inventory SET name=$1,unit=$2,minimum=$3,supplier=$4 WHERE id=$5',[name,unit,minimum,supplier,itemId]);
    }
    await c.query('INSERT INTO audit_events VALUES($1,$2,$3,$4,$5)',[randomUUID(),id,req.user!.id,'inventory:'+action+':'+entityId,Date.now()]);
    await notify(c,id);await c.query('COMMIT');return {ok:true,id:entityId};
   }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }});
 }
}
