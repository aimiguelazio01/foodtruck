const {chromium,expect}=require('@playwright/test');
const fs=require('node:fs');const {createRequire}=require('node:module');const {Pool}=createRequire(process.cwd()+'/services/api/package.json')('pg');
let browser,fixtureId;const name='Teste inventário '+Date.now();const db=new Pool({connectionString:process.env.DATABASE_URL});
(async()=>{
 browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:3001');await page.getByLabel('Email',{exact:true}).fill('owner@urban-burger.demo');await page.getByLabel('Palavra-passe',{exact:true}).fill('DemoFoodTruck2026!');await page.getByRole('button',{name:'Entrar →',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Rede',exact:true})).toBeVisible();await page.locator('.dashboard-header select').selectOption('bella-pizza');await page.getByRole('button',{name:'Inventário',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Ingredientes e stock'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Adicionar ingrediente',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Adicionar ingrediente',exact:true}).click();
 await page.getByLabel('Nome do ingrediente',{exact:true}).fill(name);await page.getByLabel('Unidade de stock',{exact:true}).fill('g');await page.getByLabel('Stock inicial',{exact:true}).fill('10');await page.getByLabel('Stock mínimo disponível',{exact:true}).fill('5');await page.getByLabel('Fornecedor (opcional)',{exact:true}).fill('Fornecedor de teste');
 const created=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/bella-pizza/inventory'));
 await page.getByRole('button',{name:'Criar ingrediente',exact:true}).click();const createResponse=await created;if(createResponse.status()!==200)throw Error(await createResponse.text());fixtureId=(await createResponse.json()).id;
 await page.getByRole('searchbox').fill(name);const row=page.getByRole('row').filter({has:page.getByRole('rowheader').filter({hasText:name})});await expect(row).toHaveCount(1);
 await expect(row).toContainText('10');await expect(row).toContainText('Stock suficiente');
 await row.getByRole('button',{name:'Remover '+name,exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('dialog').getByRole('button',{name:'Cancelar',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
 await row.getByRole('button',{name:'Registar movimento de '+name,exact:true}).click();await page.getByLabel('Tipo de movimento',{exact:true}).selectOption('waste');await page.getByLabel('Quantidade (g)',{exact:true}).fill('10');await page.locator('form').getByRole('button',{name:'Registar movimento',exact:true}).click();
 await expect(page.getByText('Movimento registado.',{exact:true})).toBeVisible();await expect(row).toContainText('Sem stock disponível');
 await row.getByRole('button',{name:'Ver histórico de '+name,exact:true}).click();await expect(page.locator('.inventory-history li')).toHaveCount(2);
 await row.getByRole('button',{name:'Remover '+name,exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Remover ingrediente',exact:true}).click();await expect(page.getByText('Ingrediente removido. Pode restaurá-lo na lista de removidos.',{exact:true})).toBeVisible();await expect(row).toHaveCount(0);
 await page.getByLabel('Mostrar',{exact:true}).selectOption('removed');const removedRow=page.getByRole('row').filter({hasText:name});await expect(removedRow).toHaveCount(1);await removedRow.getByRole('button',{name:'Restaurar '+name,exact:true}).click();await expect(removedRow).toHaveCount(0);await page.getByLabel('Mostrar',{exact:true}).selectOption('all');await expect(row).toHaveCount(1);
 await row.getByRole('button',{name:'Editar '+name,exact:true}).click();await page.getByLabel('Stock mínimo disponível',{exact:true}).fill('3');await page.getByRole('button',{name:'Guardar alterações',exact:true}).click();await expect(page.getByText('Ingrediente atualizado.',{exact:true})).toBeVisible();
 await page.getByRole('searchbox').fill('');await page.screenshot({path:'tmp/inventory-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'tmp/inventory-mobile.png',fullPage:true});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);if(overflow)throw Error('Overflow horizontal no ecrã móvel');
 if(errors.length)throw Error(errors.join('\n'));
 console.log('PASS: browser ingredient creation, initial stock, cancel removal, stock movement, history, remove, restore, edit, mobile overflow, no runtime errors.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{
 if(browser)await browser.close();if(fixtureId){await db.query('BEGIN');try{await db.query('DELETE FROM stock_movements WHERE inventory_id=$1',[fixtureId]);await db.query("DELETE FROM audit_events WHERE business_id='bella-pizza' AND action LIKE $1",['inventory:%:'+fixtureId]);await db.query('DELETE FROM inventory WHERE id=$1 AND name=$2',[fixtureId,name]);await db.query('COMMIT');console.log('Test ingredient cleaned up.');}catch(e){await db.query('ROLLBACK');console.error(e);process.exitCode=1;}}await db.end();
});



