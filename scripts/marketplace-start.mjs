#!/usr/bin/env node
// Generated as INICIAR.mjs beside the ZIP. Requires only Node.js built-ins.
import {readFileSync,writeFileSync,existsSync,mkdirSync,renameSync,unlinkSync,lstatSync} from 'node:fs';
import {dirname,resolve,join,isAbsolute,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import {spawn} from 'node:child_process';
const ARCHIVE='__FOODTRUCK_ARCHIVE__';
const ARCHIVE_SHA256='__FOODTRUCK_SHA256__';
const VERSION='__FOODTRUCK_VERSION__';
const hash=data=>createHash('sha256').update(data).digest('hex');
export function extractZip(buffer,destination){
 let end=-1;
 for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50&&i+22+buffer.readUInt16LE(i+20)===buffer.length){end=i;break}
 if(end<0)throw Error('O ficheiro ZIP é inválido.');
 const count=buffer.readUInt16LE(end+10),size=buffer.readUInt32LE(end+12);let cursor=buffer.readUInt32LE(end+16);
 if(buffer.readUInt16LE(end+4)||buffer.readUInt16LE(end+6)||count!==buffer.readUInt16LE(end+8)||cursor+size!==end)throw Error('Formato ZIP não suportado.');
 const files=new Map();let total=0;
 for(let n=0;n<count;n++){
  if(cursor+46>end||buffer.readUInt32LE(cursor)!==0x02014b50)throw Error('Índice ZIP inválido.');
  const flags=buffer.readUInt16LE(cursor+8),method=buffer.readUInt16LE(cursor+10),compressed=buffer.readUInt32LE(cursor+20),length=buffer.readUInt32LE(cursor+24);
  const nameLength=buffer.readUInt16LE(cursor+28),extra=buffer.readUInt16LE(cursor+30),comment=buffer.readUInt16LE(cursor+32),offset=buffer.readUInt32LE(cursor+42);
  const name=buffer.subarray(cursor+46,cursor+46+nameLength).toString('utf8');
  const mode=buffer.readUInt32LE(cursor+38)>>>16;
  if(flags&1||![0,8].includes(method)||(mode&0xf000)===0xa000||!name.startsWith('foodtruck/')||name.includes('\\')||name.includes('\0')||name.includes(':')||name.split('/').some(p=>p==='..'||p==='.'||!p)||files.has(name.slice(10)))throw Error('Caminho ou entrada ZIP não permitidos.');
  total+=length;if(length>512*1024*1024||total>2*1024*1024*1024)throw Error('O pacote excede o limite de extração.');
  if(offset+30>cursor||buffer.readUInt32LE(offset)!==0x04034b50)throw Error('Entrada ZIP inválida.');
  const localNameLength=buffer.readUInt16LE(offset+26),localExtra=buffer.readUInt16LE(offset+28);
  if(buffer.subarray(offset+30,offset+30+localNameLength).toString('utf8')!==name)throw Error('Nomes ZIP inconsistentes.');
  const start=offset+30+localNameLength+localExtra;if(start+compressed>cursor)throw Error('Conteúdo ZIP inválido.');
  const content=method===0?buffer.subarray(start,start+compressed):inflateRawSync(buffer.subarray(start,start+compressed),{maxOutputLength:Math.max(1,length)});
  if(content.length!==length)throw Error('Tamanho ZIP inconsistente.');
  files.set(name.slice(10),content);cursor+=46+nameLength+extra+comment;
 }
 if(cursor!==end)throw Error('Índice ZIP inconsistente.');
 const manifest=JSON.parse(files.get('RELEASE-MANIFEST.json')?.toString('utf8')||'null');
 if(!manifest?.files||files.size!==Object.keys(manifest.files).length+1)throw Error('Manifesto do pacote inválido.');
 for(const [name,digest] of Object.entries(manifest.files))if(!files.has(name)||hash(files.get(name))!==digest)throw Error('Ficheiro danificado: '+name);
 // Validate everything before creating any application file.
 for(const [name,content] of files){
  const target=resolve(destination,name),path=relative(destination,target);
  if(isAbsolute(path)||path==='..'||path.startsWith('..'+sep))throw Error('Caminho fora da instalação.');
  mkdirSync(dirname(target),{recursive:true});writeFileSync(target,content,{flag:'wx'});
 }
 return manifest;
}
export function installPayload(folder){
 const archive=join(folder,ARCHIVE);if(!existsSync(archive))throw Error('Coloque '+ARCHIVE+' na mesma pasta que INICIAR.mjs.');
 console.log('A verificar o pacote…');const buffer=readFileSync(archive);
 if(hash(buffer)!==ARCHIVE_SHA256)throw Error('O ZIP não corresponde ao iniciador ou está danificado. Descarregue novamente os dois ficheiros da mesma versão.');
 const base=join(folder,'.foodtruck');
 if(existsSync(base)&&lstatSync(base).isSymbolicLink())throw Error('A pasta .foodtruck não pode ser uma ligação simbólica.');
 const releases=join(base,'releases');mkdirSync(releases,{recursive:true});
 if(lstatSync(releases).isSymbolicLink())throw Error('A pasta releases não pode ser uma ligação simbólica.');
 const target=join(releases,VERSION+'-'+ARCHIVE_SHA256.slice(0,12)),marker=join(target,'.installed-sha256');
 if(existsSync(marker)&&readFileSync(marker,'utf8')===ARCHIVE_SHA256)return {app:target,data:join(base,'data')};
 if(existsSync(target))throw Error('Instalação incompleta encontrada. Os dados em .foodtruck/data foram preservados.');
 const staging=join(releases,'.staging-'+randomUUID());mkdirSync(staging);
 console.log('A descompactar a aplicação…');const manifest=extractZip(buffer,staging);
 if(manifest.version!==VERSION)throw Error('Versão do manifesto incorreta.');
 writeFileSync(join(staging,'.installed-sha256'),ARCHIVE_SHA256,{flag:'wx'});renameSync(staging,target);
 return {app:target,data:join(base,'data')};
}
async function main(){
 if(process.argv.includes('--help')){console.log('Food Truck Live\nColoque INICIAR.mjs e '+ARCHIVE+' na mesma pasta.\nExecute: node INICIAR.mjs\nOpções: --demo | --system | --no-browser\nRequer Node.js 24 com npm; Windows x64, macOS x64/Apple Silicon ou Linux x64/ARM64.');return}
 if(Number(process.versions.node.split('.')[0])<24)throw Error('Instale Node.js 24 LTS com npm: https://nodejs.org');
 if(!['win32:x64','darwin:x64','darwin:arm64','linux:x64','linux:arm64'].includes(process.platform+':'+process.arch))throw Error('Esta plataforma não é suportada pelo pacote local.');
 if(process.platform!=='win32'&&process.getuid?.()===0)throw Error('Execute com a sua conta de utilizador, sem sudo/root.');
 const folder=dirname(fileURLToPath(import.meta.url)),base=join(folder,'.foodtruck');if(existsSync(base)&&lstatSync(base).isSymbolicLink())throw Error('A pasta .foodtruck não pode ser uma ligação simbólica.');mkdirSync(base,{recursive:true});
 const lock=join(base,'installer.lock');let owned=false,installed;
 try{
  if(existsSync(lock)){const pid=Number(readFileSync(lock,'utf8'));let active=true;try{process.kill(pid,0)}catch(e){if(e.code==='ESRCH')active=false}if(active)throw Error('Outro iniciador está a preparar a aplicação.');unlinkSync(lock)}
  writeFileSync(lock,String(process.pid),{flag:'wx',mode:0o600});owned=true;installed=installPayload(folder);
 }finally{if(owned)unlinkSync(lock)}
 if(process.argv.includes('--extract-only')){console.log('Aplicação extraída: '+installed.app);return}
 const child=spawn(process.execPath,[join(installed.app,'scripts/launch.mjs'),...process.argv.slice(2)],{cwd:installed.app,env:{...process.env,FOODTRUCK_DATA_ROOT:installed.data},stdio:['inherit','inherit','inherit','ipc'],windowsHide:true});
 const stop=()=>{if(child.connected)child.send('foodtruck:stop')};
 for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.on(signal,stop);
 process.on('message',message=>{if(message==='foodtruck:stop')stop()});
 child.once('error',()=>{console.error('Não foi possível arrancar a aplicação.');process.exitCode=1;if(process.connected)process.disconnect()});
 child.once('exit',code=>{process.exitCode=code??1;if(process.connected)process.disconnect()});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1});
