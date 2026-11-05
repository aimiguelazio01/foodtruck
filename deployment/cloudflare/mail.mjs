import { HttpError } from '../../packages/backend/db/port.js';

// Account email for the API Worker. Brevo over HTTPS only (no Node APIs). Mirrors services/api/src/account-mail.ts.
const addressPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

const content = {
  verify: {
    subject: 'Confirme o seu email — Food Truck Live',
    text: url => `Para ativar a sua conta Food Truck Live, abra esta ligação:\n\n${url}\n\nA ligação é válida durante 24 horas. Se não pediu este registo, ignore este email.`,
  },
  'customer-reset': {
    subject: 'Recuperar palavra-passe — Food Truck Live',
    text: url => `Para definir uma nova palavra-passe, abra esta ligação:\n\n${url}\n\nSe não pediu esta alteração, ignore este email.`,
  },
};
content['staff-reset'] = content['customer-reset'];

const unavailable = () => new HttpError('O envio de emails ainda não está disponível. Tente novamente após a configuração do serviço.', 503);

function sender(env) {
  const from = String(env.MAIL_FROM ?? '');
  const match = from.match(/^\s*(.*?)\s*<([^<>\r\n]+)>\s*$/);
  const email = (match?.[2] ?? from).trim();
  return addressPattern.test(email) ? { email, name: match?.[1] || 'Food Truck Live' } : null;
}

export function mailConfigured(env) {
  return Boolean(env.BREVO_API_KEY && sender(env));
}

/** Fails loudly before any state is written when the deployment cannot send email. */
export function assertMailAvailable(env) {
  if (!mailConfigured(env)) throw unavailable();
}

export async function sendAccountMail(env, email, url, kind) {
  assertMailAvailable(env);
  const message = content[kind];
  if (!message) throw new Error('Unknown email kind');
  let response;
  try {
    response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender: sender(env), to: [{ email }], subject: message.subject, textContent: message.text(url) }),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new HttpError('Não foi possível enviar o email. Tente novamente mais tarde.', 502);
  }
  if (!response.ok) throw new HttpError('Não foi possível enviar o email. Tente novamente mais tarde.', 502);
}
