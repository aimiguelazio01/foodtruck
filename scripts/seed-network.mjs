import {spawnSync} from 'node:child_process';
import {loadInstallEnv} from './install-config.mjs';
loadInstallEnv();
const r=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs','services/api/scripts/seed-demo.ts'],{env:process.env,stdio:'inherit'});process.exitCode=r.status??1;
