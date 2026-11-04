import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
let original,base;
async function save(values){return context.request.post(base+'/operations',{data:{command:'branding',...values}})}
try{
 const page=await context.newPage();await page.goto('http://localhost:3001/demo');await page.waitForURL('http://localhost:3001/');
 const businesses=await (await context.request.get('http://localhost:3001/api/v1/manage/businesses')).json();
 const b=businesses.businesses[0];base='http://localhost:3001/api/v1/manage/businesses/'+b.id;
 const {settings}=await (await context.request.get(base+'/settings')).json();original={...settings,name:b.name,color:b.color};
 for(const [font,layout,color] of [['modern','compact','#e2ebdf'],['rounded','showcase','#26302a'],['classic','standard','#efe6d6'],['original','standard','']]){
  const response=await save({...original,font_family:font,page_layout:layout,background_color:color});assert.equal(response.status(),200,await response.text());
  await page.goto('http://localhost:3000/b/'+b.slug);
  await page.locator('.storefront.font-'+font+'.layout-'+layout).waitFor();
  if(color)assert.equal(await page.locator('.storefront').evaluate(el=>el.style.getPropertyValue('--page-background')),color);
  for(const width of [1440,375]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow at '+width);}
 }
 for(const invalid of [{font_family:'external-font'},{page_layout:'arbitrary'},{background_color:'url(x)'}])assert.equal((await save({...original,...invalid})).status(),400);
 await page.goto('http://localhost:3001/');await page.getByRole('button',{name:'Página de encomendas',exact:true}).click();await page.getByRole('button',{name:'Editar página',exact:true}).click();
 await page.getByLabel('Tipo de letra').selectOption('classic');await page.getByLabel('Layout da página').selectOption('showcase');await page.getByLabel('Cor de fundo',{exact:true}).fill('#e8e0d0');
 assert.ok(await page.getByLabel('Pré-visualização da página',{exact:true}).isVisible());
 await page.getByRole('button',{name:'Guardar e publicar alterações',exact:true}).click();await page.getByRole('status').filter({hasText:'publicados'}).waitFor();
 const stored=(await (await context.request.get(base+'/settings')).json()).settings;assert.equal(stored.font_family,'classic');assert.equal(stored.page_layout,'showcase');assert.equal(stored.background_color,'#e8e0d0');
 console.log('PASS: appearance settings persist through API and editor, four fonts, three layouts, background colors, validation, preview and desktop/mobile layout.');
}finally{
 if(original)assert.equal((await save(original)).status(),200,'Restore original demo appearance');
 await browser.close();
}
