"use client";
import {AppBrand} from '../../app-brand';
import CustomerAccount from '../../customer-account';
import {use,useEffect,useState} from 'react';
import {orderStates,orderNumber,orderMoney,pickupTime} from '../../../lib/order-display';

export default function Track({params}:{params:Promise<{id:string}>}){
 const {id}=use(params);
 const [order,setOrder]=useState<any>(),[connected,setConnected]=useState(false),[error,setError]=useState(''),[claimMessage,setClaimMessage]=useState(''),[claimError,setClaimError]=useState(''),[claiming,setClaiming]=useState(false);
 useEffect(()=>{
  let token:string|null=null,slug:string|null=null;
  try{token=sessionStorage.getItem('ft-track-'+id);slug=sessionStorage.getItem('ft-track-slug-'+id)}catch{}
  let active=true,stream:EventSource|null=null,request:AbortController|null=null;setOrder(undefined);setClaimMessage('');setClaimError('');
  const subscribe=(businessSlug:string)=>{
   if(stream)return;stream=new EventSource('/api/v1/public/businesses/'+encodeURIComponent(businessSlug)+'/events');
   stream.addEventListener('change',load);stream.onopen=()=>{if(active){setConnected(true);void load();}};stream.onerror=()=>{if(active)setConnected(false)};
  };
  async function load(){
   request?.abort();const controller=new AbortController();request=controller;
   try{const r=await fetch('/api/v1/customer/orders/'+encodeURIComponent(id)+(token?'?token='+encodeURIComponent(token):''),{credentials:'include',cache:'no-store',signal:controller.signal});if(!r.ok)throw Error('Não foi possível carregar a encomenda. Abra a ligação original ou entre na conta à qual a associou.');const d=await r.json();if(active&&!controller.signal.aborted){setOrder(d.order);setError('');if(d.order.business_slug)subscribe(d.order.business_slug);}}
   catch(e){if(active&&!controller.signal.aborted)setError(e instanceof Error?e.message:'Não foi possível carregar a encomenda.');}
  }
  if(slug)subscribe(slug);void load();const timer=setInterval(load,15000);window.addEventListener('focus',load);
  return()=>{active=false;request?.abort();stream?.close();clearInterval(timer);window.removeEventListener('focus',load)};
 },[id]);
 async function claim(){
  setClaiming(true);setClaimError('');setClaimMessage('');
  let token:string|null=null;try{token=sessionStorage.getItem('ft-track-'+id)}catch{}
  try{
   const r=await fetch('/api/v1/customer/claim-order',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({id,...token?{token}:{}})});
   if(r.status===401){try{sessionStorage.setItem('ft-pending-claim',id)}catch{}window.location.assign('/account?claim='+encodeURIComponent(id));return;}
   const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.message||'Não foi possível associar a encomenda. Tente novamente.');
   setOrder((current:any)=>({...current,is_associated:true}));setClaimMessage('Encomenda associada à sua conta. Já pode consultá-la em A minha conta.');
  }catch(e){setClaimError(e instanceof Error?e.message:'Não foi possível associar a encomenda.');}
  finally{setClaiming(false);}
 }
 return <main className="customer-tracking"><header className="public-header"><AppBrand/><CustomerAccount/></header><section className="panel tracking-panel">
  <h1>Encomenda {orderNumber(id)}</h1><p>Acompanhe o seu pedido. Apresente este número ao recolher a encomenda.</p>
  {error&&<p role="alert" className="notice error">{error}</p>}
  {order?<><h2 className={'customer-order-status '+order.status}>{orderStates[order.status]||order.status}</h2><p className="muted" role="status">{connected?'Atualizações em tempo real':'A atualizar o estado periodicamente…'}</p>
   {order.status==='ready'&&<p className="notice">A sua encomenda está pronta. Indique o número {orderNumber(id)} à equipa da carrinha.</p>}
   <dl className="order-pickup"><div><dt>Carrinha</dt><dd>{order.business_name||order.business_slug}</dd></div><div><dt>Recolha — hora de Portugal</dt><dd>{pickupTime(order.pickup_at)}</dd></div>{order.location_snapshot&&<div><dt>Local de recolha</dt><dd>{order.location_snapshot}</dd></div>}</dl>
   <h3>O seu pedido</h3><ul>{(order.items||[]).map((item:any,index:number)=><li key={index}>{item.quantity} × {item.name}</li>)}</ul><p className="order-total">Total <strong>{orderMoney(order.total_cents)}</strong></p>
   <div className="order-account-actions">{order.is_associated?<a className="primary link-button" href="/account">Ver na minha conta</a>:<button className="primary" disabled={claiming} onClick={claim}>{claiming?'A associar…':'Associar à minha conta'}</button>}<a href="/account">A minha conta</a></div>
   {claimMessage&&<p role="status" className="notice">{claimMessage}</p>}{claimError&&<p role="alert" className="notice error">{claimError}</p>}
  </>:!error&&<p role="status">A carregar a encomenda…</p>}
  <p><a href="/">Voltar aos menus</a></p>
 </section></main>;
}
