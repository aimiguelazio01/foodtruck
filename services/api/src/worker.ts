import {pool} from './db.js';
import {tick,finishMaintenance} from './maintenance.js';
await tick();const timer=setInterval(tick,60000);async function stop(){clearInterval(timer);await finishMaintenance();await pool.end();process.exit();}process.on('SIGINT',stop);process.on('SIGTERM',stop);
