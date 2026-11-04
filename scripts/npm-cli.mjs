import {existsSync,realpathSync} from 'node:fs';
import path from 'node:path';
export function findNpmCli({execPath=process.execPath,env=process.env,exists=existsSync,realpath=realpathSync,paths=path}={}){
 const {dirname,join,resolve,delimiter}=paths;
 const bin=dirname(execPath);
 const candidates=[env.npm_execpath,join(bin,'node_modules/npm/bin/npm-cli.js'),resolve(bin,'../lib/node_modules/npm/bin/npm-cli.js'),'/usr/share/nodejs/npm/bin/npm-cli.js'];
 for(const dir of (env.PATH||env.Path||'').split(delimiter)){
  const npm=join(dir,'npm');if(exists(npm)){try{const target=realpath(npm);if(target.endsWith('npm-cli.js'))candidates.push(target)}catch{}}
 }
 for(const candidate of candidates)if(candidate&&exists(candidate))return candidate;
 throw Error('Não foi encontrado npm. Instale Node.js 24 LTS com npm a partir de https://nodejs.org.');
}
