export const orderStates:Record<string,string>={pending:'Pendente',confirmed:'Confirmada',preparing:'Em preparação',ready:'Pronta a recolher',collected:'Recolhida',cancelled:'Cancelada'};
export const paymentStates:Record<string,string>={unpaid:'Por pagar',paid_collection:'Pago na recolha',demo_paid:'Simulado'};
export const transitions:Record<string,string[]>={pending:['confirmed','cancelled'],confirmed:['preparing','cancelled'],preparing:['ready','cancelled'],ready:['collected','cancelled']};
export const orderReference=(id:string)=>'#'+id.slice(0,6).toUpperCase();
export const money=(cents:number)=>new Intl.NumberFormat('pt-PT',{style:'currency',currency:'EUR'}).format((cents||0)/100);
export const orderDate=(value:number|null)=>value==null?'Sem horário de recolha':new Intl.DateTimeFormat('pt-PT',{timeZone:'Europe/Lisbon',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(Number(value));
export type OrderGroup={key:string;title:string;subtitle:string;sort:number;orders:any[]};
function dayKey(value:number){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Lisbon',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(Number(value)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
 return p.year+'-'+p.month+'-'+p.day;
}
export function groupOrders(orders:any[],grouping:string){
 const groups=new Map<string,OrderGroup>();
 for(const order of orders){
  const time=Number(order.pickup_at??order.created_at);
  let key='all',title='Todas as encomendas',subtitle='',sort=0;
  if(grouping==='day'){key=dayKey(time);title=new Intl.DateTimeFormat('pt-PT',{timeZone:'Europe/Lisbon',weekday:'long',day:'2-digit',month:'long',year:'numeric'}).format(time);sort=Number(key.replaceAll('-',''));}
  else if(grouping==='event'){key=order.event_id||'no-event';title=order.event_title||(order.event_id?'Evento já removido':'Sem evento associado');subtitle=[order.event_venue,order.event_starts_at?orderDate(order.event_starts_at):''].filter(Boolean).join(' · ');sort=order.event_id?Number(order.event_starts_at??time):-1;}
  if(!groups.has(key))groups.set(key,{key,title,subtitle,sort,orders:[]});groups.get(key)!.orders.push(order);
 }
 for(const group of groups.values())group.orders.sort((a,b)=>Number(a.pickup_at??a.created_at)-Number(b.pickup_at??b.created_at)||a.id.localeCompare(b.id));
 return [...groups.values()].sort((a,b)=>b.sort-a.sort||a.title.localeCompare(b.title,'pt-PT')||a.key.localeCompare(b.key));
}
export function matchingOrders(orders:any[],search:string,state:string){
 const normalize=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-PT');
 const needle=normalize(search.trim());
 return orders.filter(order=>{
  const matchesState=state==='all'||(state==='active'?!['collected','cancelled'].includes(order.status):order.status===state);
  const haystack=[order.id,order.customer_name,order.contact,order.event_title,order.event_venue,...(order.items||[]).map((item:any)=>item.name+' '+(item.customization||''))].filter(Boolean).join(' ');
  return matchesState&&(!needle||normalize(haystack).includes(needle));
 });
}
