const keyPattern=/^uploads\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.webp$/;
const encoder=new TextEncoder();
async function authorized(request,secret){
 const token=request.headers.get('x-foodtruck-backup');
 if(typeof secret!=='string'||secret.length<32||token?.length!==secret.length)return false;
 const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
 const candidate=await crypto.subtle.importKey('raw',encoder.encode(token),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const payload=encoder.encode('foodtruck-media-backup');
 return crypto.subtle.verify('HMAC',key,await crypto.subtle.sign('HMAC',candidate,payload),payload);
}
export async function backupMedia(request,env){
 const url=new URL(request.url);if(url.pathname!=='/api/v1/platform-backup/media')return null;
 const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
 if(request.method!=='GET')return json({message:'Método indisponível.'},405);
 if(!await authorized(request,env.BACKUP_TOKEN))return json({message:'Autorização necessária.'},403);
 if(!env.MEDIA)return json({message:'Armazenamento indisponível.'},503);
 const key=url.searchParams.get('key');
 if(key!==null){
  if(!keyPattern.test(key))return json({message:'Ficheiro inválido.'},400);
  const object=await env.MEDIA.get(key);if(!object)return json({message:'Imagem indisponível.'},404);
  if(object.etag!==url.searchParams.get('etag'))return json({message:'A imagem mudou durante o backup.'},412);
  if(object.size>8*1024*1024)return json({message:'Imagem acima do limite do piloto.'},413);
  return new Response(object.body,{headers:{'Content-Type':'application/octet-stream','Cache-Control':'no-store','X-Backup-Etag':object.etag}});
 }
 const cursor=url.searchParams.get('cursor')||undefined;if(cursor?.length>2048)return json({message:'Cursor inválido.'},400);
 const page=await env.MEDIA.list({prefix:'uploads/',limit:100,cursor});
 if(page.objects.some(o=>!keyPattern.test(o.key)))return json({message:'Existem ficheiros fora do formato suportado.'},409);
 return json({objects:page.objects.map(o=>({key:o.key,size:o.size,etag:o.etag})),cursor:page.truncated?page.cursor:null});
}
