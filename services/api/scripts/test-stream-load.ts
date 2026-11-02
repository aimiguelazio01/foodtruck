import {performance} from 'node:perf_hooks';
import {pool} from '../src/db.js';
const base=process.env.TEST_API_URL||'http://127.0.0.1:4000';
const controllers:AbortController[]=[];const readers:ReadableStreamDefaultReader<Uint8Array>[]=[];
try{
 const start=performance.now();
 for(let offset=0;offset<1000;offset+=50)await Promise.all(Array.from({length:50},async()=>{const controller=new AbortController();controllers.push(controller);const response=await fetch(base+'/api/v1/public/businesses/urban-burger/events',{signal:controller.signal});if(!response.ok)throw new Error('Stream '+response.status);const reader=response.body!.getReader();await reader.read();readers.push(reader);}));
 console.log('PASS 1000 concurrent public streams opened in '+Math.round(performance.now()-start)+'ms');
 const before=performance.now();const pending=readers.map(async reader=>{let text='';while(!text.includes('event: change')){const chunk=await reader.read();if(chunk.done)throw new Error('Stream closed');text+=new TextDecoder().decode(chunk.value);}return performance.now()-before;});
 await pool.query("SELECT pg_notify('foodtruck_changes',$1)",[JSON.stringify({businessId:'urban-burger'})]);
 const delays=await Promise.race([Promise.all(pending),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('Event timeout')),10000).unref())]);delays.sort((a,b)=>a-b);console.log('Event p95 '+Math.round(delays[949])+'ms');if(delays[949]>2000)throw new Error('Event latency exceeds target');
 const reads=await Promise.all(Array.from({length:100},async()=>{const start=performance.now();const r=await fetch(base+'/api/v1/public/businesses/urban-burger');if(!r.ok)throw new Error('Menu '+r.status);await r.json();return performance.now()-start;}));reads.sort((a,b)=>a-b);console.log('PASS 100 concurrent menu reads, p95 '+Math.round(reads[94])+'ms');
}finally{for(const c of controllers)c.abort();await pool.end();}
