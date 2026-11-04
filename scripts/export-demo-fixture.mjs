// Development-only conversion. The distributed application seeds PostgreSQL from JSON.
import {mkdirSync,writeFileSync} from 'node:fs';
import {openDatabase} from '../lib/database.mjs';
import {seedDemo} from '../lib/demo.mjs';
import {upgradeDemo} from '../lib/demo-upgrades.mjs';
const db=openDatabase(':memory:');
seedDemo(db);upgradeDemo(db);
for(const b of db.prepare('SELECT * FROM businesses').all()){
 const extra='extras-'+b.id;
 db.prepare('INSERT INTO inventory(id,business_id,name,quantity,minimum,supplier) VALUES(?,?,?,?,?,?)').run(extra,b.id,'Porções para extras',100,10,'Fornecedor demo');
 db.prepare('INSERT INTO stock_movements VALUES(?,?,?,?,?,?)').run('movement-'+extra,extra,100,'restock',null,Date.now());
 for(const title of ['Verificar temperaturas e limpeza','Preparar a mise en place','Conferir stock antes de abrir'])
  db.prepare('INSERT INTO tasks(id,business_id,title) VALUES(?,?,?)').run(`task-${b.id}-${title}`,b.id,title);
}
const tables=['businesses','users','memberships','products','business_settings','inventory','recipes','events','orders','order_items','stock_movements','reservations','product_details','audit_events','categories','event_products','modifier_groups','modifier_options','saved_locations','tasks','customer_notes'];
const fixture={version:1,capturedAt:Date.now(),tables:{}};
for(const table of tables){
 fixture.tables[table]=db.prepare(`SELECT * FROM ${table}`).all();
 if(table==='users')for(const row of fixture.tables[table])delete row.password;
 if(table==='product_details')for(const row of fixture.tables[table])row.image='/images/products/'+row.image.replace('atlas:','')+'.webp';
}
mkdirSync('deployment/demo',{recursive:true});
writeFileSync('deployment/demo/fixture.json',JSON.stringify(fixture,null,2)+'\n');db.close();
console.log('Demo fictícia convertida para deployment/demo/fixture.json.');
