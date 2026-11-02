import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const migrated=spawnSync(process.execPath,['../../node_modules/tsx/dist/cli.mjs','scripts/migrate.ts'],{cwd:'services/api',env:process.env,stdio:'inherit'});
if(migrated.status!==0)throw new Error('Database migration failed');
await import(pathToFileURL(resolve('services/api/dist/services/api/src/server.js')).href);
