import type {FastifyInstance} from 'fastify';
import {requireMember} from './auth.js';

type Location={address:string;latitude:number;longitude:number};
type Fetcher=(url:string,options:RequestInit)=>Promise<Response>;
const fail=(message:string,statusCode=400):never=>{throw Object.assign(new Error(message),{statusCode});};
export function createGeocoder(fetcher:Fetcher=fetch){
 const cache=new Map<string,{expires:number;data:Location[]}>(),inflight=new Map<string,Promise<Location[]>>();
 let queue=Promise.resolve(),lastRequest=0;
 return async (kind:'search'|'reverse',params:Record<string,string>)=>{
  const base=process.env.GEOCODING_BASE_URL||'https://photon.komoot.io/';
  const url=new URL(kind==='search'?'api/':'reverse',base.endsWith('/')?base:base+'/');
  for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
  url.searchParams.set('limit',kind==='search'?'5':'1');
  const key=url.href,cached=cache.get(key);
  if(cached&&cached.expires>Date.now())return cached.data;
  if(inflight.has(key))return inflight.get(key)!;
  const task=queue.then(async()=>{
   const delay=Math.max(0,1000-(Date.now()-lastRequest));if(delay)await new Promise(r=>setTimeout(r,delay));lastRequest=Date.now();
   try{
    const response=await fetcher(url.href,{headers:{Accept:'application/json','User-Agent':'FoodTruckLive/0.1 event-location-picker'},signal:AbortSignal.timeout(10000)});
    if(!response.ok)fail('A pesquisa de moradas está temporariamente indisponível. Pode escrever a morada ou guardar só as coordenadas.',503);
    const body=await response.json() as any;
    const data:Location[]=(Array.isArray(body.features)?body.features:[]).slice(0,5).flatMap((feature:any)=>{
     const coords=feature.geometry?.coordinates,p=feature.properties||{};
     if(!Array.isArray(coords)||!Number.isFinite(coords[0])||!Number.isFinite(coords[1])||Math.abs(coords[0])>180||Math.abs(coords[1])>90)return [];
     const street=[p.street,p.housenumber].filter(Boolean).join(' '),town=[p.postcode,p.city||p.town||p.village||p.county].filter(Boolean).join(' ');
     const address=[...new Set([street||p.name,town,p.country].filter(v=>typeof v==='string'&&v.trim()))].join(', ').slice(0,200);
     return address?[{address,latitude:coords[1],longitude:coords[0]}]:[];
    });
    if(cache.size>=200)cache.delete(cache.keys().next().value!);
    cache.set(key,{expires:Date.now()+300000,data});return data;
   }catch(e:any){if(e.statusCode)throw e;return fail('Não foi possível obter a morada. Pode preenchê-la manualmente ou guardar só as coordenadas.',503);}
  });
  queue=task.then(()=>{},()=>{});inflight.set(key,task);
  try{return await task;}finally{inflight.delete(key);}
 };
}
export async function eventGeocodingRoutes(app:FastifyInstance,lookup=createGeocoder()){
 const requests=new Map<string,number[]>();
 const base='/api/v1/manage/businesses/:id/events/location';
 app.get(base+'/config',async req=>{
  await requireMember(req,(req.params as any).id);
  return {googleKey:process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY||'',googleMapId:process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID||'DEMO_MAP_ID'};
 });
 for(const kind of ['search','reverse'] as const)app.get(base+'/'+kind,async req=>{
  await requireMember(req,(req.params as any).id);const q=req.query as any,params:Record<string,string>={};
  if(kind==='search'){
   if(typeof q.q!=='string'||q.q.trim().length<3||q.q.length>200)fail('Escreva uma morada com pelo menos 3 caracteres.');
   params.q=q.q.trim();
  }else{
   if(typeof q.lat!=='string'||typeof q.lon!=='string'||!q.lat.trim()||!q.lon.trim())fail('Indique latitude e longitude.');
   const lat=Number(q.lat),lon=Number(q.lon);
   if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)fail('As coordenadas estão fora dos limites válidos.');
   params.lat=lat.toFixed(6);params.lon=lon.toFixed(6);
  }
  const now=Date.now(),user=req.user!.id,recent=(requests.get(user)||[]).filter(t=>t>now-60000);
  if(recent.length>=30)fail('Aguarde um minuto antes de pesquisar mais moradas.',429);
  if(requests.size>1000)for(const [key,times] of requests)if(!times.some(t=>t>now-60000))requests.delete(key);
  requests.set(user,[...recent,now]);
  return {locations:await lookup(kind,params),attribution:'© OpenStreetMap contributors · Photon'};
 });
}

