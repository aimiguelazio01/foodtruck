import {test} from 'node:test';import assert from 'node:assert/strict';import {backupMedia} from './backup-media.mjs';
test('media backup requires scoped authorization and detects changed objects',async()=>{
 const key='uploads/12345678-1234-1234-1234-123456789abc.webp',token='a'.repeat(48);let reads=0;
 const env={BACKUP_TOKEN:token,MEDIA:{list:async()=>{reads++;return {objects:[{key,size:3,etag:'v1'}],truncated:false}},get:async()=>({size:3,etag:'v1',body:new Uint8Array([1,2,3])})}};
 const request=(query='',secret=token)=>new Request('https://management.test/api/v1/platform-backup/media'+query,{headers:{'x-foodtruck-backup':secret}});
 assert.equal((await backupMedia(request('','invalid'),env)).status,403);assert.equal(reads,0);
 const list=await backupMedia(request(),env);assert.equal(list.headers.get('cache-control'),'no-store');assert.equal((await list.json()).objects[0].key,key);
 const response=await backupMedia(request('?key='+encodeURIComponent(key)+'&etag=v1'),env);assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[1,2,3]);
 assert.equal((await backupMedia(request('?key='+encodeURIComponent(key)+'&etag=old'),env)).status,412);
 assert.equal((await backupMedia(request('?key=private.txt&etag=v1'),env)).status,400);
});
