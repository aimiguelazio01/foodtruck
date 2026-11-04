import type {Pool} from 'pg';
import {GUARD_TABLE,WriteConflict,isConflictMessage,type Db,type Param,type Statement} from '../../../packages/backend/db/port.js';
import {pool} from './db.js';

/** Rewrites portable `?` placeholders to PostgreSQL `$n`, ignoring question marks inside string literals. */
export function toPostgres(sql:string):string{
 let out='',n=0,quoted=false;
 for(const ch of sql){
  if(ch==="'")quoted=!quoted;
  out+=!quoted&&ch==='?'?'$'+(++n):ch;
 }
 return out;
}

export class PgDb implements Db{
 constructor(private readonly source:Pick<Pool,'query'|'connect'>){}
 async all<T=Record<string,unknown>>(sql:string,params:Param[]=[]):Promise<T[]>{return (await this.source.query(toPostgres(sql),params)).rows as T[];}
 async first<T=Record<string,unknown>>(sql:string,params:Param[]=[]):Promise<T|null>{return ((await this.source.query(toPostgres(sql),params)).rows[0] as T|undefined)??null;}
 async batch(statements:Statement[]):Promise<void>{
  const client=await this.source.connect();
  try{
   await client.query('BEGIN');
   for(const statement of statements){
    const result=await client.query(toPostgres(statement.sql),statement.params??[]);
    if(statement.expectChanges!==undefined&&result.rowCount!==statement.expectChanges)throw new WriteConflict('Unexpected number of changed rows');
    if(statement.notify)await client.query("SELECT pg_notify('foodtruck_changes',$1)",[JSON.stringify({businessId:statement.notify})]);
   }
   await client.query(`DELETE FROM ${GUARD_TABLE}`);
   await client.query('COMMIT');
  }catch(error){
   await client.query('ROLLBACK').catch(()=>undefined);
   if(error instanceof WriteConflict)throw error;
   const code=(error as {code?:string}).code;
   if(['23502','23503','23505','23514','22003'].includes(code??'')||isConflictMessage(String((error as Error).message)))throw new WriteConflict(String((error as Error).message));
   throw error;
  }finally{client.release();}
 }
}

export const db:Db=new PgDb(pool);
