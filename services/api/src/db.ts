import pg from "pg";
import {readFileSync} from "node:fs";
const connectionString=process.env.DATABASE_URL;
const ca=process.env.DATABASE_CA_CERT_PEM||(process.env.DATABASE_CA_CERT_FILE?readFileSync(process.env.DATABASE_CA_CERT_FILE,"utf8"):undefined);
const url=ca&&connectionString?new URL(connectionString):null;
if(url){for(const key of ['sslmode','sslrootcert','sslcert','sslkey'])url.searchParams.delete(key);}
export const pool = new pg.Pool({connectionString:url?.href||connectionString,...(ca?{ssl:{ca,rejectUnauthorized:true}}:{}),...(process.env.VERCEL?{max:5,idleTimeoutMillis:10000}:{}),connectionTimeoutMillis:15000});
pg.types.setTypeParser(20, Number);
