import {openDatabase} from '../lib/database.mjs';import {authSchema} from '../lib/auth.mjs';import {orderSchema} from '../lib/orders.mjs';
const db=openDatabase();try{authSchema(db);orderSchema(db);}finally{db.close();}
await import('../server.js');
