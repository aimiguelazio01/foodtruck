function localTimestamp(timestamp,timeZone){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(timestamp).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));return Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute,parts.second);}
export function addWeeksZoned(timestamp,weeks,timeZone='Europe/Lisbon'){
 const desired=localTimestamp(timestamp,timeZone)+weeks*7*86400000;let result=timestamp+weeks*7*86400000;
 for(let i=0;i<4;i++){const delta=desired-localTimestamp(result,timeZone);if(!delta)return result;result+=delta;}
 throw new Error('A recorrência coincide com uma hora local inexistente. Crie essa ocorrência com um horário explícito.');
}
export function isoLocalDay(timestamp=Date.now(),timeZone='Europe/Lisbon'){return new Date(localTimestamp(timestamp,timeZone)).toISOString().slice(0,10);}
export function localDayBounds(iso,timeZone='Europe/Lisbon'){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(iso))throw new Error('Data inválida.');const day=Date.parse(iso+'T00:00:00Z');if(!Number.isFinite(day)||new Date(day).toISOString().slice(0,10)!==iso)throw new Error('Data inválida.');
 const convert=desired=>{let result=desired;for(let n=0;n<4;n++){const delta=desired-localTimestamp(result,timeZone);if(!delta)return result;result+=delta;}throw new Error('Data local inválida.');};return {start:convert(day),end:convert(day+86400000)};
}
