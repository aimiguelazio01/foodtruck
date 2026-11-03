"use client";
import {useEffect,useState} from 'react';

type LayoutMode='standard'|'touch';
const preferenceKey='ft-management-layout-v1';

export function useLayoutMode(){
 const [mode,setMode]=useState<LayoutMode>('standard');
 useEffect(()=>{try{if(localStorage.getItem(preferenceKey)==='touch')setMode('touch')}catch{}},[]);
 function choose(value:LayoutMode){setMode(value);try{localStorage.setItem(preferenceKey,value)}catch{}}
 return [mode,choose] as const;
}

export function LayoutModePicker({value,onChange}:{value:LayoutMode;onChange:(value:LayoutMode)=>void}){
 return <section className="layout-mode-bar" aria-label="Modo de utilização">
  <div><strong>Modo de utilização</strong><p id="layout-mode-help">{value==='touch'?'Touch ativo: botões, texto e espaçamento maiores.':'Escolha Touch para utilizar com o dedo no monitor.'}</p></div>
  <div className="layout-mode-options" role="group" aria-label="Layout" aria-describedby="layout-mode-help">
   <button type="button" aria-pressed={value==='standard'} onClick={()=>onChange('standard')}>Atual</button>
   <button type="button" aria-pressed={value==='touch'} onClick={()=>onChange('touch')}>Touch</button>
  </div>
 </section>;
}
