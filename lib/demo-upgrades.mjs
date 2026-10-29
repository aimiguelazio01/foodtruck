import {randomUUID} from 'node:crypto';
export function upgradeDemo(db){
 if(db.prepare("SELECT 1 FROM demo_markers WHERE name='ingredient-recipes-v1'").get())return;
 const definitions={
  'urban-burger':{names:['Pão de hambúrguer','Carne de vaca — porções','Queijo — porções','Alface — porções','Molho — porções','Batata','Óleo','Frango — porções','Hambúrguer vegetal','Bebidas e sobremesas — porções'],units:['un','un','un','un','un','g','ml','un','un','un'],recipes:[[[0,1],[1,1],[2,1],[3,1],[4,1]],[[0,1],[1,2],[2,2],[4,1]],[[0,1],[1,1],[2,1],[4,1]],[[0,1],[7,1],[3,1],[4,1]],[[0,1],[8,1],[3,1],[4,1]],[[5,180],[6,10],[2,1]],[[5,180],[6,10]],[[9,1]],[[9,1]],[[9,1]]],extra:2},
  'bella-pizza':{names:['Massa de pizza — porções','Tomate — porções','Mozzarella — porções','Manjericão — porções','Pepperoni — porções','Mistura de queijos — porções','Prosciutto — porções','Legumes — porções','Alho — porções','Bebidas e sobremesas — porções'],units:Array(10).fill('un'),recipes:[[[0,1],[1,1],[2,1],[3,1]],[[0,1],[1,1],[2,1],[4,1]],[[0,1],[5,1]],[[0,1],[1,1],[2,1],[6,1]],[[0,1],[1,1],[2,1],[7,1]],[[0,1],[1,1],[2,1],[4,1]],[[0,1],[8,1]],[[9,1]],[[9,1]],[[9,1]]],extra:2},
  'green-bowl':{names:['Quinoa cozida — porções','Frango grelhado — porções','Legumes frescos — porções','Grão-de-bico — porções','Falafel — porções','Tortilha — unidades','Abacate — porções','Fruta fresca — porções','Manga — porções','Base de bebidas — porções'],units:Array(10).fill('un'),recipes:[[[0,1],[1,1],[2,1]],[[0,1],[2,1],[3,1]],[[0,1],[3,1],[2,1]],[[5,1],[4,1],[2,1]],[[5,1],[6,1],[2,1]],[[0,1],[2,1]],[[7,1]],[[8,1],[9,1]],[[2,1],[9,1]],[[9,1]]],extra:6}
 };
 db.exec('BEGIN IMMEDIATE');try{
  for(const [business,def] of Object.entries(definitions)){
   if(!db.prepare('SELECT 1 FROM businesses WHERE id=?').get(business))continue;
   def.names.forEach((name,i)=>{const id=`ingredient-${business}-${i}`;const initial=def.units[i]==='un'?500:50000;db.prepare('INSERT INTO inventory(id,business_id,name,unit,quantity,minimum,supplier) VALUES(?,?,?,?,?,?,?)').run(id,business,name,def.units[i],initial,def.units[i]==='un'?10:500,'Fornecedor local · demonstração');db.prepare('INSERT INTO stock_movements VALUES(?,?,?,?,?,?)').run(randomUUID(),id,initial,'restock',null,Date.now());});
   for(let index=0;index<10;index++){const id=`${business}-${index}`;db.prepare('DELETE FROM recipes WHERE product_id=?').run(id);for(const [ingredient,quantity] of def.recipes[index])db.prepare('INSERT INTO recipes VALUES(?,?,?)').run(id,`ingredient-${business}-${ingredient}`,quantity);db.prepare('UPDATE product_details SET ingredients=?,variant_name=?,variant_cents=?,extra_inventory_id=? WHERE product_id=?').run(def.recipes[index].map(([i])=>def.names[i]).join(', '),index<5?'Dose dupla':'',index<5?400:0,index<5?`ingredient-${business}-${def.extra}`:null,id);}
   db.prepare('UPDATE product_details SET promotion_cents=? WHERE product_id=?').run(1100,`${business}-4`);
  }
  db.prepare('INSERT INTO demo_markers VALUES(?)').run('ingredient-recipes-v1');db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}
