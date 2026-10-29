import {openDatabase} from '../../../lib/database.mjs';
export const dynamic='force-dynamic';export function GET(){let db;try{db=openDatabase();db.prepare('SELECT 1').get();return Response.json({status:'ok'},{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({status:'unhealthy'},{status:503});}finally{db?.close();}}
