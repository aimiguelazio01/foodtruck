"use client";
import {useEffect,useRef,useState} from 'react';
import {createEventMap,MapController,MapLocation,Point} from '../lib/event-map';

type Props={business:string;address:string;latitude:string;longitude:string;disabled:boolean;onChange:(values:{address?:string;latitude:string;longitude:string})=>void;onBusy:(busy:boolean)=>void};
const validPoint=(lat:string,lon:string):Point|null=>lat!==''&&lon!==''&&Number.isFinite(Number(lat))&&Number.isFinite(Number(lon))&&Math.abs(Number(lat))<=90&&Math.abs(Number(lon))<=180?{latitude:Number(lat),longitude:Number(lon)}:null;
export default function EventLocationPicker(props:Props){
 const node=useRef<HTMLDivElement>(null),controller=useRef<MapController|null>(null),latest=useRef(props),generation=useRef(0),abort=useRef<AbortController|null>(null);
 latest.current=props;
 const [ready,setReady]=useState(false),[provider,setProvider]=useState('OpenStreetMap'),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[error,setError]=useState(''),[tilesFailed,setTilesFailed]=useState(false),[results,setResults]=useState<MapLocation[]>([]);
 const base='/api/v1/manage/businesses/'+encodeURIComponent(props.business)+'/events/location';
 async function request(path:string,signal?:AbortSignal){const r=await fetch(base+path,{credentials:'include',signal});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.message||'Não foi possível procurar a morada.');return d;}
 function invalidate(){generation.current++;abort.current?.abort();abort.current=null;}
 async function reverse(point:Point){
  if(latest.current.disabled)return;
  invalidate();const ticket=generation.current,initialAddress=latest.current.address;
  const latitude=point.latitude.toFixed(6),longitude=point.longitude.toFixed(6);
  latest.current.onChange({latitude,longitude});controller.current?.setPoint(point);setResults([]);setError('');setStatus('A procurar a morada deste ponto…');setBusy(true);latest.current.onBusy(true);
  const signalController=new AbortController();abort.current=signalController;
  try{
   const locations=controller.current?.geocode?await controller.current.geocode(point):(await request('/reverse?'+new URLSearchParams({lat:latitude,lon:longitude}),signalController.signal)).locations;
   if(ticket!==generation.current)return;
   const current=latest.current,samePoint=current.latitude===latitude&&current.longitude===longitude;
   if(!samePoint)return;
   if(locations?.[0]?.address&&current.address===initialAddress){current.onChange({latitude,longitude,address:locations[0].address});setStatus('Coordenadas e morada preenchidas. Confirme a morada antes de guardar.');}
   else if(current.address!==initialAddress)setStatus('Coordenadas preenchidas. A morada que escreveu foi mantida.');
   else setStatus('Coordenadas preenchidas. Não encontrei uma morada para este ponto; pode escrevê-la ou guardar só as coordenadas.');
  }catch(e){if(ticket===generation.current){setError('Não foi possível obter a morada. As coordenadas continuam preenchidas; pode escrever a morada manualmente.');setStatus('');}}
  finally{if(ticket===generation.current){setBusy(false);latest.current.onBusy(false);}}
 }
 useEffect(()=>{
  let cancelled=false;const requestController=new AbortController();
  request('/config',requestController.signal).then(async config=>{
   if(cancelled||!node.current)return;
   setProvider(config.googleKey?'Google Maps':'OpenStreetMap');
   const map=await createEventMap(node.current,validPoint(latest.current.latitude,latest.current.longitude),point=>{void reverse(point)},config,()=>{if(!cancelled)setTilesFailed(true)},requestController.signal);
   if(cancelled){map.destroy();return;}
   controller.current=map;map.setPoint(validPoint(latest.current.latitude,latest.current.longitude));setReady(true);
  }).catch(e=>{if(!cancelled)setError('Mapa indisponível. Pode escrever a morada ou indicar coordenadas abaixo.');});
  return()=>{cancelled=true;requestController.abort();invalidate();controller.current?.destroy();controller.current=null;latest.current.onBusy(false);};
 },[props.business]);
 useEffect(()=>{controller.current?.setPoint(validPoint(props.latitude,props.longitude));},[props.latitude,props.longitude]);
 async function search(){
  if(props.disabled)return;invalidate();const ticket=generation.current,address=latest.current.address.trim();
  if(address.length<3){setError('Escreva primeiro uma morada com pelo menos 3 caracteres.');return;}
  setBusy(true);props.onBusy(true);setError('');setResults([]);setStatus('A procurar locais para esta morada…');
  const requestController=new AbortController();abort.current=requestController;
  try{
   const locations=controller.current?.geocode?await controller.current.geocode(address):(await request('/search?'+new URLSearchParams({q:address}),requestController.signal)).locations;
   if(ticket!==generation.current)return;if(latest.current.address.trim()!==address){setStatus('A morada foi alterada. Volte a pesquisar.');return;}
   setResults(locations||[]);setStatus(locations?.length?'Escolha um dos locais encontrados para preencher as coordenadas.':'Não encontrei essa morada. Experimente uma morada mais completa ou coloque o pin no mapa.');
  }catch(e){if(ticket===generation.current){setError(e instanceof Error?e.message:'A pesquisa está indisponível.');setStatus('');}}
  finally{if(ticket===generation.current){setBusy(false);latest.current.onBusy(false);}}
 }
 function choose(location:MapLocation){
  invalidate();setBusy(false);props.onBusy(false);props.onChange({address:location.address,latitude:location.latitude.toFixed(6),longitude:location.longitude.toFixed(6)});controller.current?.setPoint(location);setResults([]);setStatus('Morada e coordenadas preenchidas. Pode ajustar o pin ou editar a morada.');setError('');
 }
 return <div className="event-location-picker">
  <div className="event-map-tools"><button type="button" disabled={props.disabled||busy||props.address.trim().length<3} onClick={search}>Localizar morada no mapa</button><a href={'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(validPoint(props.latitude,props.longitude)?props.latitude+','+props.longitude:props.address||'Lisboa, Portugal')} target="_blank" rel="noopener noreferrer">Abrir no Google Maps</a></div>
  <p className="muted">Escreva a morada acima e procure-a, ou clique no mapa e arraste o pin. Para usar o teclado, mova o mapa com as setas e escolha «Colocar pin no centro».</p>
  <div ref={node} className="event-pin-map" role="region" aria-label={'Mapa interativo do evento — '+provider} aria-busy={!ready}/>
  {!ready&&!error&&<p role="status">A carregar o mapa…</p>}
  {ready&&<div className="event-map-tools"><button type="button" disabled={props.disabled} onClick={()=>{const point=controller.current?.center();if(point)void reverse(point);}}>Colocar pin no centro do mapa</button><span className="muted">Mapa: {provider}</span></div>}
  {tilesFailed&&<p className="notice">Não foi possível carregar algumas partes do mapa. Pode usar os campos de morada e coordenadas.</p>}
  {status&&<p role="status" className="event-map-status">{status}</p>}
  {error&&<p role="alert" className="notice error">{error}</p>}
  {!!results.length&&<ul className="event-map-results" aria-label="Locais encontrados">{results.map((location,index)=><li key={index}><button type="button" disabled={props.disabled} onClick={()=>choose(location)}>{location.address}</button></li>)}</ul>}
  <p className="muted">A morada sugerida pode precisar de ajuste. Pode guardar a morada, as coordenadas ou ambas.{provider==='OpenStreetMap'&&<> Pesquisa de moradas: <a href="https://photon.komoot.io" target="_blank" rel="noopener noreferrer">Photon</a> / <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>.</>}</p>
 </div>;
}
