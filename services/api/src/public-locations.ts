import type {FastifyInstance} from 'fastify';
import {pool} from './db.js';

export function publicLocation(row:any){
  const upcoming=!row.event_id&&!row.address&&!row.location_updated_at&&!row.gps_updated_at&&!!row.next_id;
  const event=!!row.event_id||upcoming;
  const published=event||!!row.address||!!row.location_updated_at||!!row.gps_updated_at;
  const latitude=upcoming?row.next_latitude:event?row.event_latitude:row.latitude;
  const longitude=upcoming?row.next_longitude:event?row.event_longitude:row.longitude;
  const valid=published&&latitude!==null&&longitude!==null&&Number.isFinite(Number(latitude))&&Number.isFinite(Number(longitude))&&Math.abs(Number(latitude))<=90&&Math.abs(Number(longitude))<=180;
  return {id:row.id,name:row.name,slug:row.slug,is_open:row.is_open===1,
    location:published?{address:upcoming?row.next_address:event?row.event_address:row.address,venue_name:upcoming?row.next_venue:event?row.venue_name:'',
      latitude:valid?Number(latitude):null,longitude:valid?Number(longitude):null,
      source:upcoming?'upcoming':event?'event':row.location_source==='gps'?'gps':'manual',
      updated_at:event?null:row.location_updated_at?Number(row.location_updated_at):null,
      event_title:upcoming?row.next_title:event?row.event_title:null,starts_at:upcoming?Number(row.next_starts_at):null,ends_at:upcoming?Number(row.next_ends_at):event?Number(row.ends_at):null}:null};
}
export async function publicLocationRoutes(app:FastifyInstance){
  app.get('/api/v1/public/locations',async(_req,reply)=>{
    const now=Date.now();const result=await pool.query(`SELECT b.id,b.name,b.slug,s.address,s.latitude,s.longitude,s.is_open,s.location_source,s.location_updated_at,s.gps_updated_at,
      e.id event_id,e.title event_title,e.address event_address,e.venue_name,e.latitude event_latitude,e.longitude event_longitude,e.ends_at,
      n.id next_id,n.title next_title,n.address next_address,n.venue_name next_venue,n.latitude next_latitude,n.longitude next_longitude,n.starts_at next_starts_at,n.ends_at next_ends_at
      FROM businesses b LEFT JOIN business_settings s ON s.business_id=b.id
      LEFT JOIN organization_trucks ot ON ot.business_id=b.id
      LEFT JOIN LATERAL (SELECT * FROM events WHERE business_id=b.id AND is_public=1 AND starts_at<=$1 AND ends_at>$1 ORDER BY starts_at DESC,id LIMIT 1) e ON true
      LEFT JOIN LATERAL (SELECT * FROM events WHERE business_id=b.id AND is_public=1 AND starts_at>$1 ORDER BY starts_at,id LIMIT 1) n ON true
      WHERE COALESCE(ot.archived,false)=false ORDER BY b.name,b.id`,[now]);
    reply.header('Cache-Control','no-store');
    return {updated_at:now,businesses:result.rows.map(row=>publicLocation(row))};
  });
}
