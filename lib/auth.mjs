import { randomBytes, scryptSync, timingSafeEqual, createHash, randomUUID } from 'node:crypto';
export function authSchema(db) {
 db.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS memberships(user_id TEXT NOT NULL REFERENCES users(id),business_id TEXT NOT NULL REFERENCES businesses(id),role TEXT NOT NULL CHECK(role IN ('owner','manager','staff')),PRIMARY KEY(user_id,business_id));
 CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS login_attempts(email TEXT PRIMARY KEY,count INTEGER NOT NULL,reset INTEGER NOT NULL);`);
}
const digest=(token)=>createHash('sha256').update(token).digest('hex');
export function hashPassword(password) {
 if(typeof password!=='string'||password.length<12||password.length>256) throw new Error('A palavra-passe deve ter entre 12 e 256 caracteres.');
 const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(password,salt,64).toString('hex');
}
function verify(password,encoded) {const [salt,hash]=encoded.split(':'); const actual=scryptSync(password,salt,64);const expected=Buffer.from(hash,'hex');return expected.length===actual.length&&timingSafeEqual(actual,expected);}
export function createUser(db,email,password,business,role='owner') {
 const hash=hashPassword(password);const id=randomUUID();
 db.exec('BEGIN IMMEDIATE');try{db.prepare('INSERT INTO users VALUES(?,?,?)').run(id,email.trim().toLowerCase(),hash);db.prepare('INSERT INTO memberships VALUES(?,?,?)').run(id,business,role);db.exec('COMMIT');return id;}catch(e){db.exec('ROLLBACK');throw e;}
}
export function login(db,email,password,now=Date.now()) {
 if(typeof email!=='string'||email.length>254||typeof password!=='string'||password.length>256)throw new Error('Credenciais inválidas.');
 email=email.trim().toLowerCase();const attempts=db.prepare('SELECT * FROM login_attempts WHERE email=?').get(email);
 if(attempts&&attempts.reset>now&&attempts.count>=5)throw new Error('Tente novamente dentro de 15 minutos.');
 db.prepare('INSERT INTO login_attempts VALUES(?,1,?) ON CONFLICT(email) DO UPDATE SET count=CASE WHEN reset<=? THEN 1 ELSE count+1 END,reset=CASE WHEN reset<=? THEN excluded.reset ELSE reset END').run(email,now+900000,now,now);
 const user=db.prepare('SELECT * FROM users WHERE email=?').get(email);
 // Perform a hash calculation for unknown accounts too.
 const valid=verify(password,user?.password||('0'.repeat(32)+':'+ '0'.repeat(128)));
 if(!user||!valid)throw new Error('Credenciais inválidas.');
 db.prepare('DELETE FROM login_attempts WHERE email=?').run(email);
 const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token),user.id,now+28800000);return token;
}
export function identity(db,token,now=Date.now()) {if(!token)return null;return db.prepare('SELECT u.id,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires>?').get(digest(token),now)||null;}
export function logout(db,token){if(token)db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(token));}
export function membership(db,userId,businessId){return db.prepare('SELECT role FROM memberships WHERE user_id=? AND business_id=?').get(userId,businessId)||null;}
