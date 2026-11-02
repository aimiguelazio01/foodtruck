import type {FastifyInstance} from 'fastify';
import {pool} from './db.js';

export function publicLocation(row:any){
  const event=!!row.event_id;
  const published=event||!!row.address||!!row.location_updated_at||!!row.gps_updated_at;
  const latitude=event?row.event_latitude:row.latitude;
  const longitude=event?row.event_longitude:row.longitude;
  const valid=published&&latitude!==null&&longitude!==null&&Number.isFinite(Number(latitude))&&Number.isFinite(Number(longitude))&&Math.abs(Number(latitude))<=90&&Math.abs(Number(longitude))<=180;
  return {id:row.id,name:row.name,slug:row.slug,is_open:row.is_open===1,
    location:published?{address:event?row.event_address:row.address,venue_name:event?row.venue_name:'',
      latitude:valid?Number(latitude):null,longitude:valid?Number(longitude):null,
      source:event?'event':row.location_source==='gps'?'gps':'manual',
      updated_at:event?null:row.location_updated_at?Number(row.location_updated_at):null,
      event_title:event?row.event_title:null,ends_at:event?Number(row.ends_at):null}:null};
}
export async function publicLocationRoutes(app:FastifyInstance){
  app.get('/api/v1/public/locations',async(_req,reply)=>{
    const now=Date.now();const result=await pool.query(`SELECT b.id,b.name,b.slug,s.address,s.latitude,s.longitude,s.is_open,s.location_source,s.location_updated_at,s.gps_updated_at,
      e.id event_id,e.title event_title,e.address event_address,e.venue_name,e.latitude event_latitude,e.longitude event_longitude,e.ends_at
      FROM businesses b LEFT JOIN business_settings s ON s.business_id=b.id
      LEFT JOIN organization_trucks ot ON ot.business_id=b.id
      LEFT JOIN LATERAL (SELECT * FROM events WHERE business_id=b.id AND is_public=1 AND starts_at<=$1 AND ends_at>$1 ORDER BY starts_at DESC,id LIMIT 1) e ON true
      WHERE COALESCE(ot.archived,false)=false ORDER BY b.name,b.id`,[now]);
    reply.header('Cache-Control','no-store');
    return {updated_at:now,businesses:result.rows.map(row=>publicLocation(row))};
  });
}
