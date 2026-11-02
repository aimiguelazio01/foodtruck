import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sendAccountMail} from '../src/account-mail.js';

const previous={...process.env};const originalFetch=globalThis.fetch;
const directory=await mkdtemp(join(tmpdir(),'foodtruck-mail-'));
try{
  process.env.NODE_ENV='production';delete process.env.BREVO_API_KEY;delete process.env.SMTP_URL;
  await assert.rejects(sendAccountMail('test@example.test','https://example.test/verify?token=test','verify'),{code:'EMAIL_UNAVAILABLE',statusCode:503});
  process.env.BREVO_API_KEY='test-key';process.env.MAIL_FROM='Food Truck Live <sender@example.test>';
  let calls=0;
  globalThis.fetch=async(input,init)=>{
    calls++;assert.equal(String(input),'https://api.brevo.com/v3/smtp/email');
    assert.equal((init?.headers as Record<string,string>)['api-key'],'test-key');
    const body=JSON.parse(String(init?.body));assert.equal(body.sender.email,'sender@example.test');assert.equal(body.to[0].email,'test@example.test');assert.match(body.textContent,/https:\/\/example.test\/verify/);
    return new Response(JSON.stringify({messageId:'test-id'}),{status:201});
  };
  assert.equal(await sendAccountMail('test@example.test','https://example.test/verify?token=test','verify'),'sent');assert.equal(calls,1);
  globalThis.fetch=async()=>new Response('provider secret error',{status:403});
  await assert.rejects(sendAccountMail('test@example.test','https://example.test/verify','verify'),(e:unknown)=>{const error=e as {code:string;message:string;statusCode:number};return error.code==='EMAIL_DELIVERY_FAILED'&&error.statusCode===502&&!error.message.includes('secret');});
  delete process.env.BREVO_API_KEY;delete process.env.VERCEL;process.env.NODE_ENV='test';process.env.DATA_DIRECTORY=directory;
  assert.equal(await sendAccountMail('test@example.test','https://example.test/reset-password?token=test','customer-reset'),'outbox');
  const row=JSON.parse((await readFile(join(directory,'customer-outbox.jsonl'),'utf8')).trim());assert.equal(row.url,'https://example.test/reset-password?token=test');
  console.log('Account email: unavailable production, Brevo payload, provider failures, and local outbox passed; no external emails sent');
}finally{
  globalThis.fetch=originalFetch;process.env=previous;await rm(directory,{recursive:true,force:true});
}
