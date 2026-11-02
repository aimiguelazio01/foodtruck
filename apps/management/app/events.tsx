"use client";
import EventLocationPicker from './event-location';
import {useEffect,useRef,useState} from 'react';
import {eventTimestamp,localDateInput,mapsCoordinates} from '../lib/event-form';

type Truck={id:string;name:string;archived?:boolean;isAdmin?:boolean;permissions?:Record<string,boolean>};
type Event={id:string;business_id:string;title:string;address:string;starts_at:number;ends_at:number;is_public:number;type:string;venue_name?:string;latitude?:number|null;longitude?:number|null;version:number};
type Props={business:string;businesses:Truck[];rows:Event[];onSaved:(business:string)=>Promise<void>};
const blank=(business:string)=>({business_id:business,title:'',venue_name:'',address:'',starts_at:'',ends_at:'',is_public:'1',type:'market',latitude:'',longitude:''});
const when=(value:number)=>new Intl.DateTimeFormat('pt-PT',{timeZone:'Europe/Lisbon',dateStyle:'medium',timeStyle:'short'}).format(Number(value));
export default function Events({business,businesses,rows,onSaved}:Props){
 const [form,setForm]=useState(()=>blank(business)),[editing,setEditing]=useState<Event|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[maps,setMaps]=useState('');
 const [locationBusy,setLocationBusy]=useState(false),[showEditor,setShowEditor]=useState(false);
 const createButton=useRef<HTMLButtonElement>(null);
 const heading=useRef<HTMLHeadingElement>(null);
 const visibleRows=rows.filter(event=>event.business_id===business);
 const trucks=businesses.filter(t=>!t.archived&&(t.isAdmin||t.permissions?.calendar));
 const change=(key:keyof typeof form,value:string)=>setForm(current=>({...current,[key]:value}));
 function reset(){setEditing(null);setForm(blank(business));setMaps('');setError('');setMessage('');}
 function edit(event:Event){setShowEditor(true);setEditing({...event});setForm({business_id:event.business_id,title:event.title,venue_name:event.venue_name||'',address:event.address,starts_at:localDateInput(Number(event.starts_at)),ends_at:localDateInput(Number(event.ends_at)),is_public:String(event.is_public),type:event.type,latitude:event.latitude==null?'':String(event.latitude),longitude:event.longitude==null?'':String(event.longitude)});setMaps('');setMessage('');setError('');}
 useEffect(()=>{if(showEditor){heading.current?.focus();heading.current?.scrollIntoView({block:'nearest'});}else{createButton.current?.focus({preventScroll:true});createButton.current?.scrollIntoView({block:'nearest'});}},[editing,showEditor]);
 function importCoordinates(){try{const [lat,lon]=mapsCoordinates(maps);setForm(current=>({...current,latitude:String(lat),longitude:String(lon)}));setError('');setMessage('Coordenadas preenchidas. Guarde o evento para as publicar.');}catch(e){setError(e instanceof Error?e.message:'Verifique as coordenadas.');}}
 async function submit(e:React.FormEvent){
  e.preventDefault();setError('');setMessage('');
  try{
   const start=eventTimestamp(form.starts_at),end=eventTimestamp(form.ends_at);
   if(end<=start)throw Error('A data e hora de fim devem ser posteriores ao início.');
   if((form.latitude==='')!==(form.longitude===''))throw Error('Preencha latitude e longitude, ou deixe ambas vazias.');
   const lat=form.latitude===''?null:Number(form.latitude),lon=form.longitude===''?null:Number(form.longitude);
   if(lat!==null&&(!Number.isFinite(lat)||lat< -90||lat>90)||lon!==null&&(!Number.isFinite(lon)||lon< -180||lon>180))throw Error('Verifique os limites de latitude e longitude.');
   if(!form.address.trim()&&lat===null)throw Error('Escreva uma morada ou escolha um ponto no mapa.');
   setBusy(true);const source=editing?business:form.business_id;
   const r=await fetch('/api/v1/manage/businesses/'+encodeURIComponent(source)+'/events'+(editing?'/'+encodeURIComponent(editing.id):''),{method:editing?'PATCH':'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({...form,starts_at:start,ends_at:end,is_public:Number(form.is_public),latitude:lat,longitude:lon,...editing?{version:editing.version}:{}})});
   const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.message||'Não foi possível guardar o evento.');
   setMessage(form.is_public==='1'?'Evento guardado e publicado no menu dos clientes.':'Rascunho guardado. O evento não está visível para os clientes.');
   setShowEditor(false);setEditing(null);setForm(blank(form.business_id));setMaps('');await onSaved(form.business_id);
  }catch(e){setError(e instanceof Error?e.message:'Não foi possível guardar.');}finally{setBusy(false);}
 }
 const latitude=Number(form.latitude),longitude=Number(form.longitude);
 const hasLocation=form.latitude!==''&&form.longitude!==''&&Number.isFinite(latitude)&&Number.isFinite(longitude)&&Math.abs(latitude)<=90&&Math.abs(longitude)<=180;
 return <section className="events-workspace" aria-label="Gestão de eventos">
  <article className="panel event-list"><div className="section-heading"><h2>Eventos da carrinha</h2><button ref={createButton} disabled={busy} onClick={()=>{reset();setShowEditor(true);}}>Criar evento</button></div>
   <p className="muted">Os horários são apresentados na hora de Portugal continental.</p>{message&&!showEditor&&<p role="status" className="notice">{message}</p>}
   {visibleRows.length?visibleRows.map(event=><div className="event-entry" key={event.id}><div><h3>{event.title}</h3><p>{event.venue_name&&<strong>{event.venue_name} · </strong>}{event.address}</p><p>{when(event.starts_at)} — {when(event.ends_at)}</p><span className={'event-publication '+(event.is_public?'published':'draft')}>{event.is_public?'Publicado':'Rascunho'}</span></div><div className="event-actions"><button disabled={busy} aria-label={'Editar evento '+event.title} onClick={()=>edit(event)}>Editar evento</button>{event.latitude!=null&&event.longitude!=null&&<a href={'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(event.latitude+','+event.longitude)} target="_blank" rel="noopener noreferrer">Ver no Google Maps</a>}</div></div>):<p>Ainda não existem eventos nesta carrinha. Selecione Criar evento para adicionar a primeira paragem.</p>}
  </article>
  {showEditor&&<article className="panel event-editor"><div className="section-heading"><h2 ref={heading} tabIndex={-1}>{editing?'Editar evento':'Criar evento'}</h2><button disabled={busy} onClick={()=>{reset();setShowEditor(false);}}>{editing?'Cancelar edição':'Fechar formulário'}</button></div>
   {error&&<p role="alert" className="notice error">{error}</p>}{message&&<p role="status" className="notice">{message}</p>}
   <form onSubmit={submit}><fieldset disabled={busy} className="event-fields">
    <label htmlFor="event-truck">Carrinha</label><select id="event-truck" value={form.business_id} onChange={e=>change('business_id',e.target.value)} required>{trucks.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select>
    <label htmlFor="event-title">Título do evento</label><input id="event-title" value={form.title} onChange={e=>change('title',e.target.value)} required maxLength={100} placeholder="Ex.: Festival de comida de rua"/>
    <label htmlFor="event-venue">Nome do local (opcional)</label><input id="event-venue" value={form.venue_name} onChange={e=>change('venue_name',e.target.value)} maxLength={100} placeholder="Ex.: Parque das Nações"/>
    <label htmlFor="event-address">Morada</label><input id="event-address" value={form.address} onChange={e=>change('address',e.target.value)} maxLength={200} aria-describedby="event-location-help" autoComplete="street-address"/>
    <label htmlFor="event-start">Início — hora de Portugal</label><input id="event-start" type="datetime-local" value={form.starts_at} onChange={e=>change('starts_at',e.target.value)} required/>
    <label htmlFor="event-end">Fim — hora de Portugal</label><input id="event-end" type="datetime-local" value={form.ends_at} onChange={e=>change('ends_at',e.target.value)} required/>
    <label htmlFor="event-publication">Publicação</label><select id="event-publication" value={form.is_public} onChange={e=>change('is_public',e.target.value)}><option value="0">Rascunho — apenas na gestão</option><option value="1">Publicado — visível para os clientes</option></select>
    <label htmlFor="event-type">Tipo de evento</label><select id="event-type" value={form.type} onChange={e=>change('type',e.target.value)}><option value="market">Mercado / feira</option><option value="festival">Festival</option><option value="private">Evento privado</option><option value="stop">Paragem habitual</option>{!['market','festival','private','stop'].includes(form.type)&&<option value={form.type}>{form.type}</option>}</select>
   </fieldset>
   <p id="event-location-help" className="muted">Pode escrever a morada, escolher no mapa ou usar ambas as opções.</p><EventLocationPicker key={(editing?.id||'new')+form.business_id} business={form.business_id} address={form.address} latitude={form.latitude} longitude={form.longitude} disabled={busy} onBusy={setLocationBusy} onChange={values=>setForm(current=>({...current,...values}))}/><fieldset disabled={busy} className="event-location"><legend>Coordenadas e Google Maps (opcional)</legend><p className="muted">No Google Maps, clique com o botão direito no ponto pretendido e copie as coordenadas. Também pode colar um endereço completo que contenha latitude e longitude.</p>
    <label htmlFor="event-maps">Coordenadas ou endereço do Google Maps</label><div className="event-map-import"><input id="event-maps" value={maps} onChange={e=>setMaps(e.target.value)} placeholder="38.7223, -9.1393"/><button type="button" onClick={importCoordinates} disabled={!maps.trim()}>Preencher coordenadas</button></div>
    <div className="event-coordinate-fields"><label htmlFor="event-latitude">Latitude<input id="event-latitude" type="number" min={-90} max={90} step="any" value={form.latitude} onChange={e=>change('latitude',e.target.value)}/></label><label htmlFor="event-longitude">Longitude<input id="event-longitude" type="number" min={-180} max={180} step="any" value={form.longitude} onChange={e=>change('longitude',e.target.value)}/></label></div>
    {hasLocation&&<p><a href={'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(form.latitude+','+form.longitude)} target="_blank" rel="noopener noreferrer">Conferir localização no Google Maps</a> · <button type="button" onClick={()=>{change('latitude','');change('longitude','');setMaps('');}}>Limpar coordenadas</button></p>}
   </fieldset>
   <p className="muted">Ao publicar, o evento e a localização ficam disponíveis no menu dos clientes. Os horários de recolha dependem da abertura e da capacidade da carrinha.</p>
   <button className="primary" disabled={busy||locationBusy||!trucks.length}>{busy?'A guardar…':form.is_public==='1'?'Guardar e publicar evento':'Guardar rascunho'}</button>
   </form>
  </article>}
 </section>;
}
