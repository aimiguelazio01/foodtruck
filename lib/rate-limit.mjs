import {createHash} from 'node:crypto';
export function rateLimit(db,key,limit=30,windowMs=60000,now=Date.now()){
 const id=createHash('sha256').update(key).digest('hex');db.exec('BEGIN IMMEDIATE');try{const row=db.prepare('SELECT * FROM request_limits WHERE key=?').get(id);if(row&&row.expires>now&&row.count>=limit)throw new Error('Demasiados pedidos. Tente novamente dentro de um minuto.');db.prepare('INSERT INTO request_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires<=? THEN 1 ELSE count+1 END,expires=CASE WHEN expires<=? THEN excluded.expires ELSE expires END').run(id,now+windowMs,now,now);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
}
