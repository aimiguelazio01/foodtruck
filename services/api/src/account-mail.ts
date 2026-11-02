import {mkdir,appendFile} from 'node:fs/promises';
import {join} from 'node:path';

const unavailable=()=>Object.assign(new Error('O envio de emails ainda não está disponível. Tente novamente após a configuração do serviço.'),{statusCode:503,code:'EMAIL_UNAVAILABLE'});
export function assertAccountMailAvailable(){
  const configured=!!(process.env.SMTP_URL||(process.env.BREVO_API_KEY&&process.env.MAIL_FROM));
  if((process.env.NODE_ENV==='production'||process.env.VERCEL)&&!configured)throw unavailable();
}
export async function sendAccountMail(email:string,url:string,kind:'verify'|'customer-reset'|'staff-reset'){
  assertAccountMailAvailable();
  const subject=kind==='verify'?'Confirme o seu email — Food Truck Live':'Recuperar palavra-passe — Food Truck Live';
  const text=kind==='verify'?`Para ativar a sua conta Food Truck Live, abra esta ligação:\n\n${url}\n\nA ligação é válida durante 24 horas. Se não pediu este registo, ignore este email.`:`Para definir uma nova palavra-passe, abra esta ligação:\n\n${url}\n\nSe não pediu esta alteração, ignore este email.`;
  try{
    if(process.env.BREVO_API_KEY){
      const from=process.env.MAIL_FROM||'';
      const match=from.match(/^\s*(.*?)\s*<([^<>\r\n]+)>\s*$/);
      const address=(match?.[2]||from).trim();
      if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address))throw unavailable();
      const response=await fetch('https://api.brevo.com/v3/smtp/email',{
        method:'POST',headers:{'api-key':process.env.BREVO_API_KEY,'Content-Type':'application/json'},
        body:JSON.stringify({sender:{email:address,name:match?.[1]||'Food Truck Live'},to:[{email}],subject,textContent:text}),signal:AbortSignal.timeout(20000),
      });
      if(!response.ok)throw new Error('Provider rejected email');
      return 'sent' as const;
    }
    if(process.env.SMTP_URL){
      const {default:nodemailer}=await import('nodemailer');
      await nodemailer.createTransport(process.env.SMTP_URL).sendMail({from:process.env.MAIL_FROM||'Food Truck <noreply@localhost>',to:email,subject,text});
      return 'sent' as const;
    }
    const directory=process.env.DATA_DIRECTORY||'../../data';await mkdir(directory,{recursive:true});
    await appendFile(join(directory,kind==='staff-reset'?'staff-outbox.jsonl':'customer-outbox.jsonl'),JSON.stringify({email,url,created_at:Date.now()})+'\n',{mode:0o600});
    return 'outbox' as const;
  }catch(error){
    if((error as {code?:string}).code==='EMAIL_UNAVAILABLE')throw error;
    throw Object.assign(new Error('Não foi possível enviar o email. Tente novamente mais tarde.'),{statusCode:502,code:'EMAIL_DELIVERY_FAILED'});
  }
}
