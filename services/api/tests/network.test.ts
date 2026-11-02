import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { networkRoutes } from '../src/network.js';

async function setup(mode: 'anonymous'|'overlap'|'reserved') {
 const calls: string[]=[];
 const query=async (sql: string) => { calls.push(sql); if(sql.includes('organization_members')) return {rowCount:1,rows:[{role:'network_owner'}]}; if(sql.includes('organization_trucks')) return {rowCount:1,rows:[{}]}; if(sql.includes('FROM memberships')) return {rowCount:1,rows:[{}]}; if(sql.includes('FROM network_availability')) return {rowCount:1,rows:[{}]}; if(sql.includes('FROM network_shifts')) return {rowCount:mode==='overlap'?1:0,rows:[{}]}; if(sql.includes('FROM network_transfers')) return {rowCount:1,rows:[{status:'draft'}]}; if(sql.includes('FROM network_transfer_items')) return {rowCount:1,rows:[{inventory_id:'a',quantity:3}]}; if(sql.includes('FROM inventory')) return {rowCount:1,rows:[{quantity:5,reserved:3}]}; return {rowCount:0,rows:[]}; };
 const db={query,release(){}}; const pool={query,connect:async()=>db};
 const app=Fastify(); app.addHook('preHandler',async req=>{req.user=mode==='anonymous'?null:{id:'u',email:'u@example.com'};}); await networkRoutes(app,pool as any); return {app,calls};
}
test('network operations reject unauthenticated users',async()=>{const {app}=await setup('anonymous');const r=await app.inject({method:'GET',url:'/api/v1/network/o'});assert.equal(r.statusCode,401);await app.close();});
test('staff shifts reject overlapping assignments across trucks',async()=>{const {app,calls}=await setup('overlap');const r=await app.inject({method:'POST',url:'/api/v1/network/o/shifts',payload:{user_id:'u',business_id:'b',starts_at:'2026-10-25T01:00:00+01:00',ends_at:'2026-10-25T02:00:00+00:00'}});assert.equal(r.statusCode,409);assert.ok(calls.includes('ROLLBACK'));assert.ok(!calls.some(x=>x.startsWith('INSERT INTO network_shifts')));await app.close();});
test('dispatch cannot spend stock reserved for orders',async()=>{const {app,calls}=await setup('reserved');const r=await app.inject({method:'POST',url:'/api/v1/network/o/transfers/t/dispatch'});assert.equal(r.statusCode,409);assert.ok(calls.includes('ROLLBACK'));assert.ok(!calls.some(x=>x.startsWith('UPDATE inventory')));await app.close();});
