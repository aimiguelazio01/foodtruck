export function modifierGroups(db,productId){return db.prepare('SELECT * FROM modifier_groups WHERE product_id=? ORDER BY rowid').all(productId).map(g=>({...g,options:db.prepare('SELECT id,name,price_cents FROM modifier_options WHERE group_id=? ORDER BY rowid').all(g.id)}));}
export function validateModifiers(db,productId,businessId,ids=[]){
 if(!Array.isArray(ids)||ids.length>100||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)throw new Error('Escolhas inválidas.');
 const groups=modifierGroups(db,productId);const known=new Set(groups.flatMap(g=>g.options.map(o=>o.id)));if(ids.some(id=>!known.has(id)))throw new Error('Opção inválida para o produto.');
 let cents=0;const labels=[],ingredients=[];
 for(const group of groups){const chosen=group.options.filter(o=>ids.includes(o.id));if(chosen.length<group.min_count||chosen.length>group.max_count)throw new Error(`Escolha entre ${group.min_count} e ${group.max_count} opções em ${group.name}.`);for(const option of chosen){cents+=option.price_cents;labels.push(`${group.name}: ${option.name}`);const recipe=db.prepare('SELECT o.inventory_id,o.quantity,i.business_id FROM modifier_options o LEFT JOIN inventory i ON i.id=o.inventory_id WHERE o.id=?').get(option.id);if(recipe.inventory_id){if(recipe.business_id!==businessId)throw new Error('Ingrediente da opção inválido.');ingredients.push({id:recipe.inventory_id,quantity:recipe.quantity});}}}
 return {cents,labels,ingredients};
}
