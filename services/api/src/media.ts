import type {FastifyInstance} from 'fastify';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import sharp from 'sharp';
import {S3Client,PutObjectCommand,GetObjectCommand} from '@aws-sdk/client-s3';
import {requireMember} from './auth.js';
import {usesSupabaseMedia,supabaseMedia} from './supabase-media.js';
const directory=resolve(process.env.DATA_DIRECTORY||'../../data','uploads');
const s3=new S3Client({region:process.env.AWS_REGION||'us-east-1',endpoint:process.env.S3_ENDPOINT||undefined,forcePathStyle:!!process.env.S3_ENDPOINT});
export async function saveImage(data:unknown){
  if(typeof data!=='string'||data.length>4200000||!/^[A-Za-z0-9+/]*={0,2}$/.test(data))throw Object.assign(new Error('Invalid image'),{statusCode:400});
  const original=Buffer.from(data,'base64');if(original.length>3*1024*1024)throw Object.assign(new Error('Maximum image size is 3 MB'),{statusCode:400});
  let output:Buffer;try{const image=sharp(original,{limitInputPixels:25000000});const meta=await image.metadata();if(!['png','jpeg','webp'].includes(meta.format||''))throw new Error();output=await image.rotate().resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).webp({quality:92,alphaQuality:100}).toBuffer();}catch{throw Object.assign(new Error('Upload a valid PNG, JPEG, or WebP image'),{statusCode:400});}
  const file=randomUUID()+'.webp';if(usesSupabaseMedia)await supabaseMedia(file,output);else if(process.env.S3_BUCKET)await s3.send(new PutObjectCommand({Bucket:process.env.S3_BUCKET,Key:'uploads/'+file,Body:output,ContentType:'image/webp'}));else{await mkdir(directory,{recursive:true});await writeFile(join(directory,file),output);}
  return {path:'/uploads/'+file};
}
export async function mediaRoutes(app:FastifyInstance){
 app.post('/api/v1/manage/businesses/:id/images',{bodyLimit:4500000},async req=>{
  await requireMember(req,(req.params as any).id,['owner','truck_admin','manager']);
  return saveImage((req.body as any)?.data);
 });
 app.get('/uploads/:file',async(req,reply)=>{const file=(req.params as any).file;if(typeof file!=='string'||!/^[-a-f0-9]{36}\.webp$/.test(file))return reply.code(404).send();try{const data=usesSupabaseMedia?await supabaseMedia(file):process.env.S3_BUCKET?await (await s3.send(new GetObjectCommand({Bucket:process.env.S3_BUCKET,Key:'uploads/'+file}))).Body!.transformToByteArray():await readFile(join(directory,file));return reply.type('image/webp').header('Cache-Control','public,max-age=31536000,immutable').send(Buffer.from(data));}catch(e:any){if(e.code==='ENOENT'||e.name==='NoSuchKey')return reply.code(404).send();throw e;}});
}
