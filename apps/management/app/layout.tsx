import {InstallationMode} from './installation-mode';
import {RegisterPwa} from './pwa';
import {BrandProvider} from './app-brand';
import {appBranding} from './brand-data';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import './touch-mode.css';
export async function generateMetadata(){const b=await appBranding();return {title:b.app_name+' — Gestão',description:'Gestão e encomendas da rede',...(b.logo?{icons:{icon:b.logo}}:{})}}
export default function Layout({children}:{children:React.ReactNode}){return <html lang="pt-PT"><body><InstallationMode/><BrandProvider suffix="Gestão">{children}</BrandProvider><RegisterPwa/></body></html>}
