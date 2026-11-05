const encoder=new TextEncoder();
const hex=data=>Array.from(new Uint8Array(data),v=>v.toString(16).padStart(2,'0')).join('');
async function allowed(request,env){
 const token=request.headers.get('x-foodtruck-restore');if(!token||!env.TOKEN||token.length!==env.TOKEN.length||!(Date.parse(env.EXPIRES)>Date.now()))return false;
 const key=await crypto.subtle.importKey('raw',encoder.encode(env.TOKEN),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
 const candidate=await crypto.subtle.importKey('raw',encoder.encode(token),{name:'HMAC',hash:'SHA-256'},false,['sign']);const payload=encoder.encode('restore-images');
 return crypto.subtle.verify('HMAC',key,await crypto.subtle.sign('HMAC',candidate,payload),payload);
}
export default {async fetch(request,env){
 const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
 if(!await allowed(request,env))return json({message:'Forbidden'},403);
 const key=new URL(request.url).searchParams.get('key');if(!/^uploads\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.webp$/.test(key||''))return json({message:'Invalid image'},400);
 if(request.method==='PUT'){
  const reader=request.body?.getReader();if(!reader)return json({message:'Missing image'},400);const chunks=[];let size=0;
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>8*1024*1024){await reader.cancel();return json({message:'Image too large'},413)}chunks.push(value)}
  const data=new Uint8Array(size);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length}
  const checksum=hex(await crypto.subtle.digest('SHA-256',data));if(checksum!==request.headers.get('x-content-sha256'))return json({message:'Checksum mismatch'},422);
  await env.COPY.put(key,data,{httpMetadata:{contentType:'image/webp'}});return json({sha256:checksum});
 }
 if(request.method==='GET'){const object=await env.COPY.get(key);if(!object)return json({message:'Missing image'},404);if(object.size>8*1024*1024)return json({message:'Image too large'},413);return json({sha256:hex(await crypto.subtle.digest('SHA-256',await object.arrayBuffer()))})}
 return json({message:'Method unavailable'},405);
}};
