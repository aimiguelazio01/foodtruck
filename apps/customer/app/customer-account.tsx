"use client";
import {useEffect,useState} from 'react';

type Identity={name?:string;email:string;kind:'customer'|'staff'};
export default function CustomerAccount(){
 const [identity,setIdentity]=useState<Identity|null>(null);
 useEffect(()=>{
  let active=true,request:AbortController|null=null;
  async function refresh(){
   request?.abort();const controller=new AbortController();request=controller;
   const options={credentials:'include' as const,cache:'no-store' as const,signal:controller.signal};
   try{
    const customer=await fetch('/api/v1/customer/me',options);
    let value:Identity|null=null;
    if(customer.ok){const data=await customer.json();if(data.customer?.email)value={...data.customer,kind:'customer'};}
    else if(customer.status===401||customer.status===403){const staff=await fetch('/api/v1/auth/me',options);if(staff.ok){const data=await staff.json();if(data.user?.email)value={...data.user,kind:'staff'};}}
    if(active&&!controller.signal.aborted)setIdentity(value);
   }catch{if(active&&!controller.signal.aborted)setIdentity(null);}
  }
  const visible=()=>{if(document.visibilityState==='visible')void refresh();};
  void refresh();window.addEventListener('focus',refresh);window.addEventListener('customer-session-changed',refresh);document.addEventListener('visibilitychange',visible);
  return()=>{active=false;request?.abort();window.removeEventListener('focus',refresh);window.removeEventListener('customer-session-changed',refresh);document.removeEventListener('visibilitychange',visible);};
 },[]);
 return <div className="customer-account">{identity&&<p className="customer-session" aria-label="Utilizador com sessão iniciada"><span>{identity.kind==='staff'?'Sessão da equipa:':'Sessão:'}</span> <strong>{identity.name?.trim()||identity.email}</strong></p>}<a href="/account">A minha conta</a></div>;
}
