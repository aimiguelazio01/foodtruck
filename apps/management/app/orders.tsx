"use client";
import {useEffect,useRef,useState} from 'react';
import {groupOrders,matchingOrders,money,orderDate,orderReference,orderStates,paymentStates,transitions} from '../lib/order-view';

type Props={business:{id:string;name:string;slug:string};orders:any[];onChange:(id:string,state:string,version?:number)=>Promise<void>};
export default function Orders({business,orders,onChange}:Props){
 const [view,setView]=useState('cards'),[grouping,setGrouping]=useState('day'),[status,setStatus]=useState('all'),[search,setSearch]=useState(''),[acting,setActing]=useState(''),[exporting,setExporting]=useState(false),[error,setError]=useState('');
 const download=useRef<AbortController|null>(null);
 useEffect(()=>{try{const storedView=localStorage.getItem('ft-orders-view'),storedGrouping=localStorage.getItem('ft-orders-group');if(storedView&&['cards','list'].includes(storedView))setView(storedView);if(storedGrouping&&['none','day','event'].includes(storedGrouping))setGrouping(storedGrouping)}catch{}return()=>download.current?.abort()},[]);
 function preference(kind:'view'|'group',value:string){if(kind==='view')setView(value);else setGrouping(value);try{localStorage.setItem('ft-orders-'+kind,value)}catch{}}
 const scoped=orders.filter(order=>order.business_id===business.id),filtered=matchingOrders(scoped,search,status),groups=groupOrders(filtered,grouping);
 async function act(order:any,state:string){setActing(order.id);try{await onChange(order.id,state,order.version)}finally{setActing('')}}
 function actions(order:any){return <div className="order-buttons orders-actions">{(transitions[order.status]||[]).map(state=><button disabled={!!acting} key={state} onClick={()=>act(order,state)}>{orderStates[state]}</button>)}{order.status==='ready'&&order.payment==='unpaid'&&<button disabled={!!acting} onClick={()=>act(order,'pay')}>Registar pagamento</button>}{!transitions[order.status]?.length&&<span className="muted">Sem ações</span>}{acting===order.id&&<span role="status">A atualizar…</span>}</div>}
 function items(order:any){return <ul className="orders-items">{(order.items||[]).map((item:any,index:number)=><li key={index}>{item.quantity} × {item.name}{item.customization&&<small>{item.customization}</small>}</li>)}</ul>}
 async function exportExcel(){
  setExporting(true);setError('');download.current?.abort();const controller=new AbortController();download.current=controller;
  try{const response=await fetch('/api/v1/manage/businesses/'+encodeURIComponent(business.id)+'/orders/export.xlsx',{credentials:'include',signal:controller.signal});
   if(!response.ok){const data=await response.json().catch(()=>({}));throw Error(data.message||'Não foi possível exportar as encomendas.');}
   const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download=response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1]||'encomendas.xlsx';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
  }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Não foi possível exportar.');}finally{if(!controller.signal.aborted)setExporting(false);}
 }
 return <section className="orders-workspace" aria-label="Gestão de encomendas">
  <div className="section-heading orders-heading"><div><h2>Encomendas de {business.name}</h2><p className="muted">{filtered.length} de {scoped.length} encomendas · horários de Portugal continental</p></div><button className="primary" disabled={exporting} onClick={exportExcel}>{exporting?'A preparar Excel…':'Exportar Excel'}</button></div>
  <p className="orders-export-note">O Excel inclui todas as encomendas desta carrinha, com artigos, escolhas e histórico, independentemente dos filtros abaixo.</p>
  {error&&<p className="notice error" role="alert">{error}</p>}
  <div className="orders-toolbar">
   <fieldset className="orders-view"><legend>Visualização</legend><div><button type="button" aria-pressed={view==='cards'} onClick={()=>preference('view','cards')}>Cartões</button><button type="button" aria-pressed={view==='list'} onClick={()=>preference('view','list')}>Lista</button></div></fieldset>
   <label htmlFor="orders-group">Agrupar por<select id="orders-group" aria-label="Agrupar por" value={grouping} onChange={e=>preference('group',e.target.value)}><option value="none">Sem agrupamento</option><option value="day">Dia de recolha</option><option value="event">Evento</option></select></label>
   <label htmlFor="orders-status">Estado<select id="orders-status" aria-label="Estado" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">Todos os estados</option><option value="active">Em curso</option>{Object.entries(orderStates).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
   <label htmlFor="orders-search">Pesquisar encomendas<input id="orders-search" type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Número, cliente, artigo ou evento"/></label>
  </div>
  {grouping==='day'&&<p className="muted">Agrupado pela data de recolha. Sem horário de recolha, usa-se a data de criação.</p>}
  {!groups.length&&<div className="panel"><p>{scoped.length?'Não existem encomendas que correspondam aos filtros.':'Sem encomendas nesta carrinha.'}</p>{!!scoped.length&&<button onClick={()=>{setStatus('all');setSearch('')}}>Limpar filtros</button>}</div>}
  {groups.map(group=><section className="orders-group" key={group.key}><div className="section-heading"><div><h2>{group.title}</h2>{group.subtitle&&<p className="muted">{group.subtitle}</p>}</div><span className="muted">{group.orders.length} encomenda{group.orders.length===1?'':'s'}</span></div>
   {view==='cards'?<div className="order-grid">{group.orders.map(order=><article className="order-card" key={order.id}>
    <div className="between"><strong>{orderReference(order.id)}</strong><span className={'badge '+order.status}>{orderStates[order.status]||order.status}</span></div><h3>{order.customer_name}</h3><p>{order.contact??'Contacto reservado'}</p>
    <p className="orders-pickup"><strong>Recolha:</strong> {orderDate(order.pickup_at)}</p><p>{order.event_title||'Sem evento associado'}</p>{order.location_snapshot&&<p className="muted">{order.location_snapshot}</p>}{items(order)}
    <div className="between"><strong>{money(order.total_cents)}</strong><small>{paymentStates[order.payment]||order.payment}</small></div>{actions(order)}
   </article>)}</div>:<div className="panel orders-table-wrap"><table className="orders-table"><caption className="orders-sr">Encomendas: {group.title}</caption><thead><tr><th scope="col">Número</th><th scope="col">Cliente</th><th scope="col">Recolha e evento</th><th scope="col">Artigos</th><th scope="col">Estado</th><th scope="col">Pagamento / total</th><th scope="col">Ações</th></tr></thead><tbody>
    {group.orders.map(order=><tr key={order.id}><th scope="row">{orderReference(order.id)}</th><td data-label="Cliente"><strong>{order.customer_name}</strong><small>{order.contact??'Contacto reservado'}</small></td><td data-label="Recolha e evento">{orderDate(order.pickup_at)}<small>{order.event_title||'Sem evento associado'}</small>{order.location_snapshot&&<small>{order.location_snapshot}</small>}</td><td data-label="Artigos">{items(order)}</td><td data-label="Estado"><span className={'badge '+order.status}>{orderStates[order.status]||order.status}</span></td><td data-label="Pagamento / total"><strong>{money(order.total_cents)}</strong><small>{paymentStates[order.payment]||order.payment}</small></td><td data-label="Ações">{actions(order)}</td></tr>)}
   </tbody></table></div>}
  </section>)}
 </section>;
}
