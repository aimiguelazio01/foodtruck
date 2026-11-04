import assert from 'node:assert/strict';
import {chromium} from 'playwright';

export async function verifyDemoImages(browser) {
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  async function checkPhotos(label) {
    const images = page.locator('.food-photo img');
    await images.first().waitFor();
    const sources = await images.evaluateAll(nodes => [...new Set(nodes.map(img => img.getAttribute('src')))]);
    assert.equal(sources.length, 10, label);
    assert.equal(await page.locator('.food-photo-empty').count(), 0, label);
    for (const image of await images.all()) {
      await image.scrollIntoViewIfNeeded();
      await image.evaluate(img => img.decode());
      assert.ok(await image.evaluate(img => img.naturalWidth > 0 && img.naturalHeight > 0), label);
    }
    console.log('PASS:', label, '— 10 distinct photographs rendered and decoded.');
  }
  try {
    for (const slug of ['urban-burger','bella-pizza','green-bowl']) {
      await page.goto('http://localhost:3000/b/'+slug);
      await checkPhotos('Customer '+slug);
    }
    await page.goto('http://localhost:3001/demo');
    await page.waitForURL('http://localhost:3001/');
    await page.getByRole('button',{name:'Menu digital',exact:true}).click();
    await checkPhotos('Management demo menu');
    const entry = page.getByRole('link',{name:'Ver página de encomendas ↗',exact:true});
    const [catalog] = await Promise.all([page.waitForEvent('popup'),entry.click()]);
    try {
      await catalog.waitForURL('http://localhost:3000/');
      await catalog.locator('.truck-photo').first().waitFor();
      assert.equal(await catalog.locator('.truck-photo').count(),3);
      assert.equal(await catalog.getByText('Fotografia por adicionar',{exact:true}).count(),0);
      const positions=await catalog.locator('.truck-photo').evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n).backgroundPosition));
      assert.equal(new Set(positions).size,3);
      await catalog.evaluate(async()=>{const image=new Image();image.src='/images/trucks.webp';await image.decode();if(!image.naturalWidth)throw Error('Truck photograph failed to load');});
      console.log('PASS: main orders link opens the catalog with three distinct truck photographs.');
    } finally { await catalog.close(); }
    const card=page.locator('.product-card').first(),button=card.getByRole('button');
    assert.ok(await button.isEnabled(),'Demo product controls must allow editing');
    const original=await button.textContent();
    for(let attempt=0;attempt<2;attempt++){
      const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/operations')&&r.request().method()==='POST'),button.click()]);
      assert.equal(response.status(),200);
      await page.waitForFunction(({name,changed})=>{
        const text=document.querySelector('.product-card button')?.textContent;
        return changed?text!==name:text===name;
      },{name:original,changed:attempt===0});
    }
    console.log('PASS: demo product edited through the interface and original availability restored.');
  } finally { await page.close(); }
}

if (process.argv[1]?.endsWith('test-demo-images.mjs')) {
  const browser = await chromium.launch({headless:true});
  try { await verifyDemoImages(browser); } finally { await browser.close(); }
}
