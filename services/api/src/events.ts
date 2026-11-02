import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import {pool} from './db.js';
import {requireMember} from './auth.js';
import {notify} from './orders.js';
const fail=(message:string,statusCode=400):never=>{throw Object.assign(new Error(message),{statusCode});};
function text(value:unknown,label:string,max:number,optional=false){if(typeof value!=='string'||value.length>max||!optional&&!value.trim())fail('Verifique '+label+'.');return (value as string).trim();}
export async function eventRoutes(app:FastifyInstance){
 app.get('/api/v1/manage/businesses/:id/events',async req=>{const {id}=req.params as any;await requireMember(req,id);return {events:(await pool.query('SELECT * FROM events WHERE business_id=$1 ORDER BY starts_at,id',[id])).rows};});
 for(const method of ['POST','PATCH'] as const)app.route({method,url:'/api/v1/manage/businesses/:id/events'+(method==='PATCH'?'/:eventId':''),handler:async req=>{
  const {id,eventId}=req.params as any,b=(req.body||{}) as any;await requireMember(req,id);
  const target=b.business_id===undefined?id:text(b.business_id,'a carrinha',100);
  if(target!==id)await requireMember(req,target);
  const c=await pool.connect();
  try{
   await c.query('BEGIN');for(const truckId of [...new Set([id,target])].sort())await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[truckId]);
   if((await c.query('SELECT 1 FROM organization_trucks WHERE business_id=ANY($1::text[]) AND archived',[[id,target]])).rowCount)fail('Reative a carrinha antes de alterar os seus eventos.',409);
   const current=method==='PATCH'?(await c.query('SELECT * FROM events WHERE id=$1 AND business_id=$2 FOR UPDATE',[eventId,id])).rows[0]:null;
   if(method==='PATCH'&&!current)fail('Evento não encontrado nesta carrinha.',404);
   if(current&&b.version!==undefined&&b.version!==current.version)fail('O evento foi alterado. Volte a selecioná-lo antes de guardar.',409);
   const title=text(b.title??current?.title,'o título do evento',100);
   const address=text(b.address??current?.address??'','a morada',200,true);
   const venue=text(b.venue_name??current?.venue_name??'','o nome do local',100,true);
   const type=text(b.type??current?.type??'market','o tipo de evento',20);
   const start=b.starts_at??current?.starts_at,end=b.ends_at??current?.ends_at,published=b.is_public??current?.is_public??1;
   if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end>8640000000000000||end<=start)fail('Indique um início válido e um fim posterior ao início.');
   if(![0,1].includes(published))fail('Publicação: escolha Rascunho ou Publicado.');
   const lat=b.latitude===undefined?(current?.latitude??null):b.latitude,lon=b.longitude===undefined?(current?.longitude??null):b.longitude;
   if((lat===null)!==(lon===null)||lat!==null&&(typeof lat!=='number'||!Number.isFinite(lat)||lat< -90||lat>90)||lon!==null&&(typeof lon!=='number'||!Number.isFinite(lon)||lon< -180||lon>180))fail('Indique latitude entre −90 e 90 e longitude entre −180 e 180, ou deixe ambas vazias.');
   if(!address&&lat===null)fail('Indique uma morada, escolha um ponto no mapa ou preencha as coordenadas.');
   if((await c.query('SELECT 1 FROM events WHERE business_id=$1 AND id<>$2 AND starts_at<$4 AND ends_at>$3',[target,eventId||'',start,end])).rowCount)fail('Esta carrinha já tem um evento nesse horário. Escolha outro período.',409);
   if(current){
    const moving=target!==id;
    if(moving&&(await c.query('SELECT 1 FROM orders WHERE event_id=$1 UNION ALL SELECT 1 FROM event_products WHERE event_id=$1 LIMIT 1',[eventId])).rowCount)fail('Este evento tem encomendas ou um menu associado. Crie outro evento na carrinha de destino.',409);
    const changed=moving||start!==current.starts_at||end!==current.ends_at||address!==current.address||lat!==current.latitude||lon!==current.longitude||published!==current.is_public;
    if(changed&&(await c.query("SELECT 1 FROM orders WHERE business_id=$1 AND (event_id=$2 OR (pickup_at >= $3 AND pickup_at < $4)) AND status NOT IN ('cancelled','collected') LIMIT 1",[id,eventId,current.starts_at,current.ends_at])).rowCount)fail('O evento tem encomendas em curso. Conclua-as ou cancele-as antes de alterar o horário, a localização ou a publicação.',409);
   }
   const entityId=eventId||randomUUID();
   if(method==='POST')await c.query('INSERT INTO events(id,business_id,title,address,starts_at,ends_at,is_public,type,venue_name,latitude,longitude) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[entityId,target,title,address,start,end,published,type,venue,lat,lon]);
   else await c.query('UPDATE events SET business_id=$2,title=$3,address=$4,starts_at=$5,ends_at=$6,is_public=$7,type=$8,venue_name=$9,latitude=$10,longitude=$11 WHERE id=$1',[entityId,target,title,address,start,end,published,type,venue,lat,lon]);
   for(const truckId of [...new Set([id,target])]){await c.query('INSERT INTO audit_events VALUES($1,$2,$3,$4,$5)',[randomUUID(),truckId,req.user!.id,'events:'+(method==='POST'?'create:':'update:')+entityId,Date.now()]);await notify(c,truckId);}
   await c.query('COMMIT');return {ok:true,id:entityId,business_id:target};
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }});
}
