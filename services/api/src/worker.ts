import {pool} from './db.js';
import {tick,finishMaintenance} from './maintenance.js';
async function run(){try{await tick();}catch{console.error('Maintenance failed; retry in 60 seconds.');}}
await run();const timer=setInterval(run,60000);async function stop(){clearInterval(timer);await finishMaintenance();await pool.end();process.exit();}process.on('SIGINT',stop);process.on('SIGTERM',stop);
