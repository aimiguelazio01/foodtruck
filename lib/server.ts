import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {openDatabase} from './database.mjs';
import {authSchema,identity} from './auth.mjs';
import {orderSchema} from './orders.mjs';
import {expireOrders} from './operations.mjs';
export async function authenticatedDatabase(){
 const token=(await cookies()).get('ft_session')?.value;const db=openDatabase();
 try{authSchema(db);orderSchema(db);const user=identity(db,token);if(!user){db.close();redirect('/login');}expireOrders(db);return {db,user};}catch(e){try{db.close();}catch{}throw e;}
}
