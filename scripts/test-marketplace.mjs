import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,existsSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {extractZip} from './marketplace-start.mjs';
import {findNpmCli} from './npm-cli.mjs';
function zip(entries){
 const local=[],central=[];let offset=0,size=0;
 for(const [name,content] of entries){
  const filename=Buffer.from('foodtruck/'+name),data=deflateRawSync(content),head=Buffer.alloc(30),index=Buffer.alloc(46);
  head.writeUInt32LE(0x04034b50);head.writeUInt16LE(8,8);head.writeUInt32LE(data.length,18);head.writeUInt32LE(content.length,22);head.writeUInt16LE(filename.length,26);
  index.writeUInt32LE(0x02014b50);index.writeUInt16LE(8,10);index.writeUInt32LE(data.length,20);index.writeUInt32LE(content.length,24);index.writeUInt16LE(filename.length,28);index.writeUInt32LE(offset,42);
  local.push(head,filename,data);central.push(index,filename);offset+=head.length+filename.length+data.length;size+=index.length+filename.length;
 }
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(size,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,...central,end]);
}
function fixture(name='README.md',digest){const data=Buffer.from('Olá — Food Truck Live');const files={[name]:digest||createHash('sha256').update(data).digest('hex')};return zip([[name,data],['RELEASE-MANIFEST.json',Buffer.from(JSON.stringify({version:'test',files}))]])}
test('extracts and verifies UTF-8 content without external tools',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'foodtruck-zip-'));try{extractZip(fixture('guia/introdução.md'),dir);assert.equal(readFileSync(path.join(dir,'guia/introdução.md'),'utf8'),'Olá — Food Truck Live')}finally{rmSync(dir,{recursive:true})}
});
test('rejects traversal and damaged contents before writing files',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'foodtruck-invalid-'));try{assert.throws(()=>extractZip(fixture('../escape.md'),dir),/permitidos/);assert.throws(()=>extractZip(fixture('README.md','0'.repeat(64)),dir),/danificado/);assert.equal(existsSync(path.join(dir,'README.md')),false)}finally{rmSync(dir,{recursive:true})}
});
for(const [name,paths,execPath,npm,pathEnv] of [
 ['Windows',path.win32,'C:\\Program Files\\nodejs\\node.exe','C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js',''],
 ['macOS',path.posix,'/usr/local/bin/node','/usr/local/lib/node_modules/npm/bin/npm-cli.js',''],
 ['Linux',path.posix,'/usr/bin/node','/usr/share/nodejs/npm/bin/npm-cli.js',''],
 ['npm symlink',path.posix,'/opt/custom/node','/opt/npm/lib/npm-cli.js','/opt/tools/bin']
])test('finds npm: '+name,()=>{assert.equal(findNpmCli({execPath,env:{PATH:pathEnv},paths,exists:p=>p===npm||p==='/opt/tools/bin/npm',realpath:()=>npm}),npm)});
test('reports missing npm clearly',()=>assert.throws(()=>findNpmCli({env:{},exists:()=>false}),/npm/));
test('generated starter extracts real release, reuses it and rejects mismatched ZIP',()=>{
 const version=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
 const release=path.resolve('release/marketplace'),name=`Food_Truck_Live-${version}.zip`;
 if(!existsSync(path.join(release,name)))throw Error('Execute npm run package:release antes de test:marketplace.');
 const dir=mkdtempSync(path.join(tmpdir(),'foodtruck-starter-'));
 try{
  writeFileSync(path.join(dir,'INICIAR.mjs'),readFileSync(path.join(release,'INICIAR.mjs')));writeFileSync(path.join(dir,name),readFileSync(path.join(release,name)));
  const run=()=>spawnSync(process.execPath,[path.join(dir,'INICIAR.mjs'),'--extract-only'],{encoding:'utf8'});
  const first=run();assert.equal(first.status,0,first.stderr);const app=first.stdout.match(/Aplicação extraída: (.+)/)?.[1].trim();assert.ok(app);assert.ok(existsSync(path.join(app,'scripts/launch.mjs')));
  mkdirSync(path.join(dir,'.foodtruck/data/system'),{recursive:true});writeFileSync(path.join(dir,'.foodtruck/data/system/keep.txt'),'preserve');
  assert.equal(run().status,0);assert.equal(readFileSync(path.join(dir,'.foodtruck/data/system/keep.txt'),'utf8'),'preserve');
  writeFileSync(path.join(dir,name),'damaged');const invalid=run();assert.equal(invalid.status,1);assert.match(invalid.stderr,/danificado/);assert.equal(readFileSync(path.join(dir,'.foodtruck/data/system/keep.txt'),'utf8'),'preserve');
 }finally{rmSync(dir,{recursive:true})}
});
