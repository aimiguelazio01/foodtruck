import {randomBytes,createHash} from 'node:crypto';import {hashPassword} from './auth.mjs';
const digest=t=>createHash('sha256').update(t).digest('hex');
export function requestRecovery(db,email,now=Date.now()){
 if(typeof email!=='string'||email.length>254)return null;
 const user=db.prepare('SELECT id FROM users WHERE email=?').get(email.trim().toLowerCase());if(!user)return null;
 const limit='reset:'+user.id;const existing=db.prepare('SELECT * FROM request_limits WHERE key=?').get(limit);if(existing&&existing.expires>now)return null;
 const token=randomBytes(32).toString('hex');db.exec('BEGIN IMMEDIATE');try{db.prepare('DELETE FROM password_resets WHERE user_id=?').run(user.id);db.prepare('INSERT INTO password_resets VALUES(?,?,?)').run(digest(token),user.id,now+1800000);db.prepare('INSERT INTO request_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET expires=excluded.expires').run(limit,now+300000);db.exec('COMMIT');return token;}catch(e){db.exec('ROLLBACK');throw e;}
}
export function resetPassword(db,token,password,now=Date.now()){
 if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw new Error('Link inválido ou expirado.');
 const encoded=hashPassword(password);db.exec('BEGIN IMMEDIATE');try{const record=db.prepare('SELECT * FROM password_resets WHERE token_hash=? AND expires>?').get(digest(token),now);if(!record)throw new Error('Link inválido ou expirado.');db.prepare('UPDATE users SET password=? WHERE id=?').run(encoded,record.user_id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(record.user_id);db.prepare('DELETE FROM password_resets WHERE user_id=?').run(record.user_id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
}
