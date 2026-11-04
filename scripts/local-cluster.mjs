// EmbeddedPostgres supplies binaries/initdb. pg_ctl performs a clean shutdown on Windows.
import EmbeddedPostgres from 'embedded-postgres';
import {spawn} from 'node:child_process';
import {dirname,join} from 'node:path';
export default class LocalCluster{
 constructor(options){this.options=options;this.embedded=new EmbeddedPostgres({...options,autoRehydrateSymlinks:process.platform!=='win32'});}
 initialise(){return this.embedded.initialise()}
 getPgClient(database='postgres'){return this.embedded.getPgClient(database,'127.0.0.1')}
 async createDatabase(name){if(!/^[a-z_]+$/.test(name))throw Error('Invalid local database name');const c=this.getPgClient();await c.connect();try{await c.query('CREATE DATABASE "'+name+'"')}finally{await c.end()}}
 async start(){
  const native=await import(`@embedded-postgres/${process.platform==='win32'?'windows':process.platform}-${process.arch}`);
  this.pgCtl=native.pg_ctl||join(dirname(native.postgres),process.platform==='win32'?'pg_ctl.exe':'pg_ctl');
  const p=spawn(native.postgres,['-D',this.options.databaseDir,'-p',String(this.options.port),'-h','127.0.0.1',...(process.platform==='win32'?['-c','io_method=sync']:[])],{stdio:['ignore','ignore','pipe'],windowsHide:true,detached:process.platform!=='win32'});this.child=p;
  let failed=false;p.once('error',()=>{failed=true});p.stderr.on('data',data=>{this.diagnostics=((this.diagnostics||'')+data).slice(-8000);});
  for(let i=0;i<120;i++){
   if(failed||p.exitCode!==null)throw Error('PostgreSQL não iniciou. Verifique a pasta de dados e a porta.');
   const c=this.getPgClient();try{await c.connect();await c.end();return}catch{await c.end().catch(()=>{})}
   await new Promise(r=>setTimeout(r,250));
  }
  throw Error('PostgreSQL não ficou disponível.');
 }
 async stop(){
  const p=this.child;if(!p||p.exitCode!==null)return;
  await new Promise((ok,fail)=>{let output='';const ctl=spawn(this.pgCtl,['stop','-D',this.options.databaseDir,'-m','fast','-w','-t','60'],{stdio:['ignore','pipe','pipe'],windowsHide:true});ctl.stdout.on('data',data=>output+=data);ctl.stderr.on('data',data=>output+=data);ctl.once('error',fail);ctl.once('close',code=>code===0?ok():fail(Error('PostgreSQL: '+output+'\n'+(this.diagnostics||'').slice(-2000))))});
  if(p.exitCode===null)await new Promise(r=>p.once('exit',r));this.child=null;
 }
}
