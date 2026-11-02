export const orderStates:Record<string,string>={pending:'Pendente',confirmed:'Confirmada',preparing:'Em preparação',ready:'Pronta a recolher',collected:'Recolhida',cancelled:'Cancelada'};
export const orderNumber=(id:string)=>'#'+id.slice(0,6).toUpperCase();
export const orderMoney=(cents:number)=>new Intl.NumberFormat('pt-PT',{style:'currency',currency:'EUR'}).format((cents||0)/100);
export function pickupTime(value:number|null|undefined){return value==null?'Hora de recolha por confirmar':new Intl.DateTimeFormat('pt-PT',{timeZone:'Europe/Lisbon',dateStyle:'medium',timeStyle:'short'}).format(Number(value));}
export function readClaimId(value:string|null){return value&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)?value:null;}
