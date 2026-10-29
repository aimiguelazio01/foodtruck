'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { openDatabase } from '../lib/database.mjs';
import { authSchema,login,identity,logout,membership } from '../lib/auth.mjs';
export async function signIn(form:FormData){
 const db=openDatabase();let token:string;try{authSchema(db);token=login(db,String(form.get('email')||''),String(form.get('password')||''));}catch{redirect('/login?error=1');}finally{db.close();}
 (await cookies()).set('ft_session',token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:28800});redirect('/manage');
}
export async function signOut(){const jar=await cookies();const db=openDatabase();try{authSchema(db);logout(db,jar.get('ft_session')?.value);}finally{db.close();}jar.delete('ft_session');redirect('/login');}
export async function toggleProduct(form:FormData){
 const token=(await cookies()).get('ft_session')?.value;const db=openDatabase();
 try{authSchema(db);const user=identity(db,token);if(!user)throw new Error('Sessão expirada.');
 const product=db.prepare('SELECT business_id FROM products WHERE id=?').get(String(form.get('id'))) as {business_id:string}|undefined;
 if(!product||!membership(db,user.id,product.business_id))throw new Error('Sem acesso.');
 db.prepare('UPDATE products SET available=1-available WHERE id=? AND business_id=?').run(String(form.get('id')),product.business_id);
 }finally{db.close();}revalidatePath('/manage');revalidatePath('/b/[slug]','page');
}
