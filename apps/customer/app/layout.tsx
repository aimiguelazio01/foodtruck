import {RegisterPwa} from './pwa';
import {BrandProvider} from './app-brand';
import {appBranding} from './brand-data';
import './styles.css';
export async function generateMetadata(){const b=await appBranding();return {title:b.app_name+' — Encomendar',description:'Gestão e encomendas da rede',...(b.logo?{icons:{icon:b.logo}}:{})}}
export default function Layout({children}:{children:React.ReactNode}){return <html lang="pt-PT"><body><BrandProvider suffix="Encomendar">{children}</BrandProvider><RegisterPwa/></body></html>}
