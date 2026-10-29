import { randomUUID,randomBytes } from 'node:crypto';
import { seedCatalog } from './database.mjs';
import { authSchema,createUser } from './auth.mjs';
import { orderSchema,placeOrder,changeOrder,collectPayment } from './orders.mjs';

export const demoPassword='DemoFoodTruck2026!';
export function seedDemo(db){
 seedCatalog(db);authSchema(db);orderSchema(db);
 db.exec("CREATE TABLE IF NOT EXISTS demo_markers(name TEXT PRIMARY KEY)");
 if(db.prepare("SELECT 1 FROM demo_markers WHERE name='operations-v1'").get())return;
 const businesses=db.prepare('SELECT * FROM businesses').all();
 for(const [index,b] of businesses.entries()){
  let owner;
  for(const role of ['owner','manager','staff']){
   const email=`${role}@${b.slug}.demo`;
   let user=db.prepare('SELECT id FROM users WHERE email=?').get(email);
   if(!user)user={id:createUser(db,email,demoPassword,b.id,role)};
   if(role==='owner')owner=user.id;
  }
  const products=db.prepare('SELECT * FROM products WHERE business_id=? ORDER BY rowid').all(b.id);
  products.forEach((p,i)=>{
   const inventoryId=`stock-${p.id}`;const initial=i===9?3:200;
   db.prepare('INSERT OR IGNORE INTO inventory(id,business_id,name,quantity,minimum,supplier) VALUES(?,?,?,?,?,?)').run(inventoryId,b.id,`Porções: ${p.name}`,initial,5,'Fornecedor demonstração Lisboa');
   db.prepare('INSERT OR IGNORE INTO recipes VALUES(?,?,1)').run(p.id,inventoryId);
   db.prepare('INSERT INTO stock_movements VALUES(?,?,?,?,?,?)').run(randomUUID(),inventoryId,initial,'restock',null,Date.now()-31*86400000);
   db.prepare('INSERT OR IGNORE INTO product_details(product_id,category,description,allergens,image,extra_name,extra_cents) VALUES(?,?,?,?,?,?,?)').run(p.id,i<5?'Especialidades':i<7?'Acompanhamentos':i===7?'Sobremesas':'Bebidas',`Preparado no momento. ${p.name} com ingredientes selecionados.`,i<8?'Consultar a equipa: pode conter glúten, leite, ovo e frutos de casca rija.':'Consultar a equipa.',`atlas:${index*10+i}`,i<5?(index===0?'Queijo extra':index===1?'Mozzarella extra':'Abacate extra'):'',i<5?150:0);
  });
  for(let n=0;n<24;n++){
   const id=placeOrder(db,{businessId:b.id,requestKey:randomBytes(32).toString('hex'),name:`Cliente Demo ${n%15+1}`,contact:`cliente${n%15+1}@${b.slug}.example`,items:[{id:products[n%8].id,quantity:1+n%2}]});
   if(n===20){changeOrder(db,owner,id,'cancelled');}
   else if(n<20){for(const state of ['confirmed','preparing','ready'])changeOrder(db,owner,id,state);collectPayment(db,owner,id);changeOrder(db,owner,id,'collected');}
   else {changeOrder(db,owner,id,'confirmed');if(n>21)changeOrder(db,owner,id,'preparing');}
   const created=n<21?Date.now()-(20-n)*86400000-3600000:Date.now();
   db.prepare('UPDATE orders SET created_at=? WHERE id=?').run(created,id);
  }
  db.prepare('UPDATE products SET available=0 WHERE id=?').run(products[6].id);
  db.prepare('INSERT OR IGNORE INTO business_settings(business_id,description,contact,address,latitude,longitude) VALUES(?,?,?,?,?,?)').run(b.id,'Comida de rua, feita com tempo e servida com alma.',`ola@${b.slug}.example`,['Praça do Comércio, Lisboa','Parque das Nações, Lisboa','Jardim da Estrela, Lisboa'][index],38.7078+index*.009,-9.1368+index*.005);
  for(let day=0;day<7;day++){
   const start=new Date();start.setUTCHours(10,0,0,0);start.setUTCDate(start.getUTCDate()+day);
   db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?)').run(`event-${b.id}-${day}`,b.id,day===6?'Catering privado':'Street Food · '+['Baixa','Parque','Mercado'][day%3],['Praça do Comércio','Parque das Nações','Mercado de Arroios'][day%3],start.getTime(),start.getTime()+11*3600000,day===6?0:1,day===6?'private':'market');
  }
 }
 db.prepare('INSERT INTO demo_markers VALUES(?)').run('operations-v1');
}
