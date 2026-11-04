const fail=(message:string):never=>{throw Object.assign(new Error(message),{statusCode:400});};
const color=(value:unknown,label:string)=>{if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value.trim()))fail(label+': escolha uma cor válida no formato #RRGGBB.');return (value as string).trim();};
export function brandingValues(body:any){
 if(typeof body.name!=='string'||!body.name.trim()||body.name.length>100)fail('Nome do negócio: introduza entre 1 e 100 caracteres.');
 const name=body.name.trim(),primary=color(body.color,'Cor principal');
 const fields=['description','contact','secondary_color','accent_color','background_color','font_family','page_layout','appearance','social_links','slot_capacity','retention_days','logo','cover'];
 const settings:Record<string,string|number>={};
 for(const key of fields){
  const value=body[key];if(value===undefined)continue;
  if(key==='slot_capacity'||key==='retention_days'){
   const label=key==='slot_capacity'?'Capacidade por horário':'Retenção dos contactos',max=key==='slot_capacity'?100:3650;
   const n=Number(value);
   if(!['string','number'].includes(typeof value)||value===''||!Number.isSafeInteger(n)||n<1||n>max)fail(label+': indique um número inteiro entre 1 e '+max+'.');
   settings[key]=n;continue;
  }
  const labels:Record<string,string>={description:'Descrição',contact:'Contacto público',logo:'Logótipo',cover:'Fotografia da carrinha',social_links:'Redes sociais e site',appearance:'Aparência'};
  if(typeof value!=='string'||value.length>1000)fail((labels[key]||key)+': utilize texto com até 1000 caracteres.');
  const content=(value as string).trim();
  if(key==='background_color'){settings[key]=content?color(content,'Cor de fundo'):'';continue;}
  if(key==='font_family'&&!['original','modern','rounded','classic'].includes(content))fail('Escolha um tipo de letra disponível.');
  if(key==='page_layout'&&!['standard','compact','showcase'].includes(content))fail('Escolha um layout disponível.');
  if(key.endsWith('_color')){settings[key]=color(content,key==='secondary_color'?'Cor secundária':'Cor de destaque');continue;}
  if(key==='appearance'&&!['light','dark'].includes(content))fail('Aparência: escolha Clara ou Escura.');
  if(['logo','cover'].includes(key)&&content&&!/^\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/.test(content))fail(labels[key]+': volte a carregar uma imagem PNG, JPEG ou WebP no editor e guarde as alterações.');
  if(key==='social_links'){
   const links=content.split(/[\r\n,;]+/).map(line=>line.trim()).filter(Boolean);
   const normalized=links.map(link=>{
    const hasScheme=/^[a-z][a-z0-9+.-]*:/i.test(link);
    const candidate=link.startsWith('//')?'https:'+link:hasScheme?link:'https://'+link;
    let url:URL;
    try{url=new URL(candidate);}catch{fail('Redes sociais e site: verifique o endereço "'+link+'". Pode usar, por exemplo, instagram.com/seu-negocio.');}
    if(!['http:','https:'].includes(url!.protocol)||!url!.hostname||url!.username||url!.password)fail('Redes sociais e site: indique um endereço de página válido, por exemplo instagram.com/seu-negocio.');
    return url!.href;
   });
   settings[key]=[...new Set(normalized)].join('\n');continue;
  }
  settings[key]=content;
 }
 return {name,color:primary,settings};
}
