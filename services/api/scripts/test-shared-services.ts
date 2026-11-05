import {readFile,readdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import pg from 'pg';

// Runs the shared service scenarios (packages/backend/tests) against PostgreSQL in an isolated schema.
// Requires DATABASE_URL (use `node scripts/with-test-postgres.mjs services/api/scripts/test-shared-services.ts`).
const admin=new pg.Pool({connectionString:process.env.DATABASE_URL});
const schema='test_shared_'+randomBytes(6).toString('hex');
await admin.query('CREATE SCHEMA "'+schema+'"');
const url=new URL(process.env.DATABASE_URL!);url.searchParams.set('options','-c search_path='+schema);process.env.DATABASE_URL=url.toString();
const {pool}=await import('../src/db.js');
const {PgDb}=await import('../src/db-port.js');
const {inventoryScenarios}=await import('../../../packages/backend/tests/inventory.scenarios.js');
const {catalogScenarios}=await import('../../../packages/backend/tests/catalog.scenarios.js');
const {peopleScenarios}=await import('../../../packages/backend/tests/people.scenarios.js');
const sets:[string,{name:string;run:(db:any)=>Promise<void>}[]][]=[['inventory',inventoryScenarios],['catalog',catalogScenarios],['people',peopleScenarios]];
let failed=0;
try{
 for(const name of (await readdir(new URL('../migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort())await pool.query(await readFile(new URL('../migrations/'+name,import.meta.url),'utf8'));
 const db=new PgDb(pool);
 for(const [set,scenarios] of sets)for(const scenario of scenarios){
  try{await scenario.run(db);console.log('ok   PG '+set+': '+scenario.name);}
  catch(error){failed++;console.error('FAIL PG '+set+': '+scenario.name+'\n'+(error as Error).stack);}
 }
}finally{
 await pool.end();
 await admin.query('DROP SCHEMA "'+schema+'" CASCADE');await admin.end();
}
if(failed){console.error(failed+' scenario(s) failed');process.exit(1);}
console.log('shared services: all scenarios passed on PostgreSQL');
