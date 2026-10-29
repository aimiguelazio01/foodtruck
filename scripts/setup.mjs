import {existsSync,copyFileSync} from 'node:fs';
if(Number(process.versions.node.split('.')[0])<24)throw new Error('Node.js 24 or newer is required.');
if(!existsSync('.env.local'))copyFileSync('.env.example','.env.local');
process.loadEnvFile('.env.local');
const {openDatabase}=await import('../lib/database.mjs');const {authSchema}=await import('../lib/auth.mjs');const {orderSchema}=await import('../lib/orders.mjs');const db=openDatabase();try{authSchema(db);orderSchema(db);}finally{db.close();}
console.log('Database ready. Run npm run seed for demonstration data, then npm run dev.');
