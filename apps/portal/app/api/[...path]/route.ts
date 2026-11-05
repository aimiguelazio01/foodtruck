const allowed=new Set(['orders','install','admin/orders','jobs/action','oauth/start','oauth/accounts','hosting/status','admin/subscriptions','subscriptions/action','backups','restores','hosting/check','auth/activate','slugs/check','auth/signup','auth/verify','billing/checkout','billing/portal','auth/login','auth/logout','oauth/callback']);
async function proxy(request:Request,context:{params:Promise<{path:string[]}>}){
 const path=(await context.params).path.join('/');
 if(!allowed.has(path))return Response.json({message:'Operação indisponível.'},{status:404});
 const portalOrigin=process.env.PLATFORM_ORIGIN||new URL(request.url).origin;
 if(request.method==='POST'&&request.headers.get('origin')!==portalOrigin)return new Response(null,{status:403});
 const backend=process.env.PLATFORM_INTERNAL_URL||'http://127.0.0.1:4100';
 try{
  const body=request.method==='GET'?undefined:await request.text();
  if(body&&new TextEncoder().encode(body).length>16384)return new Response(null,{status:413});
  const response=await fetch(`${backend}/${path}${new URL(request.url).search}`,{method:request.method,body,headers:{'Content-Type':'application/json',Authorization:request.headers.get('authorization')||'',Cookie:request.headers.get('cookie')||'',Origin:process.env.PLATFORM_ORIGIN||'http://localhost:4200'},cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(15000)});
  const headers=new Headers({'Content-Type':'application/json','Cache-Control':'no-store'});for(const name of ['set-cookie','location']){const value=response.headers.get(name);if(value)headers.set(name,value)} return new Response(await response.text(),{status:response.status,headers});
 }catch{return Response.json({message:'Serviço de instalação indisponível.'},{status:503})}
}
export const GET=proxy;export const POST=proxy;
