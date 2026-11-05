import {spawnSync} from 'node:child_process';
const result=spawnSync('go',['-C','desktop/launcher','test','./platform','-count=1'],{stdio:'inherit',env:process.env,windowsHide:true});
process.exit(result.status??1);
