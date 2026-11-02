const base=process.env.SUPABASE_URL?.replace(/\/$/,'');
const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
export const usesSupabaseMedia=!!base;
export async function supabaseMedia(file:string,data?:Buffer):Promise<Buffer>{
  if(!base||!key)throw new Error('Supabase storage credentials are required');
  const bucket=encodeURIComponent(process.env.SUPABASE_STORAGE_BUCKET||'foodtruck-media');
  const response=await fetch(`${base}/storage/v1/object/${bucket}/uploads/${encodeURIComponent(file)}`,{
    method:data?'POST':'GET',
    headers:{Authorization:`Bearer ${key}`,apikey:key,...(data?{'Content-Type':'image/webp'}:{})},
    body:data?new Uint8Array(data):undefined,
    signal:AbortSignal.timeout(20000),
  });
  if(!response.ok){
    const result=await response.json().catch(()=>({})) as {statusCode?:string|number;error?:string};
    if(response.status===404||String(result.statusCode)==='404'||result.error==='not_found')throw Object.assign(new Error('Image not found'),{code:'ENOENT'});
    throw new Error(`Supabase storage request failed (${response.status})`);
  }
  return data?data:Buffer.from(await response.arrayBuffer());
}
