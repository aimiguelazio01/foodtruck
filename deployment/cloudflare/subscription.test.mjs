import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hostingAccess,resetHostingCache} from './subscription.mjs';

const env={SUBSCRIPTION_STATUS_URL:'https://portal.example/api/hosting/status',SUBSCRIPTION_TOKEN:'private-token'};
const MIN=60*1000,HOUR=60*MIN;

async function withFetch(impl,run){
 const original=globalThis.fetch;
 globalThis.fetch=impl;resetHostingCache();
 try{await run()}finally{globalThis.fetch=original;resetHostingCache()}
}

test('own-account deployments do not depend on the platform',async()=>{
 assert.equal(await hostingAccess({}),null);
});
test('managed hosting enforces active, expired and unavailable states',async()=>{
 await withFetch(async(url,options)=>{assert.equal(String(url),env.SUBSCRIPTION_STATUS_URL);assert.equal(options.headers.Authorization,'Bearer private-token');assert.equal(options.redirect,'error');return Response.json({active:true})},async()=>{
  assert.equal(await hostingAccess(env,0),null);
 });
 await withFetch(async()=>Response.json({active:false}),async()=>assert.equal((await hostingAccess(env,0)).status,402));
 await withFetch(async()=>Response.json({}),async()=>assert.equal((await hostingAccess(env,0)).status,503));
 await withFetch(async()=>{throw Error('network failure')},async()=>assert.equal((await hostingAccess(env,0)).status,503));
 await withFetch(async()=>Response.json({active:true}),async()=>assert.equal((await hostingAccess({...env,SUBSCRIPTION_STATUS_URL:'http://portal.example'},0)).status,503));
});
test('status is cached between checks',async()=>{
 let calls=0;
 await withFetch(async()=>{calls++;return Response.json({active:true})},async()=>{
  await hostingAccess(env,0);await hostingAccess(env,4*MIN);
  assert.equal(calls,1);
  await hostingAccess(env,6*MIN);
  assert.equal(calls,2);
 });
});
test('suspension is noticed within a minute and reactivation recovers',async()=>{
 let active=false;
 await withFetch(async()=>Response.json({active}),async()=>{
  assert.equal((await hostingAccess(env,0)).status,402);
  active=true;
  assert.equal((await hostingAccess(env,30*1000)).status,402);
  assert.equal(await hostingAccess(env,2*MIN),null);
 });
});
test('portal outage keeps a recently active site up for 72 hours only',async()=>{
 let down=false;
 await withFetch(async()=>{if(down)throw Error('portal down');return Response.json({active:true})},async()=>{
  assert.equal(await hostingAccess(env,0),null);
  down=true;
  assert.equal(await hostingAccess(env,10*MIN),null);
  assert.equal(await hostingAccess(env,71*HOUR),null);
  assert.equal((await hostingAccess(env,73*HOUR)).status,503);
 });
});
test('portal outage never unlocks a suspended or unknown site',async()=>{
 let down=false;
 await withFetch(async()=>{if(down)throw Error('portal down');return Response.json({active:false})},async()=>{
  assert.equal((await hostingAccess(env,0)).status,402);
  down=true;
  assert.equal((await hostingAccess(env,5*MIN)).status,503);
 });
});

function fakeStatusTable() {
 let row;
 const writes=[];
 return {writes,get row(){return row},set row(value){row=value},prepare(sql){return {bind:(...values)=>({run:async()=>{row={active:values[0],checked_at:values[1],last_active_at:values[2]};writes.push(values)}}),first:async()=>row}}};
}
test('the last answer survives a Worker restart, so the grace period does too',async()=>{
 const DB=fakeStatusTable();const stored={...env,DB};
 let down=false;
 await withFetch(async()=>{if(down)throw Error('portal down');return Response.json({active:true})},async()=>{
  assert.equal(await hostingAccess(stored,0),null);
  assert.equal(DB.writes.length,1);
  resetHostingCache(); // a new isolate: empty memory, same database
  down=true;
  assert.equal(await hostingAccess(stored,30*MIN),null);
  resetHostingCache();
  assert.equal(await hostingAccess(stored,71*HOUR),null);
  resetHostingCache();
  assert.equal((await hostingAccess(stored,73*HOUR)).status,503);
 });
});
test('a stored suspension is honoured and storage problems never block the gate',async()=>{
 const DB=fakeStatusTable();DB.row={active:0,checked_at:0,last_active_at:null};
 await withFetch(async()=>{throw Error('portal down')},async()=>{
  assert.equal((await hostingAccess({...env,DB},10*1000)).status,402,'a fresh stored answer is used without calling the portal');
  resetHostingCache();
  assert.equal((await hostingAccess({...env,DB},HOUR)).status,503,'a stale suspension does not unlock during an outage');
 });
 const broken={prepare(){throw Error('no such table: hosting_status')}};
 await withFetch(async()=>Response.json({active:true}),async()=>assert.equal(await hostingAccess({...env,DB:broken},0),null));
});
