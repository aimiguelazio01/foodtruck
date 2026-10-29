'use client';
import {useEffect} from 'react';export default function ClearCart({business}:{business:string}){useEffect(()=>{localStorage.removeItem('ft-cart-v1-'+business);sessionStorage.removeItem('ft-request-'+business);},[business]);return <button className="quiet" style={{marginTop:15}} onClick={()=>window.print()}>Imprimir resumo</button>}
