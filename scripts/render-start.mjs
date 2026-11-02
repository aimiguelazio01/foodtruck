import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const mode=process.argv[2]||'api';
if(!['api','worker'].includes(mode))throw new Error('Expected api or worker');
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required');
if(process.env.NODE_EXTRA_CA_CERTS)process.env.NODE_EXTRA_CA_CERTS=resolve(process.env.NODE_EXTRA_CA_CERTS);
if(process.env.RUN_MAINTENANCE==='1'&&(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY))throw new Error('Free hosting requires persistent Supabase storage');
process.chdir(fileURLToPath(new URL('../services/api/',import.meta.url)));
// Both processes can start together: the migration runner holds an advisory lock.
const migration=spawnSync(process.execPath,['../../node_modules/tsx/dist/cli.mjs','scripts/migrate.ts'],{stdio:'inherit',env:process.env});
if(migration.status!==0)throw new Error('Database migration failed');
if(mode==='api'&&process.env.RUN_MAINTENANCE==='1'){
  await import(new URL('../services/api/dist/services/api/src/worker.js',import.meta.url).href);
}
await import(new URL(`../services/api/dist/services/api/src/${mode==='api'?'server':'worker'}.js`,import.meta.url).href);
