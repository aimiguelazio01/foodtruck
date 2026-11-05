import {WriteConflict,audit,changed,fail,newId,type Db,type Param,type Statement} from '../db/port.js';

// Product create/update (name, price, availability and the optional details row).
const columnTypes:Record<string,string>={name:'text',price_cents:'integer',available:'integer'};
const detailKeys=['description','category','allergens','ingredients','tags','image'] as const;

function validate(b:Record<string,any>){
 for(const key of detailKeys){
  const value=b[key];
  if(value===undefined)continue;
  if(typeof value!=='string'||value.length>1000||key==='image'&&value&&!/^\/uploads\/[0-9a-f-]{36}\.webp$/.test(value))fail('Detalhes do produto inválidos.');
 }
 if(b.price_cents!==undefined&&(!Number.isSafeInteger(b.price_cents)||b.price_cents<0||b.price_cents>1000000)
  ||b.available!==undefined&&![0,1].includes(b.available)
  ||b.name!==undefined&&(typeof b.name!=='string'||!b.name.trim()||b.name.length>100))fail('Produto inválido.');
}

const notArchived=`NOT EXISTS (SELECT 1 FROM organization_trucks WHERE business_id=? AND archived)`;

function details(productId:string,b:Record<string,any>):Statement[]{
 const keys=detailKeys.filter(key=>b[key]!==undefined);
 const out:Statement[]=[{sql:'INSERT INTO product_details(product_id) VALUES(?) ON CONFLICT DO NOTHING',params:[productId]}];
 if(keys.length)out.push({sql:`UPDATE product_details SET ${keys.map(key=>key+'=?').join(',')} WHERE product_id=?`,params:[...keys.map(key=>b[key] as Param),productId]});
 return out;
}

async function run(db:Db,statements:Statement[]){
 try{await db.batch(statements);}
 catch(error){
  if(error instanceof WriteConflict)fail('O produto foi alterado ou o negócio mudou de estado. Atualize e tente novamente.',409);
  throw error;
 }
}

export async function createProduct(db:Db,{businessId,body,userId}:{businessId:string;body:Record<string,any>;userId:string}){
 const b=body||{},names=Object.keys(columnTypes).filter(key=>b[key]!==undefined);
 if(!names.includes('name'))fail('Missing name');
 if(await db.first('SELECT 1 AS ok FROM organization_trucks WHERE business_id=? AND archived',[businessId]))fail('Truck is archived',409);
 validate(b);
 const id=newId(),now=Date.now();
 await run(db,[
  {sql:`INSERT INTO products(id,business_id,${names.join(',')}) SELECT ?,?,${names.map(key=>`CAST(? AS ${columnTypes[key]})`).join(',')} WHERE ${notArchived}`,
   params:[id,businessId,...names.map(key=>b[key] as Param),businessId],expectChanges:1},
  ...details(id,b),
  audit(businessId,userId,'products:create:'+id,now),changed(businessId,now),
 ]);
 return {id};
}

export async function updateProduct(db:Db,{businessId,productId,body,userId}:{businessId:string;productId:string;body:Record<string,any>;userId:string}){
 const b=body||{},names=Object.keys(columnTypes).filter(key=>b[key]!==undefined);
 if(!names.length)fail('No valid fields');
 if(await db.first('SELECT 1 AS ok FROM organization_trucks WHERE business_id=? AND archived',[businessId]))fail('Truck is archived',409);
 validate(b);
 if(!await db.first('SELECT 1 AS ok FROM products WHERE id=? AND business_id=?',[productId,businessId]))fail('Not found',404);
 const now=Date.now();
 await run(db,[
  {sql:`UPDATE products SET ${names.map(key=>key+'=?').join(',')} WHERE business_id=? AND id=? AND ${notArchived}`,
   params:[...names.map(key=>b[key] as Param),businessId,productId,businessId],expectChanges:1},
  ...details(productId,b),
  audit(businessId,userId,'products:update:'+productId,now),changed(businessId,now),
 ]);
 return {ok:true};
}
