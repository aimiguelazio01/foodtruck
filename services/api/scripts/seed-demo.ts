import {readFile} from 'node:fs/promises';
import {randomBytes,scryptSync} from 'node:crypto';
import {pool} from '../src/db.js';
if(process.env.DEMO_MODE!=='1'||process.env.ALLOW_DEMO_SEED!=='1')throw new Error('Seed permitido apenas num perfil demo explícito.');
const fixture=JSON.parse(await readFile(new URL('../../../deployment/demo/fixture.json',import.meta.url),'utf8'));
const c=await pool.connect();
try{
 await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(81293474)');
 const state=(await c.query('SELECT mode FROM installation_state WHERE id=1')).rows[0];
 if(state?.mode==='demo'){await c.query('COMMIT');console.log('Demo existente preservada.');}
 else{
  if(state||(await c.query('SELECT 1 FROM users UNION ALL SELECT 1 FROM businesses UNION ALL SELECT 1 FROM organizations LIMIT 1')).rowCount)throw new Error('A demo exige uma base vazia independente.');
  const shift=Date.now()-fixture.capturedAt;
  const timestamps=new Set(['created_at','pickup_at','starts_at','ends_at','location_updated_at','gps_updated_at','due_at']);
  for(const [table,source] of Object.entries(fixture.tables) as [string,Record<string,any>[]][]){
   const allowed=new Set((await c.query('SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1',[table])).rows.map(r=>r.column_name));
   for(const original of source){
    const row={...original};
    if(table==='users'){const salt=randomBytes(16).toString('hex');row.password=salt+':'+scryptSync('DemoFoodTruck2026!',salt,64).toString('hex');}
    for(const key of timestamps)if(typeof row[key]==='number')row[key]+=shift;
    const keys=Object.keys(row).filter(k=>allowed.has(k));
    await c.query(`INSERT INTO "${table}" (${keys.map(k=>'"'+k+'"').join(',')}) VALUES (${keys.map((_,i)=>'$'+(i+1)).join(',')})`,keys.map(k=>row[k]));
   }
  }
  await c.query("INSERT INTO organizations(id,name) VALUES('demo-network','Rede de demonstração')");
  await c.query("INSERT INTO organization_members SELECT 'demo-network',id,'network_owner' FROM users WHERE email='owner@urban-burger.demo'");
  await c.query("INSERT INTO organization_trucks(organization_id,business_id) SELECT 'demo-network',id FROM businesses");
  await c.query("INSERT INTO organization_settings(organization_id,company_name) VALUES('demo-network','Rede de demonstração')");
  await c.query("INSERT INTO installation_state(id,mode) VALUES(1,'demo')");
  await c.query('COMMIT');console.log('Demo PostgreSQL criada: 3 negócios, 30 produtos e dados operacionais fictícios.');
 }
}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();await pool.end();}
