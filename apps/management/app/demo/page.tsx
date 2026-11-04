'use client';
import {useEffect,useState} from 'react';
export default function Demo(){const [error,setError]=useState('');useEffect(()=>{fetch('/api/v1/demo/session',{method:'POST',credentials:'include'}).then(async r=>{if(!r.ok)throw Error('Não foi possível abrir a demonstração. Confirme que escolheu o perfil demo.');location.replace('/')}).catch(e=>setError(e.message))},[]);return <main className="installation-page"><h1>Abrir demo</h1><p role={error?'alert':'status'}>{error||'A preparar o acesso de consulta…'}</p>{error&&<a href="/">Voltar</a>}</main>}
