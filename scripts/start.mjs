import {existsSync,cpSync} from 'node:fs';import {resolve,join} from 'node:path';import {pathToFileURL} from 'node:url';
if(existsSync('.env.local'))process.loadEnvFile('.env.local');
const root=process.cwd();process.env.DATABASE_PATH=resolve(process.env.DATABASE_PATH||'data/foodtruck.sqlite');process.env.DATA_DIRECTORY=resolve(process.env.DATA_DIRECTORY||'data');
const {openDatabase}=await import('../lib/database.mjs');const {authSchema}=await import('../lib/auth.mjs');const {orderSchema}=await import('../lib/orders.mjs');const db=openDatabase();try{authSchema(db);orderSchema(db);}finally{db.close();}
const portIndex=process.argv.indexOf('-p');if(portIndex>=0)process.env.PORT=process.argv[portIndex+1];
const target=join(root,'.next','standalone');if(!existsSync(join(target,'server.js')))throw new Error('Production build missing. Run npm run build first.');
cpSync(join(root,'public'),join(target,'public'),{recursive:true});cpSync(join(root,'.next','static'),join(target,'.next','static'),{recursive:true});
await import(pathToFileURL(join(target,'server.js')).href);
