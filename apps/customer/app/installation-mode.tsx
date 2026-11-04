'use client';
import {useEffect,useState} from 'react';
export function InstallationMode(){const [demo,setDemo]=useState(false);const [readOnly,setReadOnly]=useState(false);useEffect(()=>{fetch('/api/v1/installation/status',{cache:'no-store'}).then(r=>r.json()).then(d=>{setDemo(d.demo);setReadOnly(d.readOnly)}).catch(()=>{})},[]);
 useEffect(()=>{if(!readOnly)return;
  const update=()=>{document.querySelectorAll<HTMLInputElement>('form input,form textarea,form select,input[type=file],button').forEach(el=>{const label=el.textContent||'';if(el.tagName!=='BUTTON'||el.closest('form')||/adicionar|encomendar|finalizar|confirmar|pagar|registar|criar conta|recuperar|enviar/i.test(label)){el.disabled=true;el.title='Demonstração — apenas consulta.';}})};
  update();const observer=new MutationObserver(update);observer.observe(document.body,{childList:true,subtree:true});return()=>observer.disconnect();
 },[readOnly]);
 return demo?<aside className="demo-notice"><strong>{readOnly?'Demonstração — apenas consulta':'Demonstração — experimente à vontade'}</strong><span>{readOnly?'Explore os menus e as paragens.':'Pode testar encomendas e criar uma conta fictícia. Os pagamentos e emails são simulados.'}</span></aside>:null;
}
