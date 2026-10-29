import {expireOrders} from './operations.mjs';
export function runJobs(db,now=Date.now()){
 expireOrders(db,now);
 db.exec('BEGIN IMMEDIATE');try{
  for(const config of db.prepare('SELECT business_id,retention_days FROM business_settings').all()){
   db.prepare("UPDATE orders SET customer_name='Cliente anonimizado',contact='' WHERE business_id=? AND created_at<? AND status IN ('collected','cancelled')").run(config.business_id,now-config.retention_days*86400000);
   db.prepare('DELETE FROM customer_notes WHERE business_id=? AND contact NOT IN (SELECT contact FROM orders WHERE business_id=?)').run(config.business_id,config.business_id);
  }
  db.prepare('DELETE FROM sessions WHERE expires<=?').run(now);
  db.prepare('DELETE FROM password_resets WHERE expires<=?').run(now);
  db.prepare('DELETE FROM request_limits WHERE expires<=?').run(now);
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}
