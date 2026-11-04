import {WriteConflict,audit,changed,fail,newId,type Db,type Statement} from '../db/port.js';

export type InventoryAction='create'|'edit'|'remove'|'restore'|'stock';
export interface InventoryInput{action:InventoryAction;businessId:string;itemId?:string;body:Record<string,unknown>;userId:string}

const integer=(value:unknown,label:string):number=>{if(!Number.isSafeInteger(value)||Number(value)<0||Number(value)>2147483647)fail(label+' deve ser um número inteiro positivo ou zero.');return Number(value);};
const text=(value:unknown,label:string,max:number,optional=false):string=>{if(typeof value!=='string'||value.length>max||!optional&&!value.trim())fail('Verifique '+label+'.');return (value as string).trim();};

/** SQL fragment: no recipe, extra, modifier or open transfer references `inventory.id`. Used inside guarded UPDATEs. */
const unlinked=`NOT EXISTS (SELECT 1 FROM recipes WHERE inventory_id=inventory.id)
 AND NOT EXISTS (SELECT 1 FROM product_details WHERE extra_inventory_id=inventory.id)
 AND NOT EXISTS (SELECT 1 FROM modifier_options WHERE inventory_id=inventory.id)
 AND NOT EXISTS (SELECT 1 FROM network_transfer_items ti JOIN network_transfers t ON t.id=ti.transfer_id
   WHERE (ti.source_inventory_id=inventory.id OR ti.destination_inventory_id=inventory.id) AND t.status IN ('draft','dispatched'))`;

const notArchived=(placeholder='?')=>`NOT EXISTS (SELECT 1 FROM organization_trucks WHERE business_id=${placeholder} AND archived)`;

async function links(db:Db,id:string){
 const row=await db.first<{recipes:number;extras:number;modifiers:number;transfers:number}>(`SELECT
  (SELECT count(*) FROM recipes WHERE inventory_id=?) AS recipes,
  (SELECT count(*) FROM product_details WHERE extra_inventory_id=?) AS extras,
  (SELECT count(*) FROM modifier_options WHERE inventory_id=?) AS modifiers,
  (SELECT count(*) FROM network_transfer_items ti JOIN network_transfers t ON t.id=ti.transfer_id
    WHERE (ti.source_inventory_id=? OR ti.destination_inventory_id=?) AND t.status IN ('draft','dispatched')) AS transfers`,[id,id,id,id,id]);
 return {recipes:Number(row!.recipes),extras:Number(row!.extras),modifiers:Number(row!.modifiers),transfers:Number(row!.transfers)};
}

export async function listInventory(db:Db,businessId:string,removed:boolean){
 return db.all(`SELECT i.*,(SELECT count(*) FROM recipes r WHERE r.inventory_id=i.id) AS recipe_count
  FROM inventory i WHERE i.business_id=? AND CASE WHEN i.deleted_at IS NULL THEN 0 ELSE 1 END=? ORDER BY lower(i.name),i.id`,[businessId,removed?1:0]);
}

export async function listMovements(db:Db,businessId:string,itemId:string){
 if(!await db.first('SELECT 1 AS ok FROM inventory WHERE id=? AND business_id=?',[itemId,businessId]))fail('Ingrediente não encontrado.',404);
 return db.all('SELECT id,delta,reason,created_at FROM stock_movements WHERE inventory_id=? ORDER BY created_at DESC,id DESC LIMIT 100',[itemId]);
}

interface Row{id:string;name:string;unit:string;quantity:number;reserved:number;minimum:number;supplier:string;version:number;deleted_at:number|null}

export async function changeInventory(db:Db,{action,businessId,itemId,body,userId}:InventoryInput):Promise<{ok:true;id:string}>{
 const b=body||{};
 if(await db.first('SELECT 1 AS ok FROM organization_trucks WHERE business_id=? AND archived',[businessId]))fail('Reative o negócio antes de alterar o inventário.',409);
 const current=action==='create'?null:await db.first<Row>('SELECT * FROM inventory WHERE id=? AND business_id=?',[itemId??'',businessId]);
 if(action!=='create'&&!current)fail('Ingrediente não encontrado.',404);
 if(current&&b.version!==current.version)fail('O ingrediente ou o stock foi alterado. Atualize a lista e volte a abrir o formulário.',409);
 if(current?.deleted_at&&action!=='restore')fail('Restaure o ingrediente antes de o alterar.',409);
 const entityId=itemId||newId(),now=Date.now(),write:Statement[]=[];
 const version=current?.version??0;

 if(action==='remove'){
  const item=current!;
  if(item.reserved>0||await db.first("SELECT 1 AS ok FROM reservations WHERE inventory_id=? AND state='reserved'",[itemId!]))fail('Existem quantidades reservadas para encomendas. Aguarde a sua conclusão ou cancele as encomendas.',409);
  const refs=await links(db,itemId!);
  if(refs.recipes||refs.extras||refs.modifiers)fail('Este ingrediente está associado a receitas ou extras. Remova essas associações em Operações antes de o remover.',409);
  if(refs.transfers)fail('Conclua ou cancele as transferências deste ingrediente antes de o remover.',409);
  if(item.quantity!==0)fail('O ingrediente ainda tem stock. Registe a saída ou uma correção antes de o remover.',409);
  write.push({sql:`UPDATE inventory SET deleted_at=? WHERE id=? AND business_id=? AND version=? AND deleted_at IS NULL
   AND quantity=0 AND reserved=0 AND NOT EXISTS (SELECT 1 FROM reservations WHERE inventory_id=inventory.id AND state='reserved')
   AND ${unlinked} AND ${notArchived('inventory.business_id')}`,params:[now,itemId!,businessId,version],expectChanges:1});
 }else if(action==='restore'){
  if(!current!.deleted_at)fail('O ingrediente já está ativo.',409);
  write.push({sql:`UPDATE inventory SET deleted_at=NULL WHERE id=? AND business_id=? AND version=? AND deleted_at IS NOT NULL AND ${notArchived('inventory.business_id')}`,params:[itemId!,businessId,version],expectChanges:1});
 }else if(action==='stock'){
  const amount=integer(b.quantity,'A quantidade');if(amount===0)fail('Indique uma quantidade superior a zero.');
  if(!['restock','waste','adjustment'].includes(b.reason as string))fail('Escolha um motivo para o movimento.');
  if(b.reason==='adjustment'&&!['in','out'].includes(b.direction as string))fail('Escolha entrada ou saída.');
  const delta=b.reason==='waste'||b.reason==='adjustment'&&b.direction==='out'?-amount:amount;
  const next=current!.quantity+delta;
  if(next<current!.reserved||next>2147483647)fail('A saída excede o stock disponível. As quantidades reservadas não podem ser retiradas.',409);
  write.push({sql:`UPDATE inventory SET quantity=quantity+? WHERE id=? AND business_id=? AND version=? AND deleted_at IS NULL
   AND quantity+?>=reserved AND quantity+?<=2147483647 AND ${notArchived('inventory.business_id')}`,params:[delta,itemId!,businessId,version,delta,delta],expectChanges:1});
  write.push({sql:'INSERT INTO stock_movements(id,inventory_id,delta,reason,created_at) VALUES(?,?,?,?,?)',params:[newId(),itemId!,delta,b.reason as string,now]});
 }else{
  if(action==='edit'&&('quantity' in b||'reserved' in b))fail('Use Registar movimento para alterar o stock.');
  const name=text(b.name??current?.name,'o nome',100),unit=text(b.unit??current?.unit??'un','a unidade',20);
  const supplier=text(b.supplier??current?.supplier??'','o fornecedor',200,true);
  const minimum=integer(b.minimum??current?.minimum??0,'O stock mínimo');
  const duplicate=await db.first<{deleted_at:number|null}>('SELECT id,deleted_at FROM inventory WHERE business_id=? AND lower(trim(name))=lower(?) AND id<>?',[businessId,name,entityId]);
  if(duplicate)fail(duplicate.deleted_at?'Já existe um ingrediente removido com esse nome. Restaure-o na lista de removidos.':'Já existe um ingrediente com esse nome.',409);
  if(action==='edit'&&unit!==current!.unit){
   const refs=await links(db,itemId!);
   if(current!.quantity||current!.reserved||refs.recipes||refs.extras||refs.modifiers||refs.transfers||await db.first('SELECT 1 AS ok FROM stock_movements WHERE inventory_id=? LIMIT 1',[itemId!]))fail('A unidade não pode mudar num ingrediente com stock, histórico ou associações. Crie outro ingrediente com a unidade correta.',409);
  }
  if(action==='create'){
   const quantity=integer(b.quantity??0,'A quantidade inicial');
   write.push({sql:`INSERT INTO inventory(id,business_id,name,unit,quantity,minimum,supplier)
    SELECT ?,?,?,?,CAST(? AS integer),CAST(? AS integer),?
    WHERE NOT EXISTS (SELECT 1 FROM inventory WHERE business_id=? AND lower(trim(name))=lower(?)) AND ${notArchived()}`,
    params:[entityId,businessId,name,unit,quantity,minimum,supplier,businessId,name,businessId],expectChanges:1});
   if(quantity)write.push({sql:"INSERT INTO stock_movements(id,inventory_id,delta,reason,created_at) VALUES(?,?,?,'restock',?)",params:[newId(),entityId,quantity,now]});
  }else{
   write.push({sql:`UPDATE inventory SET name=?,unit=?,minimum=?,supplier=? WHERE id=? AND business_id=? AND version=? AND deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM inventory o WHERE o.business_id=inventory.business_id AND lower(trim(o.name))=lower(?) AND o.id<>inventory.id)
    AND (unit=? OR (quantity=0 AND reserved=0 AND ${unlinked} AND NOT EXISTS (SELECT 1 FROM stock_movements WHERE inventory_id=inventory.id)))
    AND ${notArchived('inventory.business_id')}`,
    params:[name,unit,minimum,supplier,itemId!,businessId,version,name,unit],expectChanges:1});
  }
 }
 write.push(audit(businessId,userId,'inventory:'+action+':'+entityId,now),changed(businessId,now));
 try{await db.batch(write);}
 catch(error){
  if(error instanceof WriteConflict)fail('O ingrediente ou o stock foi alterado. Atualize a lista e tente novamente.',409);
  throw error;
 }
 return {ok:true,id:entityId};
}
