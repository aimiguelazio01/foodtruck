import {parentPort,workerData} from 'node:worker_threads';import {openDatabase} from '../../lib/database.mjs';import {placeOrder} from '../../lib/orders.mjs';
let db;try{db=openDatabase(workerData.path);const id=placeOrder(db,workerData.input);parentPort.postMessage({ok:true,id});}catch(e){parentPort.postMessage({ok:false,error:e.message});}finally{db?.close();}
