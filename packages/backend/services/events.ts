import {WriteConflict,audit,changed,fail,newId,type Db,type Param} from '../db/port.js';

const text=(value:unknown,label:string,max:number,optional=false):string=>{if(typeof value!=='string'||value.length>max||!optional&&!value.trim())fail('Verifique '+label+'.');return (value as string).trim();};

export interface EventInput{
 method:'POST'|'PATCH';businessId:string;eventId?:string;body:Record<string,any>;userId:string;
 /** Called for a different destination truck; must throw HttpError(403) when the actor may not manage it. */
 authorizeTarget:(businessId:string)=>Promise<void>;
}

interface EventRow{id:string;title:string;address:string;starts_at:number;ends_at:number;is_public:number;type:string;venue_name:string;latitude:number|null;longitude:number|null;version:number}

export async function listEvents(db:Db,businessId:string){
 return db.all('SELECT * FROM events WHERE business_id=? ORDER BY starts_at,id',[businessId]);
}

export async function saveEvent(db:Db,{method,businessId:id,eventId,body,userId,authorizeTarget}:EventInput):Promise<{ok:true;id:string;business_id:string}>{
 const b=body||{};
 const target=b.business_id===undefined?id:text(b.business_id,'a carrinha',100);
 if(target!==id)await authorizeTarget(target);
 for(const truck of new Set([id,target])){
  if(await db.first('SELECT 1 AS ok FROM organization_trucks WHERE business_id=? AND archived',[truck]))fail('Reative a carrinha antes de alterar os seus eventos.',409);
 }
 const current=method==='PATCH'?await db.first<EventRow>('SELECT * FROM events WHERE id=? AND business_id=?',[eventId??'',id]):null;
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
 if(await db.first('SELECT 1 AS ok FROM events WHERE business_id=? AND id<>? AND starts_at<? AND ends_at>?',[target,eventId??'',end,start]))fail('Esta carrinha já tem um evento nesse horário. Escolha outro período.',409);

 const archived=(placeholder:string)=>`NOT EXISTS (SELECT 1 FROM organization_trucks WHERE business_id=${placeholder} AND archived)`;
 const overlap=`NOT EXISTS (SELECT 1 FROM events o WHERE o.business_id=? AND o.id<>? AND o.starts_at<? AND o.ends_at>?)`;
 const entityId=eventId||newId(),now=Date.now(),trucks=[...new Set([id,target])];
 const values:Param[]=[title,address,start,end,published,type,venue,lat,lon];
 let write;
 if(!current){
  write={sql:`INSERT INTO events(id,business_id,title,address,starts_at,ends_at,is_public,type,venue_name,latitude,longitude)
   SELECT ?,?,CAST(? AS text),CAST(? AS text),CAST(? AS bigint),CAST(? AS bigint),CAST(? AS integer),CAST(? AS text),CAST(? AS text),CAST(? AS double precision),CAST(? AS double precision)
   WHERE ${overlap} AND ${archived('?')}`,
   params:[entityId,target,...values,target,entityId,end,start,target],expectChanges:1};
 }else{
  const moving=target!==id;
  if(moving&&(await db.first('SELECT 1 AS ok FROM orders WHERE event_id=? UNION ALL SELECT 1 FROM event_products WHERE event_id=? LIMIT 1',[entityId,entityId])))fail('Este evento tem encomendas ou um menu associado. Crie outro evento na carrinha de destino.',409);
  const differs=moving||start!==current.starts_at||end!==current.ends_at||address!==current.address||lat!==current.latitude||lon!==current.longitude||published!==current.is_public;
  const inFlight=`SELECT 1 FROM orders WHERE business_id=? AND (event_id=? OR (pickup_at>=? AND pickup_at<?)) AND status NOT IN ('cancelled','collected')`;
  if(differs&&await db.first(inFlight+' LIMIT 1',[id,entityId,current.starts_at,current.ends_at]))fail('O evento tem encomendas em curso. Conclua-as ou cancele-as antes de alterar o horário, a localização ou a publicação.',409);
  const guards=[overlap,archived('?'),archived('?')];
  const guardParams:Param[]=[target,entityId,end,start,target,id];
  if(differs){guards.push(`NOT EXISTS (${inFlight})`);guardParams.push(id,entityId,current.starts_at,current.ends_at);}
  if(moving){guards.push('NOT EXISTS (SELECT 1 FROM orders WHERE event_id=?)','NOT EXISTS (SELECT 1 FROM event_products WHERE event_id=?)');guardParams.push(entityId,entityId);}
  write={sql:`UPDATE events SET business_id=?,title=?,address=?,starts_at=?,ends_at=?,is_public=?,type=?,venue_name=?,latitude=?,longitude=?
   WHERE id=? AND business_id=? AND version=? AND ${guards.join(' AND ')}`,
   params:[target,...values,entityId,id,current.version,...guardParams],expectChanges:1};
 }
 try{
  await db.batch([write,...trucks.flatMap(truck=>[audit(truck,userId,'events:'+(method==='POST'?'create:':'update:')+entityId,now),changed(truck,now)])]);
 }catch(error){
  if(error instanceof WriteConflict)fail('O evento ou a carrinha foi alterado entretanto. Atualize e tente novamente.',409);
  throw error;
 }
 return {ok:true,id:entityId,business_id:target};
}
