import {appBranding} from './brand-data';
export const dynamic='force-dynamic';
import type {MetadataRoute} from 'next';
export default async function manifest():Promise<MetadataRoute.Manifest>{const b=await appBranding();return {id:'/',name:b.app_name+' — Gestão',short_name:b.app_name.slice(0,24),description:'Operações e administração da rede de food trucks',start_url:'/',display:'standalone',background_color:'#f5f4ef',theme_color:b.secondary_color,lang:'pt-PT',icons:b.logo?[{src:b.logo,sizes:'any',type:'image/webp',purpose:'any'}]:[{src:'/icon-192.png',sizes:'192x192',type:'image/png'},{src:'/icon-512.png',sizes:'512x512',type:'image/png'}]};}
