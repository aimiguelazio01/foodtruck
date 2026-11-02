export type Point={latitude:number;longitude:number};
export type MapLocation=Point&{address:string};
export type MapController={setPoint:(point:Point|null)=>void;center:()=>Point;destroy:()=>void;geocode?:(value:string|Point)=>Promise<MapLocation[]>};
let googleReady:Promise<any>|null=null;
async function googleMaps(key:string){
 const w=window as any;if(w.google?.maps?.importLibrary)return w.google.maps;
 if(!googleReady)googleReady=new Promise((resolve,reject)=>{
  const callback='__foodTruckMapsReady';
  const script=document.createElement('script');
  const timer=setTimeout(()=>{delete w[callback];googleReady=null;reject(Error('O Google Maps demorou a responder.'));},15000);
  w[callback]=()=>{clearTimeout(timer);delete w[callback];resolve(w.google.maps)};
  script.src='https://maps.googleapis.com/maps/api/js?'+new URLSearchParams({key,callback,loading:'async',v:'weekly',language:'pt',region:'PT'});
  script.async=true;script.onerror=()=>{clearTimeout(timer);delete w[callback];googleReady=null;script.remove();reject(Error('Não foi possível carregar o Google Maps.'));};
  document.head.appendChild(script);
 });
 return googleReady;
}
export async function createEventMap(node:HTMLElement,point:Point|null,onPick:(point:Point)=>void,config:{googleKey:string;googleMapId:string},onTileError:()=>void,signal?:AbortSignal):Promise<MapController>{
 const center=point||{latitude:38.7223,longitude:-9.1393};
 if(config.googleKey){
  const g=await googleMaps(config.googleKey),{Map}=await g.importLibrary('maps'),{AdvancedMarkerElement}=await g.importLibrary('marker'),{Geocoder}=await g.importLibrary('geocoding');
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  const map=new Map(node,{center:{lat:center.latitude,lng:center.longitude},zoom:14,mapId:config.googleMapId,streetViewControl:false,mapTypeControl:false});
  const marker=new AdvancedMarkerElement({map,position:point?{lat:point.latitude,lng:point.longitude}:null,gmpDraggable:true,title:'Local do evento'});
  const click=map.addListener('click',(event:any)=>{if(event.latLng)onPick({latitude:event.latLng.lat(),longitude:event.latLng.lng()});});
  const dragged=()=>{const p=marker.position;if(p)onPick({latitude:typeof p.lat==='function'?p.lat():p.lat,longitude:typeof p.lng==='function'?p.lng():p.lng});};
  marker.addEventListener('gmp-dragend',dragged);
  const resizeObserver=new ResizeObserver(()=>{const bounds=map.getBounds();if(marker.position&&bounds&&!bounds.contains(marker.position))map.panTo(marker.position);});resizeObserver.observe(node);
  const geocoder=new Geocoder();
  return {
   setPoint(p){marker.position=p?{lat:p.latitude,lng:p.longitude}:null;if(p)map.panTo(marker.position)},
   center(){const p=map.getCenter();return {latitude:p.lat(),longitude:p.lng()}},
   async geocode(value){const result=await geocoder.geocode(typeof value==='string'?{address:value,region:'pt'}:{location:{lat:value.latitude,lng:value.longitude}});return (result.results||[]).slice(0,5).map((r:any)=>({address:r.formatted_address.slice(0,200),latitude:r.geometry.location.lat(),longitude:r.geometry.location.lng()}));},
   destroy(){resizeObserver.disconnect();click.remove();marker.removeEventListener('gmp-dragend',dragged);marker.map=null;g.event.clearInstanceListeners(map);node.replaceChildren();}
  };
 }
 const L=await import('leaflet');
 if(signal?.aborted)throw new DOMException('Aborted','AbortError');
 const map=L.map(node,{scrollWheelZoom:false}).setView([center.latitude,center.longitude],14);
 L.tileLayer(process.env.NEXT_PUBLIC_TILE_URL||'https://tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',maxZoom:19}).on('tileerror',onTileError).addTo(map);
 const icon=L.divIcon({className:'event-map-pin',html:'<svg viewBox="0 0 32 42" width="32" height="42" aria-hidden="true"><path d="M16 40S2 25 2 16a14 14 0 0 1 28 0c0 9-14 24-14 24Z" fill="#b74b0e" stroke="white" stroke-width="2"/><circle cx="16" cy="16" r="5" fill="white"/></svg>',iconSize:[32,42],iconAnchor:[16,40]});
 const marker=L.marker([center.latitude,center.longitude],{icon,draggable:true,title:'Arraste para indicar o local do evento',alt:'Pin do local do evento'});
 if(point)marker.addTo(map);
 map.on('click',event=>onPick({latitude:event.latlng.lat,longitude:event.latlng.lng}));
 marker.on('dragend',()=>{const p=marker.getLatLng();onPick({latitude:p.lat,longitude:p.lng});});
 const observer=new ResizeObserver(()=>{map.invalidateSize();if(map.hasLayer(marker)&&!map.getBounds().contains(marker.getLatLng()))map.panTo(marker.getLatLng(),{animate:false});});observer.observe(node);
 return {
  setPoint(p){if(!p){marker.remove();return;}marker.setLatLng([p.latitude,p.longitude]);if(!map.hasLayer(marker))marker.addTo(map);if(!map.getBounds().contains([p.latitude,p.longitude]))map.panTo([p.latitude,p.longitude]);},
  center(){const p=map.getCenter();return {latitude:p.lat,longitude:p.lng};},
  destroy(){observer.disconnect();map.remove();}
 };
}
