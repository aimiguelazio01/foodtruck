const zone='Europe/Lisbon';
export function localDateInput(timestamp:number){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(timestamp).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
 return parts.year+'-'+parts.month+'-'+parts.day+'T'+parts.hour+':'+parts.minute;
}
export function eventTimestamp(value:string){
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw Error('Indique uma data e hora válidas.');
 const desired=Date.parse(value+'Z');if(!Number.isFinite(desired))throw Error('Indique uma data e hora válidas.');
 let result=desired;
 for(let i=0;i<4;i++){const shown=Date.parse(localDateInput(result)+'Z');if(shown===desired)return result;result+=desired-shown;}
 throw Error('Esta hora não existe em Portugal devido à mudança de hora. Escolha outro horário.');
}
export function mapsCoordinates(value:string):[number,number]{
 let source=value.trim();
 if(!source)throw Error('Cole as coordenadas do Google Maps, por exemplo 38.7223, -9.1393.');
 let pair:RegExpMatchArray|null=null;
 if(/^https?:\/\//i.test(source)){
  let url:URL;try{url=new URL(source);}catch{throw Error('O endereço não é válido. Cole diretamente latitude e longitude.');}
  if(!/(^|\.)google\.[a-z.]+$/i.test(url.hostname))throw Error('Cole coordenadas ou um endereço completo do Google Maps.');
  source=decodeURIComponent(url.href);
  pair=source.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if(!pair)source=url.searchParams.get('query')||url.searchParams.get('q')||source;
  if(!pair)pair=source.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
 }
 if(!pair)pair=source.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)\s*$/);
 if(!pair)throw Error('Não encontrei coordenadas. No Google Maps, copie latitude e longitude (por exemplo 38.7223, -9.1393). Links curtos não contêm esses valores.');
 const lat=Number(pair[1]),lon=Number(pair[2]);
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat< -90||lat>90||lon< -180||lon>180)throw Error('As coordenadas estão fora dos limites válidos.');
 return [lat,lon];
}
