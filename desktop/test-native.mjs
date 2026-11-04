import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,access,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';
import {verifyDemoImages} from './test-demo-images.mjs';
if(process.platform!=='win32')throw Error('This acceptance run targets the Windows installer payload.');
const stage=resolve(process.argv[2]||'output/installers/stage/windows-x64'),exe=join(stage,'FoodTruckLive.exe'),data=resolve('tmp/native-acceptance-'+Date.now()),output=resolve('output/distribution');await mkdir(output,{recursive:true});
const env={...process.env,PATH:join(process.env.SystemRoot||'C:/Windows','System32')};
async function launch(){
 const child=spawn(exe,['--data-dir',data,'--no-browser','--print-control'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='',exited=false;child.stdout.on('data',s=>stdout+=s);child.stderr.on('data',s=>stderr+=s);const done=new Promise(r=>child.once('exit',code=>{exited=true;r(code)}));
 for(let i=0;i<100&&!stdout.includes('/#');i++){if(exited)throw Error(stderr||'Launcher exited');await new Promise(r=>setTimeout(r,100))}
 const address=stdout.trim().split('\n').find(s=>s.startsWith('http://'));assert.ok(address,'control address');const url=new URL(address),token=url.hash.slice(1),base=url.origin;
 const request=(path,body,headers={})=>fetch(base+path,{method:body?'POST':'GET',headers:{'X-Desktop-Token':token,...body?{'content-type':'application/json'}:{},...headers},body:body?JSON.stringify(body):undefined});
 return {child,address,request,done,base};
}
const browser=await chromium.launch({headless:true});let running;
async function stop(){if(!running)return;assert.equal((await running.request('/quit',{})).status,202);assert.equal(await Promise.race([running.done,new Promise(r=>setTimeout(()=>r('timeout'),90000).unref())]),0);running=null}
async function waitForReady(mode){for(let i=0;i<720;i++){const state=await (await running.request('/status')).json();if(state.state==='error')throw Error(state.message);if(state.state==='running'&&state.mode===mode)return state;await new Promise(r=>setTimeout(r,500))}throw Error('Runtime readiness timed out: '+JSON.stringify(await (await running.request('/status')).json()))}
try{
 running=await launch();assert.equal((await fetch(running.base+'/status')).status,403);assert.equal((await running.request('/start',{mode:'demo'},{Origin:'https://example.org'})).status,403);
 const duplicate=spawn(exe,['--data-dir',data,'--no-browser','--print-control'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let duplicateOutput='';duplicate.stdout.on('data',s=>duplicateOutput+=s);assert.equal(await new Promise(r=>duplicate.once('exit',r)),0);assert.equal(duplicateOutput.trim(),running.address);
 const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(running.address);await page.getByRole('heading',{name:'Como pretende começar?'}).waitFor();await page.screenshot({path:join(output,'native-welcome-desktop.png')});await page.setViewportSize({width:375,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(output,'native-welcome-mobile.png'),fullPage:true});await page.reload();assert.equal((await page.request.get(running.base+'/welcome.js')).status(),200);
 await page.getByRole('button',{name:/Abrir demo/}).click();let state=await waitForReady('demo');assert.equal(state.mode,'demo');assert.ok(state.url.endsWith('/demo'));
 assert.equal((await (await fetch('http://127.0.0.1:4000/api/v1/installation/status')).json()).readOnly,false);
 await verifyDemoImages(browser);
 const responseWait=page.waitForResponse(r=>r.url()===running.base+'/start');await page.getByRole('button',{name:/Criar sistema novo/}).click();const modeResponse=await responseWait;assert.equal(modeResponse.status(),202);state=await waitForReady('system');assert.equal(state.mode,'system');const token=new URLSearchParams(new URL(state.url).hash.slice(1)).get('token');assert.ok(token);
 const initialized=await fetch('http://127.0.0.1:4000/api/v1/installation/complete',{method:'POST',headers:{'content-type':'application/json','x-install-token':token},body:JSON.stringify({organization:'Rede nativa',business:'Carrinha nativa',email:'native@example.test',password:'NativeTest2026!'})});assert.equal(initialized.status,200,await initialized.text());
 await stop();await page.close();
 running=await launch();assert.equal((await running.request('/start',{mode:'system'})).status,202);state=await waitForReady('system');assert.equal(state.url,'http://localhost:3001');
 const login=await fetch('http://127.0.0.1:4000/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'native@example.test',password:'NativeTest2026!'})});assert.equal(login.status,200);await stop();
 await access(join(data,'system/postgres/PG_VERSION'));
 console.log('PASS: native Windows launcher, no Node/npm on PATH, private control, single instance, responsive welcome, offline demo, new system, restart/login and clean shutdown.');
}finally{if(running)await stop().catch(()=>{});await browser.close()}
