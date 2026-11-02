import ExcelJS from 'exceljs';
const states:Record<string,string>={pending:'Pendente',confirmed:'Confirmada',preparing:'Em preparação',ready:'Pronta a recolher',collected:'Recolhida',cancelled:'Cancelada'};
const payments:Record<string,string>={unpaid:'Por pagar',paid_collection:'Pago na recolha',demo_paid:'Pagamento simulado'};
const reference=(id:string)=>'#'+id.slice(0,6).toUpperCase();
function lisbonDate(value:number|null|undefined){
 if(value==null)return null;
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Lisbon',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(Number(value)).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
 return new Date(Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second));
}
type Column={key:string;header:string;width:number;kind?:'date'|'money'|'number'|'coordinate'};
function sheet(workbook:ExcelJS.Workbook,name:string,title:string,columns:Column[]){
 const ws=workbook.addWorksheet(name,{views:[{state:'frozen',ySplit:4}],pageSetup:{orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0}});
 ws.columns=columns.map(c=>({key:c.key,width:c.width}));
 ws.mergeCells(1,1,1,Math.min(columns.length,7));ws.getCell('A1').value=title;ws.getCell('A1').font={name:'Aptos',size:16,bold:true,color:{argb:'FF20271F'}};ws.getRow(1).height=30;
 ws.mergeCells(2,1,2,Math.min(columns.length,8));ws.getCell('A2').value='Horas: Portugal continental · Valores: EUR · Exportação de todas as encomendas da carrinha';ws.getCell('A2').font={name:'Aptos',size:10,color:{argb:'FF59664E'}};ws.getRow(2).height=24;
 const header=ws.getRow(4);header.values=columns.map(c=>c.header);header.height=34;
 header.eachCell(cell=>{cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF283820'}};cell.font={name:'Aptos',bold:true,color:{argb:'FFFFFFFF'},size:11};cell.alignment={vertical:'middle',wrapText:true};});
 return {ws,columns};
}
function finish({ws,columns}:{ws:ExcelJS.Worksheet;columns:Column[]}){
 const last=Math.max(4,ws.rowCount);ws.autoFilter={from:{row:4,column:1},to:{row:last,column:columns.length}};
 for(let r=5;r<=last;r++){const row=ws.getRow(r);let height=32;row.eachCell((cell,col)=>{if(typeof cell.value==='string')height=Math.max(height,cell.value.split('\n').reduce((lines,text)=>lines+Math.max(1,Math.ceil(text.length/Math.max(10,(columns[col-1]?.width||20)-2))),0)*15+10)});row.height=Math.min(409,height);row.eachCell({includeEmpty:true},(cell,col)=>{
  if(cell.value==='')cell.value=null;cell.font={name:'Aptos',size:11,color:{argb:'FF232720'}};cell.alignment={vertical:'top',wrapText:true};
  if(r%2===1)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF1F4ED'}};
  const kind=columns[col-1]?.kind;if(kind==='date')cell.numFmt='dd/mm/yyyy hh:mm';else if(kind==='money')cell.numFmt='#,##0.00 "€"';else if(kind==='number')cell.numFmt='#,##0';else if(kind==='coordinate')cell.numFmt='0.000000';
 });}
 ws.pageSetup.printTitlesRow='1:4';ws.pageSetup.printArea='A1:'+ws.getColumn(columns.length).letter+last;
}
export async function ordersWorkbook(businessName:string,orders:any[],history:any[]){
 const book=new ExcelJS.Workbook();book.creator='Food Truck Live';book.created=new Date();book.calcProperties.fullCalcOnLoad=true;
 const orderSheet=sheet(book,'Encomendas','Encomendas — '+businessName,[
  {key:'reference',header:'Número',width:14},{key:'id',header:'ID da encomenda',width:39},{key:'business',header:'Carrinha',width:25},{key:'customer',header:'Cliente',width:25},{key:'contact',header:'Contacto',width:28},{key:'status',header:'Estado',width:22},{key:'payment',header:'Pagamento',width:24},
  {key:'created',header:'Criada em (Portugal)',width:23,kind:'date'},{key:'pickup',header:'Recolha (Portugal)',width:23,kind:'date'},{key:'location',header:'Local de recolha',width:40},{key:'event',header:'Evento',width:30},{key:'event_id',header:'ID do evento',width:39},{key:'venue',header:'Nome do local do evento',width:28},{key:'address',header:'Morada do evento',width:40},
  {key:'event_start',header:'Início do evento (Portugal)',width:24,kind:'date'},{key:'event_end',header:'Fim do evento (Portugal)',width:24,kind:'date'},{key:'latitude',header:'Latitude',width:15,kind:'coordinate'},{key:'longitude',header:'Longitude',width:15,kind:'coordinate'},{key:'published',header:'Publicação do evento',width:22},
  {key:'total',header:'Total (EUR)',width:18,kind:'money'},{key:'quantity',header:'Quantidade de artigos',width:18,kind:'number'},{key:'account',header:'Associada a conta de cliente',width:22},{key:'version',header:'Versão',width:12,kind:'number'}
 ]);
 const itemSheet=sheet(book,'Artigos','Artigos e escolhas — '+businessName,[
  {key:'reference',header:'Número',width:14},{key:'order_id',header:'ID da encomenda',width:39},{key:'business',header:'Carrinha',width:25},{key:'pickup',header:'Recolha (Portugal)',width:23,kind:'date'},{key:'event',header:'Evento',width:30},{key:'product_id',header:'ID do produto',width:39},{key:'product',header:'Artigo',width:30},{key:'category',header:'Categoria',width:22},{key:'choices',header:'Escolhas e extras',width:48},
  {key:'quantity',header:'Quantidade',width:16,kind:'number'},{key:'unit',header:'Preço unitário (EUR)',width:22,kind:'money'},{key:'subtotal',header:'Subtotal (EUR)',width:20,kind:'money'}
 ]);
 for(const o of orders){
  const items=o.items||[];
  orderSheet.ws.addRow({reference:reference(o.id),id:o.id,business:o.business_name||businessName,customer:o.customer_name,contact:o.contact===undefined?'Reservado pelas permissões':o.contact,status:states[o.status]||o.status,payment:payments[o.payment]||o.payment,created:lisbonDate(o.created_at),pickup:lisbonDate(o.pickup_at),location:o.location_snapshot||'',event:o.event_title||(o.event_id?'Evento já removido':'Sem evento associado'),event_id:o.event_id||'',venue:o.event_venue||'',address:o.event_address||'',event_start:lisbonDate(o.event_starts_at),event_end:lisbonDate(o.event_ends_at),latitude:o.event_latitude??null,longitude:o.event_longitude??null,published:o.event_is_public==null?'':o.event_is_public?'Publicado':'Rascunho',total:o.total_cents/100,quantity:items.reduce((sum:number,i:any)=>sum+i.quantity,0),account:o.has_customer_account?'Sim':'Não',version:o.version});
  for(const item of items){const row=itemSheet.ws.addRow({reference:reference(o.id),order_id:o.id,business:o.business_name||businessName,pickup:lisbonDate(o.pickup_at),event:o.event_title||(o.event_id?'Evento já removido':'Sem evento associado'),product_id:item.product_id,product:item.name,category:item.category||'',choices:item.customization||'',quantity:item.quantity,unit:item.unit_cents/100});row.getCell('subtotal').value={formula:'J'+row.number+'*K'+row.number,result:item.quantity*item.unit_cents/100};}
 }
 const auditSheet=sheet(book,'Histórico','Histórico de encomendas — '+businessName,[
  {key:'reference',header:'Número',width:14},{key:'order_id',header:'ID da encomenda',width:39},{key:'date',header:'Data (Portugal)',width:23,kind:'date'},{key:'description',header:'Alteração',width:30},{key:'action',header:'Registo completo',width:65},{key:'user',header:'ID do utilizador',width:39},{key:'audit_id',header:'ID do registo',width:39}
 ]);
 const known=new Set(orders.map(o=>o.id));
 for(const h of history){const [,orderId,...parts]=String(h.action).split(':');if(!known.has(orderId))continue;const last=parts.join(':');auditSheet.ws.addRow({reference:reference(orderId),order_id:orderId,date:lisbonDate(h.created_at),description:h.action.startsWith('payment:')?'Pagamento na recolha':states[parts[0]]?(states[parts[0]]+(parts[1]==='expired'?' por expiração':'')):last,action:h.action,user:h.user_id||'',audit_id:h.id});}
 finish(orderSheet);finish(itemSheet);finish(auditSheet);
 return Buffer.from(await book.xlsx.writeBuffer());
}
