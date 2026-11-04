import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve,join} from 'node:path';
import {findNpmCli} from '../scripts/npm-cli.mjs';
const root=resolve('.'),tools=resolve('tmp/installer-tools'),mac=join(tools,'macpkg');await mkdir(tools,{recursive:true});
const config=JSON.parse(await readFile('desktop/installer-config.json','utf8'));
function run(command,args,cwd=root){return new Promise((ok,fail)=>{const p=spawn(command,args,{cwd,stdio:'inherit',windowsHide:true});p.once('error',fail);p.once('exit',code=>code===0?ok():fail(Error(command+' failed: '+code)))})}
async function exists(path){try{await access(path);return true}catch{return false}}
if(!await exists(join(mac,'go.mod')))await run('git',['clone','https://github.com/vertex-language/macpkg.git',mac]);
await run('git',['checkout','--detach',config.macpkgCommit],mac);
// The upstream writer uses host filepath separators. Normalize archive paths on Windows.
let code=await readFile(join(mac,'pkg/pkg.go'),'utf8');
if(!code.includes('"path"'))code=code.replace('"path/filepath"','"path/filepath"\n "path"');
code=code.replaceAll('filepath.Clean(k)','path.Clean(filepath.ToSlash(k))').replaceAll('filepath.Clean(rel)','path.Clean(filepath.ToSlash(rel))').replaceAll('filepath.Dir(p)','path.Dir(p)').replaceAll('filepath.Dir(parent)','path.Dir(parent)');
await writeFile(join(mac,'pkg/pkg.go'),code);
let bom=await readFile(join(mac,'pkg/bom/bom.go'),'utf8');
if(!bom.includes('"path"'))bom=bom.replace('"path/filepath"','"path"');
bom=bom.replaceAll('filepath.Clean(e.Path)','path.Clean(strings.ReplaceAll(e.Path, "\\\\", "/"))');
await writeFile(join(mac,'pkg/bom/bom.go'),bom);
await run('go',['build','-o',join(tools,'macpkg.exe'),'./cmd/macpkg'],mac);
const npmTools=join(tools,'npm');await mkdir(npmTools,{recursive:true});
if(!await exists(join(npmTools,'package.json')))await writeFile(join(npmTools,'package.json'),JSON.stringify({name:'foodtruck-installer-tools',version:'1.0.0',private:true,dependencies:{'7zip-bin':'5.2.0'}}));
await run(process.execPath,[findNpmCli(),'install','--ignore-scripts','--no-audit','--no-fund'],npmTools);
const archive=join(tools,'nsis-3.0.4.1.7z');
if(!await exists(archive)){
 const url='https://github.com/electron-userland/electron-builder-binaries/releases/download/nsis-3.0.4.1/nsis-3.0.4.1.7z';
 const response=await fetch(url);if(!response.ok)throw Error('NSIS download: '+response.status);await writeFile(archive,Buffer.from(await response.arrayBuffer()));
}
await run(join(npmTools,'node_modules/7zip-bin/win/x64/7za.exe'),['x','-y','-o'+join(tools,'nsis'),archive]);
console.log('Installer tools ready. macpkg pinned to '+config.macpkgCommit+' with POSIX archive-path normalization.');
