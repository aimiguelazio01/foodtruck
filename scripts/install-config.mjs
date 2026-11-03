import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
export function loadInstallEnv(){
 const file=process.env.FOODTRUCK_ENV_FILE||'.env.install';
 if(existsSync(file))process.loadEnvFile(file);
 if(process.env.DATABASE_CA_CERT_FILE&&!process.env.DATABASE_CA_CERT_PEM)process.env.DATABASE_CA_CERT_PEM=readFileSync(resolve(process.env.DATABASE_CA_CERT_FILE),'utf8');
}
export function connectionOptions(connectionString=process.env.DATABASE_URL){
 if(!connectionString)throw new Error('Configure DATABASE_URL em .env.install ou nas variáveis do servidor.');
 const url=new URL(connectionString);
 if(!['postgres:','postgresql:'].includes(url.protocol))throw new Error('É necessária uma base PostgreSQL.');
 const ca=process.env.DATABASE_CA_CERT_PEM;
 if(ca)for(const k of ['sslmode','sslrootcert','sslcert','sslkey'])url.searchParams.delete(k);
 return {connectionString:url.href,...(ca?{ssl:{ca,rejectUnauthorized:true}}:{}),connectionTimeoutMillis:15000,max:2};
}
