"use client";
import {useEffect,useRef,useState} from 'react';

type Ingredient={id:string;name:string;unit:string;quantity:number;reserved:number;minimum:number;supplier:string;version:number;deleted_at?:number;recipe_count?:number};
type Props={business:string;rows:Ingredient[];onSaved:()=>Promise<void>;loading:boolean};
const number=(n:number)=>new Intl.NumberFormat('pt-PT').format(n);
const reasonNames:Record<string,string>={restock:'Reposição',adjustment:'Correção',waste:'Desperdício',consumption:'Consumo',sale:'Venda',transfer_dispatch:'Transferência enviada',transfer_receive:'Transferência recebida'};
const available=(i:Ingredient)=>i.quantity-i.reserved;
const status=(i:Ingredient)=>available(i)<=0?'empty':available(i)<=i.minimum?'low':'ok';
const statusNames:Record<string,string>={empty:'Sem stock disponível',low:'Stock baixo',ok:'Stock suficiente'};

export default function Inventory({business,rows,onSaved,loading}:Props){
 const [query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[sort,setSort]=useState('name'),[removed,setRemoved]=useState<Ingredient[]>([]);
 const [editor,setEditor]=useState<{kind:'create'|'edit'|'stock';item?:Ingredient}|null>(null);
 const [target,setTarget]=useState<Ingredient|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const [history,setHistory]=useState<Ingredient|null>(null),[movements,setMovements]=useState<any[]>([]),[historyLoading,setHistoryLoading]=useState(false),[removedLoading,setRemovedLoading]=useState(false);
 const [movementReason,setMovementReason]=useState('restock');
 const dialog=useRef<HTMLDialogElement>(null),heading=useRef<HTMLHeadingElement>(null);
 async function request(path:string,options:RequestInit={}){
  const r=await fetch('/api/v1/manage/businesses/'+encodeURIComponent(business)+'/inventory'+path,{...options,credentials:'include',headers:{'content-type':'application/json',...options.headers}});
  const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.message||'Não foi possível concluir a operação.');return d;
 }
 useEffect(()=>{if(!editor)return;heading.current?.focus();heading.current?.scrollIntoView({block:'nearest'});},[editor]);
 useEffect(()=>{if(target)dialog.current?.showModal();else dialog.current?.close();},[target]);
 useEffect(()=>{
  if(filter!=='removed')return;const controller=new AbortController();setRemovedLoading(true);
  request('?removed=1',{signal:controller.signal}).then(d=>setRemoved(d.inventory)).catch(e=>{if(e.name!=='AbortError')setError(e.message)}).finally(()=>{if(!controller.signal.aborted)setRemovedLoading(false)});
  return()=>controller.abort();
 },[filter,business]);
 useEffect(()=>{
  if(!history)return;const controller=new AbortController();setMovements([]);setHistoryLoading(true);
  request('/'+encodeURIComponent(history.id)+'/movements',{signal:controller.signal}).then(d=>setMovements(d.movements)).catch(e=>{if(e.name!=='AbortError')setError(e.message)}).finally(()=>{if(!controller.signal.aborted)setHistoryLoading(false)});
  return()=>controller.abort();
 },[history,business]);
 function open(kind:'create'|'edit'|'stock',item?:Ingredient){setEditor({kind,item:item?{...item}:undefined});setMovementReason('restock');setError('');setMessage('');}
 async function mutate(path:string,method:string,body:any,success:string):Promise<boolean>{
  setBusy(true);setError('');setMessage('');
  try{await request(path,{method,body:JSON.stringify(body)});setMessage(success);await onSaved();if(filter==='removed')setRemoved((await request('?removed=1')).inventory);return true;}
  catch(e){setError(e instanceof Error?e.message:'Não foi possível guardar.');return false;}finally{setBusy(false);}
 }
 async function submit(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();if(!editor)return;const form=new FormData(e.currentTarget),item=editor.item,path=item?'/'+encodeURIComponent(item.id):'';
  let body:any={name:form.get('name'),unit:form.get('unit'),minimum:Number(form.get('minimum')),supplier:form.get('supplier')};
  if(editor.kind==='create')body.quantity=Number(form.get('quantity'));
  if(item)body.version=item.version;
  if(editor.kind==='stock')body={version:item!.version,reason:form.get('reason'),quantity:Number(form.get('quantity')),direction:form.get('direction')};
  if(await mutate(path+(editor.kind==='stock'?'/stock':''),editor.kind==='edit'?'PATCH':'POST',body,editor.kind==='stock'?'Movimento registado.':editor.kind==='create'?'Ingrediente criado.':'Ingrediente atualizado.')){setEditor(null);setHistory(null);}
 }
 const normalized=query.trim().toLocaleLowerCase('pt-PT');
 const shown=(filter==='removed'?removed:rows).filter(i=>(i.name+' '+i.supplier).toLocaleLowerCase('pt-PT').includes(normalized)&&(filter==='low'?status(i)!=='ok':filter==='empty'?status(i)==='empty':true)).sort((a,b)=>sort==='available'?available(a)-available(b)||a.name.localeCompare(b.name,'pt-PT'):a.name.localeCompare(b.name,'pt-PT'));
 const low=rows.filter(i=>status(i)!=='ok').length;
 return <section className="inventory-workspace" aria-label="Gestão de ingredientes">
  <div className="section-heading inventory-heading"><div><h2>Ingredientes e stock</h2><p className="muted">{rows.length} ingredientes ativos · {low} a repor</p></div><button className="primary" disabled={busy||loading} onClick={()=>open('create')}>Adicionar ingrediente</button></div>
  <p className="inventory-help">O stock disponível corresponde ao total menos as quantidades reservadas para encomendas.</p>
  {message&&<p className="notice" role="status">{message}</p>}{error&&<p className="notice error" role="alert">{error} <button type="button" disabled={busy} onClick={async()=>{await onSaved();setEditor(null);setError('');}}>Atualizar lista</button></p>}
  <div className="inventory-toolbar">
   <label>Pesquisar ingrediente ou fornecedor<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Ex.: farinha, queijo ou fornecedor"/></label>
   <label>Mostrar<select aria-label="Mostrar" value={filter} onChange={e=>{setFilter(e.target.value);setEditor(null);setHistory(null);setError('');}} disabled={busy}><option value="all">Todos os ativos</option><option value="low">A repor ({low})</option><option value="empty">Sem stock disponível</option><option value="removed">Removidos</option></select></label>
   <label>Ordenar por<select aria-label="Ordenar por" value={sort} onChange={e=>setSort(e.target.value)}><option value="name">Nome</option><option value="available">Menor stock disponível</option></select></label>
  </div>
  {filter==='removed'&&<p className="inventory-help">Os ingredientes removidos mantêm o histórico. Pode restaurá-los para voltar a utilizá-los.</p>}
  <article className="panel inventory-list" aria-busy={loading||removedLoading}>
   <p className="inventory-results" role="status">{removedLoading?'A carregar ingredientes removidos…':shown.length+' ingrediente'+(shown.length===1?'':'s')+(normalized?' encontrado'+(shown.length===1?'':'s'):'')}</p>
   <div className="inventory-table-wrap"><table className="inventory-table"><caption className="inventory-sr">Inventário de ingredientes e ações de gestão</caption><thead><tr><th scope="col">Ingrediente</th><th scope="col">Stock total</th><th scope="col">Reservado</th><th scope="col">Disponível / mínimo</th><th scope="col">Estado</th><th scope="col">Ações</th></tr></thead><tbody>
   {shown.map(i=><tr key={i.id}><th scope="row"><span>{i.name}</span><small>{i.supplier||'Sem fornecedor'}{i.recipe_count?(' · '+i.recipe_count+(i.recipe_count===1?' receita':' receitas')):''}</small></th><td data-label="Stock total">{number(i.quantity)} {i.unit}</td><td data-label="Reservado">{number(i.reserved)} {i.unit}</td><td data-label="Disponível / mínimo"><strong>{number(available(i))}</strong> / {number(i.minimum)} {i.unit}</td><td data-label="Estado"><span className={'inventory-state '+(filter==='removed'?'removed':status(i))}>{filter==='removed'?'Removido':statusNames[status(i)]}</span></td><td><div className="inventory-actions">{filter==='removed'?<button disabled={busy} aria-label={'Restaurar '+i.name} onClick={()=>mutate('/'+encodeURIComponent(i.id)+'/restore','POST',{version:i.version},'Ingrediente restaurado.')}>Restaurar</button>:<><button disabled={busy} aria-label={'Editar '+i.name} onClick={()=>open('edit',i)}>Editar</button><button disabled={busy} aria-label={'Registar movimento de '+i.name} onClick={()=>open('stock',i)}>Registar movimento</button></>}<button disabled={busy} aria-label={'Ver histórico de '+i.name} onClick={()=>{setHistory({...i});setEditor(null)}}>Histórico</button>{filter!=='removed'&&<button className="inventory-danger" disabled={busy} aria-label={'Remover '+i.name} onClick={()=>{setTarget({...i});setEditor(null)}}>Remover</button>}</div></td></tr>)}
   </tbody></table></div>
   {!shown.length&&!removedLoading&&<div className="inventory-empty"><h3>{query?'Nenhum ingrediente corresponde à pesquisa.':filter==='removed'?'Não existem ingredientes removidos.':filter==='all'?'Comece por adicionar os ingredientes do seu negócio.':'Não existem ingredientes neste estado.'}</h3><p>{query?'Experimente outro nome ou fornecedor.':filter==='all'?'Defina a unidade, o stock inicial e o mínimo para receber alertas de reposição.':'Escolha outro filtro para consultar os restantes ingredientes.'}</p>{query&&<button onClick={()=>setQuery('')}>Limpar pesquisa</button>}</div>}
  </article>
  {editor&&<article className="panel inventory-editor" key={editor.kind+(editor.item?.id||'new')}><div className="section-heading"><h2 tabIndex={-1} ref={heading}>{editor.kind==='create'?'Adicionar ingrediente':editor.kind==='stock'?'Registar movimento · '+editor.item?.name:'Editar · '+editor.item?.name}</h2><button disabled={busy} onClick={()=>setEditor(null)}>Cancelar</button></div>
   {editor.kind==='stock'&&<p>Stock total: <strong>{editor.item!.quantity} {editor.item!.unit}</strong> · Reservado: {editor.item!.reserved} · Disponível: <strong>{available(editor.item!)} {editor.item!.unit}</strong></p>}
   <form onSubmit={submit}><fieldset disabled={busy} className="inventory-form">{editor.kind==='stock'?<>
    <label>Tipo de movimento<select aria-label="Tipo de movimento" name="reason" value={movementReason} onChange={e=>setMovementReason(e.target.value)}><option value="restock">Reposição — entrada</option><option value="waste">Desperdício — saída</option><option value="adjustment">Correção de stock</option></select></label>
    {movementReason==='adjustment'&&<label>Direção<select aria-label="Direção" name="direction"><option value="in">Entrada</option><option value="out">Saída</option></select></label>}
    <label>Quantidade ({editor.item!.unit})<input type="number" name="quantity" required min={1} max={2147483647} step={1}/></label>
    <p className="inventory-help">Introduza sempre um valor positivo. O tipo de movimento determina a entrada ou saída. As quantidades reservadas ficam protegidas.</p>
   </>:<>
    <label>Nome do ingrediente<input name="name" required maxLength={100} defaultValue={editor.item?.name||''}/></label>
    <label>Unidade de stock<input name="unit" required maxLength={20} list="inventory-units" defaultValue={editor.item?.unit||'un'}/></label><datalist id="inventory-units"><option value="un">Unidades</option><option value="g">Gramas</option><option value="ml">Mililitros</option><option value="kg">Quilogramas inteiros</option><option value="l">Litros inteiros</option></datalist>
    {editor.kind==='create'&&<label>Stock inicial<input name="quantity" type="number" required min={0} max={2147483647} step={1} defaultValue={0}/></label>}
    <label>Stock mínimo disponível<input name="minimum" type="number" required min={0} max={2147483647} step={1} defaultValue={editor.item?.minimum??5}/></label>
    <label>Fornecedor (opcional)<input name="supplier" maxLength={200} defaultValue={editor.item?.supplier||''}/></label>
    <p className="inventory-help">As quantidades são números inteiros. Para pesar frações de quilo ou de litro, use g ou ml. O alerta aparece quando o stock disponível atinge o mínimo.{editor.kind==='edit'?' Para alterar quantidades, utilize Registar movimento.':''}</p>
   </>}<button className="primary">{busy?'A guardar…':editor.kind==='stock'?'Registar movimento':editor.kind==='create'?'Criar ingrediente':'Guardar alterações'}</button></fieldset></form>
  </article>}
  {history&&<article className="panel inventory-history"><div className="section-heading"><h2>Histórico · {history.name}</h2><button onClick={()=>setHistory(null)}>Fechar histórico</button></div><p className="muted">Últimos 100 movimentos · unidade: {history.unit}</p>{historyLoading?<p role="status">A carregar movimentos…</p>:movements.length?<ol>{movements.map(m=><li key={m.id}><span>{new Date(Number(m.created_at)).toLocaleString('pt-PT')}</span><strong>{m.delta>0?'+':''}{number(m.delta)} {history.unit}</strong><span>{reasonNames[m.reason]||m.reason}</span></li>)}</ol>:<p>Este ingrediente ainda não tem movimentos registados.</p>}</article>}
  <dialog className="inventory-dialog" ref={dialog} onCancel={e=>{if(busy)e.preventDefault()}} onClose={()=>setTarget(null)} aria-labelledby="inventory-remove-title">
   <h2 id="inventory-remove-title">Remover {target?.name}?</h2><p>O ingrediente deixa de aparecer na lista ativa. O histórico fica guardado e poderá restaurá-lo em Mostrar → Removidos.</p><p>Para remover, o stock deve estar a zero, sem reservas, receitas, extras ou transferências pendentes.</p><div className="inventory-actions"><button autoFocus disabled={busy} onClick={()=>setTarget(null)}>Cancelar</button><button className="inventory-danger" disabled={busy} onClick={async()=>{if(!target)return;const ok=await mutate('/'+encodeURIComponent(target.id),'DELETE',{version:target.version},'Ingrediente removido. Pode restaurá-lo na lista de removidos.');setTarget(null);if(ok)setHistory(null);}}>{busy?'A remover…':'Remover ingrediente'}</button></div>
  </dialog>
 </section>;
}
