import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import pg from 'pg';
const base=process.env.DATABASE_URL,schema='install_test_'+randomBytes(6).toString('hex'),pool=new pg.Pool({connectionString:base});
try{
 await pool.query('CREATE SCHEMA '+schema);
 const url=new URL(base);url.searchParams.set('options','-c search_path='+schema+',public');const env={...process.env,FOODTRUCK_ENV_FILE:'tmp/no-install-env',DATABASE_URL:url.href,DATABASE_MIGRATION_URL:'',BOOTSTRAP_EMAIL:'installer@example.test',BOOTSTRAP_PASSWORD:'TestInstallOnly2026!',BOOTSTRAP_ORGANIZATION:'Instalação isolada'};
 const migration=()=>spawnSync(process.execPath,['scripts/install.mjs','migrate'],{env,encoding:'utf8'});assert.equal(migration().status,0,'Migrations on empty schema');assert.equal(migration().status,0,'Repeated migrations');
 const run=()=>spawnSync(process.execPath,['scripts/bootstrap-network.mjs'],{env,encoding:'utf8'});const first=run();assert.equal(first.status,0,first.stderr);const second=run();assert.equal(second.status,1);assert.match(second.stderr,/Bootstrap recusado/);assert.ok(!first.stdout.includes(env.BOOTSTRAP_PASSWORD));const r=await pool.query('SELECT email,password FROM '+schema+'.users');assert.equal(r.rows.length,1);assert.notEqual(r.rows[0].password,env.BOOTSTRAP_PASSWORD);assert.equal((await pool.query('SELECT count(*) n FROM '+schema+'.businesses')).rows[0].n,'0');
 const check=spawnSync(process.execPath,['scripts/install.mjs','check'],{env:{...env,CUSTOMER_APP_URL:'http://localhost:3000',MANAGEMENT_APP_URL:'http://localhost:3001',INTERNAL_API_URL:'http://localhost:4000',CORS_ORIGINS:'http://localhost:3000,http://localhost:3001'},encoding:'utf8'});assert.equal(check.status,0,check.stdout);console.log('PASS: empty installation, hashed password, repeat refusal, no demo business, config validation.');
}finally{await pool.query('DROP SCHEMA '+schema+' CASCADE');await pool.end()}
