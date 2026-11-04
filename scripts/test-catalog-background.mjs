import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
let base,original;
try{
 const page=await context.newPage();await page.goto('http://localhost:3001/demo');await page.waitForURL('http://localhost:3001/');
 const {organizations}=await (await context.request.get('http://localhost:3001/api/v1/network/me/organizations')).json();
 base='http://localhost:3001/api/v1/network/'+organizations[0].id;
 original=(await (await context.request.get(base+'/company')).json()).settings;
 const menuBefore=(await (await context.request.get('http://localhost:3000/api/v1/public/businesses/bella-pizza')).json()).config.background_color;
 await page.getByRole('button',{name:'Personalização',exact:true}).click();
 await page.getByLabel('Cor de fundo da página principal de encomendas').fill('#26382e');
 await page.getByRole('button',{name:'Guardar personalização',exact:true}).click();await page.getByRole('status').filter({hasText:'Personalização publicada'}).waitFor();
 const catalog=await context.newPage();await catalog.goto('http://localhost:3000/');
 await catalog.waitForFunction(()=>getComputedStyle(document.querySelector('.landing')).backgroundColor==='rgb(38, 56, 46)');
 assert.equal(await catalog.locator('.landing').evaluate(el=>getComputedStyle(el).color),'rgb(255, 255, 255)');
 assert.equal(await catalog.locator('.truck-photo').count(),3);
 for(const width of [1440,375]){await catalog.setViewportSize({width,height:1000});assert.ok(await catalog.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 assert.equal((await (await context.request.get('http://localhost:3000/api/v1/public/businesses/bella-pizza')).json()).config.background_color,menuBefore);
 const bad=await context.request.post(base+'/branding',{data:{...original,catalog_background_color:'invalid'}});assert.equal(bad.status(),400);
 console.log('PASS: catalog background saved through the editor, visible publicly with readable text and truck photos, responsive, independent of truck menus, invalid colors rejected.');
}finally{
 if(original)assert.equal((await context.request.post(base+'/branding',{data:original})).status(),200);
 await browser.close();
}
