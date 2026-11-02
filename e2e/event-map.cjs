const {chromium,expect}=require('@playwright/test');let browser;
(async()=>{browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1100},locale:'pt-PT'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:3001');await page.locator('input[name=email]').fill('owner@urban-burger.demo');await page.locator('input[name=password]').fill('DemoFoodTruck2026!');await page.getByRole('button',{name:'Entrar →'}).click();await expect(page.getByRole('heading',{name:'Rede',exact:true})).toBeVisible();await page.getByRole('button',{name:'Calendário',exact:true}).click();await page.getByRole('button',{name:'Criar evento',exact:true}).click();
 await expect(page.getByRole('button',{name:'Colocar pin no centro do mapa',exact:true})).toBeVisible({timeout:30000});
 const map=page.locator('.event-pin-map');await expect(map).toHaveClass(/leaflet-container/);
 const reverse=page.waitForResponse(r=>r.url().includes('/events/location/reverse?'));await map.click({position:{x:300,y:170}});const response=await reverse;if(response.status()!==200)throw Error(await response.text());
 await expect(page.getByLabel('Morada',{exact:true})).not.toHaveValue('',{timeout:15000});await expect(page.getByLabel('Latitude',{exact:true})).not.toHaveValue('');await expect(page.getByLabel('Longitude',{exact:true})).not.toHaveValue('');
 const originalLat=await page.getByLabel('Latitude',{exact:true}).inputValue();const marker=map.locator('.leaflet-marker-icon');await expect(marker).toBeVisible();const box=await marker.boundingBox();const dragResponse=page.waitForResponse(r=>r.url().includes('/events/location/reverse?'));await page.mouse.move(box.x+16,box.y+16);await page.mouse.down();await page.mouse.move(box.x+80,box.y+35,{steps:8});await page.mouse.up();await dragResponse;await expect(page.getByLabel('Latitude',{exact:true})).not.toHaveValue(originalLat);
 await expect(page.getByRole('button',{name:'Localizar morada no mapa',exact:true})).toBeEnabled();await page.getByLabel('Morada',{exact:true}).fill('Praça do Comércio, Lisboa');await page.getByRole('button',{name:'Localizar morada no mapa',exact:true}).click();const results=page.getByRole('list',{name:'Locais encontrados'});await expect(results).toBeVisible({timeout:20000});await results.getByRole('button').first().click();await expect(results).toHaveCount(0);await expect(map.locator('.leaflet-marker-icon')).toBeVisible();
 await page.route(/\/events\/location\/reverse\?/,async route=>{await new Promise(r=>setTimeout(r,400));await route.fulfill({json:{locations:[{address:'Morada automática atrasada',latitude:38.7,longitude:-9.1}]}})});
 await map.click({position:{x:350,y:160}});await page.getByLabel('Morada',{exact:true}).fill('Morada manual que deve ficar');
 await expect(page.getByText('Coordenadas preenchidas. A morada que escreveu foi mantida.',{exact:true})).toBeVisible();await expect(page.getByLabel('Morada',{exact:true})).toHaveValue('Morada manual que deve ficar');
 await page.unroute(/\/events\/location\/reverse\?/);
 await page.route(/\/events\/location\/reverse\?/,route=>route.fulfill({status:503,json:{message:'Temporariamente indisponível'}}));
 await map.click({position:{x:370,y:180}});await expect(page.getByText('Não foi possível obter a morada. As coordenadas continuam preenchidas; pode escrever a morada manualmente.',{exact:true})).toBeVisible();
 await expect(page.getByLabel('Latitude',{exact:true})).not.toHaveValue('');const required=await page.getByLabel('Morada',{exact:true}).getAttribute('required');if(required!==null)throw Error('A morada não pode ser obrigatória quando há coordenadas');
 await page.unroute(/\/events\/location\/reverse\?/);
 const cleanReverse=page.waitForResponse(r=>r.url().includes('/events/location/reverse?'));await page.getByRole('button',{name:'Colocar pin no centro do mapa',exact:true}).click();await cleanReverse;await expect(page.getByText('Coordenadas e morada preenchidas. Confirme a morada antes de guardar.',{exact:true})).toBeVisible();
 await page.locator('.event-location-picker').screenshot({path:'tmp/event-pin-desktop.png'});
 await page.setViewportSize({width:390,height:844});await map.scrollIntoViewIfNeeded();await expect(map.locator('.leaflet-marker-icon')).toBeInViewport();await page.locator('.event-location-picker').screenshot({path:'tmp/event-pin-mobile.png'});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Overflow móvel');
 if(errors.length)throw Error(errors.join('\n'));
 console.log('PASS: real map click and reverse geocoding; draggable pin; address search and selection; manual address survives delayed results; geocoding outage keeps coordinates; address optional; mobile overflow; no runtime errors. No events saved.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(browser)await browser.close()});


