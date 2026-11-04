import {readFile,writeFile,mkdir,cp,readdir,access,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {resolve,join,relative,dirname} from 'node:path';
import {findNpmCli} from '../scripts/npm-cli.mjs';
const root=resolve('.'),config=JSON.parse(await readFile('desktop/installer-config.json','utf8')),lock=JSON.parse(await readFile('package-lock.json','utf8'));
const stage=resolve('output/installers/stage'),cache=resolve('tmp/installer-tools/downloads');await mkdir(cache,{recursive:true});await mkdir(stage,{recursive:true});
async function exists(path){try{await access(path);return true}catch{return false}}
function run(command,args,options={}){return new Promise((ok,fail)=>{const p=spawn(command,args,{cwd:root,stdio:'inherit',windowsHide:true,...options});p.once('error',fail);p.once('exit',code=>code===0?ok():fail(Error(command+' failed: '+code)))})}
async function download(url,destination){if(await exists(destination))return;console.log('Download: '+new URL(url).pathname);const response=await fetch(url);if(!response.ok)throw Error(url+' returned '+response.status);await writeFile(destination,Buffer.from(await response.arrayBuffer()))}
const sumsFile=join(cache,`node-v${config.nodeVersion}-SHASUMS256.txt`);await download(`https://nodejs.org/dist/v${config.nodeVersion}/SHASUMS256.txt`,sumsFile);const sums=await readFile(sumsFile,'utf8');
const rootPkg=JSON.parse(await readFile('package.json','utf8')),apiPkg=JSON.parse(await readFile('services/api/package.json','utf8'));
const dependencies={};for(const name of Object.keys({...rootPkg.dependencies,...apiPkg.dependencies,'embedded-postgres':''})){if(name.startsWith('@types/'))continue;const key='node_modules/'+name;const item=lock.packages[key];if(!item)throw Error('Missing locked dependency '+name);dependencies[name]=item.version}
for(const target of config.targets){
 if(process.argv[2]&&target.id!==process.argv[2])continue;
 const dest=join(stage,target.id),payload=join(dest,'payload');await mkdir(payload,{recursive:true});
 console.log('\nPreparing '+target.id);
 const runtimePkg={name:'food-truck-live-runtime',version:config.version,private:true,type:'module',dependencies};const text=JSON.stringify(runtimePkg,null,2)+'\n';await writeFile(join(payload,'package.json'),text);
 const fingerprint=createHash('sha256').update(text+target.id).digest('hex'),marker=join(payload,'.dependencies-sha256');
 if(!await exists(marker)||(await readFile(marker,'utf8'))!==fingerprint){
  await run(process.execPath,[findNpmCli(),'install','--ignore-scripts','--omit=dev','--include=optional','--bin-links=false','--no-audit','--no-fund','--os='+target.os,'--cpu='+target.arch,...target.os==='linux'?['--libc=glibc']:[]],{cwd:payload});await writeFile(marker,fingerprint);
 }
 const nativeName=(target.os==='win32'?'windows':target.os)+'-'+target.arch;
 const native=join(payload,'node_modules/@embedded-postgres',nativeName);
 if(!await exists(native))throw Error('Missing target PostgreSQL: '+nativeName);
 const symlinks=JSON.parse(await readFile(join(native,'native/pg-symlinks.json'),'utf8').catch(()=>'[]'));
 for(let pass=0;pass<10;pass++)for(const {source,target:link} of symlinks){
  const src=resolve(native,source),dst=resolve(native,link);if([src,dst].some(p=>relative(native,p).startsWith('..')))throw Error('Unsafe native link');
  if(!await exists(dst)&&await exists(src))await cp(src,dst,{recursive:true,dereference:true});
 }
 for(const {target:link} of symlinks)if(!await exists(resolve(native,link)))throw Error('Unresolved native link '+link);
 await mkdir(join(payload,'scripts'),{recursive:true});await cp('scripts/local-cluster.mjs',join(payload,'scripts/local-cluster.mjs'));
 await mkdir(join(payload,'desktop'),{recursive:true});await cp('desktop/runtime.mjs',join(payload,'desktop/runtime.mjs'));
 await cp('output/desktop-compiled',join(payload,'desktop-dist'),{recursive:true});
 await cp('services/api/migrations',join(payload,'desktop-dist/services/api/migrations'),{recursive:true});
 await cp('deployment/demo',join(payload,'desktop-dist/deployment/demo'),{recursive:true});
 for(const app of ['customer','management']){
  const dir=join(payload,'apps',app);await mkdir(dir,{recursive:true});
  await cp(`apps/${app}/.next`,join(dir,'.next'),{recursive:true,filter:src=>!relative(resolve(`apps/${app}/.next`),resolve(src)).split(/[\\/]/).some(p=>['cache','dev','diagnostics'].includes(p))});
  await cp(`apps/${app}/public`,join(dir,'public'),{recursive:true});await cp(`apps/${app}/package.json`,join(dir,'package.json'));
  await writeFile(join(dir,'next.config.mjs'),`export default {compress:false,async rewrites(){return [{source:'/api/v1/:path*',destination:'http://127.0.0.1:4000/api/v1/:path*'},{source:'/uploads/:path*',destination:'http://127.0.0.1:4000/uploads/:path*'}]}};\n`);
 }
 await cp('docs/manuals',join(payload,'manuals'),{recursive:true});await cp('apps/management/public/icon-512.png',join(dest,'icon.png'));
 const archiveName=`node-v${config.nodeVersion}-${target.node}.${target.os==='win32'?'zip':'tar.gz'}`,archive=join(cache,archiveName);
 await download(`https://nodejs.org/dist/v${config.nodeVersion}/${archiveName}`,archive);
 const expected=sums.split('\n').map(s=>s.trim().split(/\s+/)).find(([,name])=>name===archiveName)?.[0];
 if(!expected||createHash('sha256').update(await readFile(archive)).digest('hex')!==expected)throw Error('Node.js checksum mismatch: '+archiveName);
 await run('python',['desktop/package-native.py','extract-node',target.id,archive,payload]);
 await run('go',['build','-buildvcs=false','-trimpath','-ldflags',`-s -w -X main.version=${config.version}`+(target.os==='win32'?' -H=windowsgui':''),'-o',join(dest,target.os==='win32'?'FoodTruckLive.exe':'FoodTruckLive'),'.'],{cwd:join(root,'desktop/launcher'),env:{...process.env,GOOS:target.goos,GOARCH:target.goarch,CGO_ENABLED:'0'}});
 await writeFile(join(dest,'BUILD.json'),JSON.stringify({version:config.version,target:target.id,node:config.nodeVersion,nodeSha256:expected},null,2)+'\n');
 console.log('Prepared '+target.id);
}
