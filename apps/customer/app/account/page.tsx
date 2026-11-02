"use client";
import {AppBrand} from '../app-brand';
import {useEffect,useState} from 'react';
import {orderStates,orderNumber,orderMoney,pickupTime,readClaimId} from '../../lib/order-display';

export default function Account(){
 const [customer,setCustomer]=useState<any>(null),[ready,setReady]=useState(false),[mode,setMode]=useState<'login'|'register'>('login');
 const [message,setMessage]=useState(''),[error,setError]=useState(''),[orders,setOrders]=useState<any[]>([]),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false);
 const [pending,setPending]=useState<string|null>(null),[claimBusy,setClaimBusy]=useState(false),[claimError,setClaimError]=useState(''),[claimAttempt,setClaimAttempt]=useState(0),[refresh,setRefresh]=useState(0);
 useEffect(()=>{
  let active=true;const controller=new AbortController();
  const requested=readClaimId(new URLSearchParams(window.location.search).get('claim'));let stored:string|null=null;try{stored=readClaimId(sessionStorage.getItem('ft-pending-claim'));if(requested)sessionStorage.setItem('ft-pending-claim',requested)}catch{}
  setPending(requested||stored);
  fetch('/api/v1/customer/me',{credentials:'include',cache:'no-store',signal:controller.signal}).then(async r=>{if(r.ok){const d=await r.json();if(active)setCustomer(d.customer)}}).catch(()=>{}).finally(()=>{if(active)setReady(true)});
  return()=>{active=false;controller.abort()};
 },[]);
 useEffect(()=>{
  if(!customer)return;let active=true,request:AbortController|null=null;setLoaded(false);
  async function load(){
   request?.abort();const controller=new AbortController();request=controller;
   try{const r=await fetch('/api/v1/customer/history',{credentials:'include',cache:'no-store',signal:controller.signal});
    if(r.status===401){if(active){setCustomer(null);setOrders([]);setError('A sessão expirou. Entre novamente na sua conta de cliente.');}return;}
    if(!r.ok)throw Error('Não foi possível atualizar as encomendas. Tente novamente.');const d=await r.json();
    if(active&&!controller.signal.aborted){setOrders(d.orders||[]);setLoaded(true);setError('');}
   }catch(e){if(active&&!controller.signal.aborted){setLoaded(true);setError(e instanceof Error?e.message:'Não foi possível atualizar as encomendas.');}}
  }
  void load();const timer=setInterval(load,15000);window.addEventListener('focus',load);
  return()=>{active=false;request?.abort();clearInterval(timer);window.removeEventListener('focus',load)};
 },[customer?.id,refresh]);
 useEffect(()=>{
  if(!customer||!pending)return;let active=true;const controller=new AbortController();setClaimBusy(true);setClaimError('');
  let token:string|null=null;try{token=sessionStorage.getItem('ft-track-'+pending)}catch{}
  fetch('/api/v1/customer/claim-order',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({id:pending,...token?{token}:{}}),signal:controller.signal}).then(async r=>{
   const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.message||'Não foi possível associar a encomenda. Abra a ligação original e tente novamente.');
   if(!active)return;try{sessionStorage.removeItem('ft-pending-claim')}catch{}
   const url=new URL(window.location.href);url.searchParams.delete('claim');window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);
   setClaimBusy(false);setPending(null);setMessage('Encomenda associada à sua conta.');setRefresh(value=>value+1);
  }).catch(e=>{if(active&&!controller.signal.aborted)setClaimError(e.message)}).finally(()=>{if(active)setClaimBusy(false)});
  return()=>{active=false;controller.abort();};
 },[customer?.id,pending,claimAttempt]);
 async function submit(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();const f=new FormData(e.currentTarget);const resend=(e.nativeEvent as SubmitEvent).submitter instanceof HTMLButtonElement&&(e.nativeEvent as SubmitEvent).submitter?.getAttribute('value')==='resend';if(resend){const email=e.currentTarget.elements.namedItem('email') as HTMLInputElement;if(!email.reportValidity())return;}setMessage('');setError('');setBusy(true);
  try{const r=await fetch('/api/v1/customer/'+(resend?'resend-verification':mode),{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({email:f.get('email'),password:f.get('password')})});const d=await r.json();
   if(!r.ok){const text=d.message||d.error;throw Error(text==='Invalid credentials'?'Email ou palavra-passe da conta de cliente incorretos.':text==='Account already exists'?'Esta conta já existe. Entre na conta ou use «Reenviar confirmação» se ainda não a confirmou.':text==='Verify your email first'?'Confirme o seu email antes de entrar. Pode pedir um novo email no botão «Reenviar confirmação».':text||'Não foi possível continuar.');}
   if(resend){setMessage('Se existir uma conta por confirmar, foi pedido um novo email de confirmação. Verifique também a pasta de spam.');}
   else if(mode==='register'){setMessage('Verifique o seu email para ativar a conta. Depois entre para associar a encomenda.');setMode('login');}
   else{setCustomer(d.customer);window.dispatchEvent(new Event('customer-session-changed'));}
  }catch(e){setError(e instanceof Error?e.message:'Não foi possível continuar.');}finally{setBusy(false);}
 }
 async function logout(){
  setBusy(true);try{const r=await fetch('/api/v1/customer/logout',{method:'POST',credentials:'include'});if(!r.ok)throw Error('Não foi possível terminar a sessão. Tente novamente.');setCustomer(null);setOrders([]);setMessage('');window.dispatchEvent(new Event('customer-session-changed'));}
  catch(e){setError(e instanceof Error?e.message:'Não foi possível terminar a sessão.');}finally{setBusy(false);}
 }
 if(!ready)return <main className="customer-account-page"><p role="status">A verificar a sessão…</p></main>;
 if(!customer)return <main className="auth-page"><section className="auth-story"><AppBrand/><h1>Os seus favoritos.<br/>Sempre consigo.</h1><p>Guarde o número da encomenda e acompanhe o estado até à recolha.</p></section><section className="auth-form-wrap"><div><h1>{mode==='login'?'Entrar na conta de cliente':'Criar conta de cliente'}</h1>
  {pending&&<p className="notice">Entre ou crie uma conta de cliente para associar a encomenda {orderNumber(pending)}. A sessão da equipa é independente da conta de cliente.</p>}
  {message&&<p className="notice" role="status">{message}</p>}{error&&<p className="notice error" role="alert">{error}</p>}
  <form onSubmit={submit} className="edit-form"><label>Email<input name="email" type="email" autoComplete="email" required maxLength={254} disabled={busy}/></label><label>Palavra-passe<input name="password" type="password" minLength={12} maxLength={256} autoComplete={mode==='login'?'current-password':'new-password'} required disabled={busy}/></label><button className="primary checkout-button" disabled={busy}>{busy?'A processar…':mode==='login'?'Entrar →':'Criar conta →'}</button>{mode==='login'&&<button type="submit" name="intent" value="resend" formNoValidate disabled={busy}>Reenviar confirmação</button>}</form>
  <button className="quiet" disabled={busy} onClick={()=>{setMode(mode==='login'?'register':'login');setMessage('');setError('')}}>{mode==='login'?'Criar uma conta':'Já tenho conta'}</button>
  <p><a href="/forgot-password">Recuperar palavra-passe</a></p><p><a href={pending?'/track/'+encodeURIComponent(pending):'/'}>{pending?'Voltar à encomenda':'Voltar aos menus'}</a></p>
 </div></section></main>;
 return <main className="customer-account-page"><header className="public-header"><AppBrand/><p className="customer-session">Sessão: <strong>{customer.email}</strong></p><button disabled={busy||claimBusy} onClick={logout}>Terminar sessão</button></header><section className="account-orders">
  <div className="section-heading"><div><h1>As suas encomendas</h1><p className="muted">Consulte o número, o estado e a hora de recolha. Atualização automática a cada 15 segundos.</p></div><button onClick={()=>setRefresh(value=>value+1)}>Atualizar encomendas</button></div>
  {message&&<p role="status" className="notice">{message}</p>}{error&&<p role="alert" className="notice error">{error}</p>}
  {claimBusy&&<p role="status">A associar a encomenda à sua conta…</p>}
  {claimError&&<p role="alert" className="notice error">{claimError} <button onClick={()=>setClaimAttempt(value=>value+1)}>Tentar associar novamente</button>{pending&&<> <a href={'/track/'+encodeURIComponent(pending)}>Voltar à encomenda</a></>}</p>}
  {!loaded?<p role="status">A carregar encomendas…</p>:orders.length?<div className="account-order-list">{orders.map(order=><article className="panel account-order" key={order.id}>
   <div className="section-heading"><h2>Encomenda {orderNumber(order.id)}</h2><span className={'customer-order-status '+order.status}>{orderStates[order.status]||order.status}</span></div>
   <p className="order-business">{order.business_name}</p><dl className="order-pickup"><div><dt>Recolha — hora de Portugal</dt><dd>{pickupTime(order.pickup_at)}</dd></div>{order.location_snapshot&&<div><dt>Local de recolha</dt><dd>{order.location_snapshot}</dd></div>}</dl>
   {order.status==='ready'&&<p className="notice">Pronta para recolha. Indique o número {orderNumber(order.id)} à equipa.</p>}
   <ul>{(order.items||[]).map((item:any,index:number)=><li key={index}>{item.quantity} × {item.name}</li>)}</ul>
   <div className="order-account-actions"><strong>{orderMoney(order.total_cents)}</strong>{order.status!=='collected'&&<a className="primary link-button" href={'/track/'+encodeURIComponent(order.id)}>Acompanhar encomenda {orderNumber(order.id)}</a>}</div>
  </article>)}</div>:<p>Ainda não há encomendas associadas a esta conta. Na página de acompanhamento do pedido, escolha Associar à minha conta.</p>}
  <p><a href="/">Voltar aos menus</a></p>
 </section></main>;
}
