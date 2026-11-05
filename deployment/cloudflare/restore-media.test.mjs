import {test} from 'node:test';import assert from 'node:assert/strict';
import worker from '../../desktop/launcher/cloudflare/restore-media-worker.mjs';
test('isolated media worker authenticates, validates checksums and expires',async()=>{
 const files=new Map(),token='a'.repeat(64),key='uploads/12345678-1234-1234-1234-123456789abc.webp';
 const env={TOKEN:token,EXPIRES:new Date(Date.now()+60000).toISOString(),COPY:{put:async(k,data)=>files.set(k,data),get:async k=>files.has(k)?{size:files.get(k).length,arrayBuffer:async()=>files.get(k).buffer}:null}};
 const bytes=new Uint8Array([1,2,3]);const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 const send=(method,secret=token,checksum=hash)=>worker.fetch(new Request('https://copy.test/?key='+encodeURIComponent(key),{method,headers:{'x-foodtruck-restore':secret,'x-content-sha256':checksum},body:method==='PUT'?bytes:undefined}),env);
 assert.equal((await send('PUT','bad')).status,403);assert.equal(files.size,0);
 assert.equal((await send('PUT',token,'incorrect')).status,422);assert.equal(files.size,0);
 assert.equal((await send('PUT')).status,200);assert.equal((await (await send('GET')).json()).sha256,hash);
 env.EXPIRES=new Date(0).toISOString();assert.equal((await send('GET')).status,403);
});
