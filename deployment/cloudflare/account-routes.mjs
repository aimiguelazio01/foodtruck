import { HttpError } from '../../packages/backend/db/port.js';
import { json, sha256 } from './http.mjs';
import { readBoundedJSON } from './installation-worker.mjs';
import { hashPassword, verifyPassword } from './passwords.mjs';
import { assertMailAvailable, sendAccountMail } from './mail.mjs';
import { clientRateIdentity, takeRequestSlot } from './rate-limits.mjs';

// Customer accounts and password recovery for the Worker API (parity with services/api customer.ts and staff-recovery.ts).
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const tokenPattern = /^[a-f0-9]{64}$/;
const windowMs = 900_000;
const day = 86_400_000;
const sessionSeconds = 28_800;
const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
const newToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const customerCookie = (token, age) => `customer_session=${token}; HttpOnly; SameSite=Lax; Secure; Path=/; Max-Age=${age}`;
const originOk = (request, origin) => Boolean(origin) && request.headers.get('origin') === origin;
const normalizeEmail = value => (typeof value === 'string' && value.length <= 254 ? value.trim().toLowerCase() : '');
const strongPassword = value => typeof value === 'string' && value.length >= 12 && value.length <= 256;
const throttled = () => json({ message: 'Demasiados pedidos. Tente novamente mais tarde.' }, 429, { 'Retry-After': '900' });

async function body(request) {
  const input = await readBoundedJSON(request);
  if (!input || typeof input !== 'object') throw new HttpError('Pedido inválido.', 400);
  return input;
}

const link = (origin, path, token) => {
  const url = new URL(path, origin);
  url.searchParams.set('token', token);
  return url.href;
};

async function deliverVerification(env, db, customerId, email, now) {
  const token = newToken();
  await db.batch([
    db.prepare('DELETE FROM customer_verifications WHERE customer_id=?').bind(customerId),
    db.prepare('INSERT INTO customer_verifications(hash,customer_id,expires) VALUES (?,?,?)').bind(await sha256(token), customerId, now + day),
  ]);
  await sendAccountMail(env, email, link(env.CUSTOMER_ORIGIN, '/verify', token), 'verify');
}

async function register(request, env) {
  assertMailAvailable(env);
  const input = await body(request);
  const email = normalizeEmail(input.email);
  if (!emailPattern.test(email) || !strongPassword(input.password)) throw new HttpError('Indique um email válido e uma palavra-passe com pelo menos 12 caracteres.', 400);
  const db = env.DB;
  const now = Date.now();
  const id = crypto.randomUUID();
  try {
    await db.prepare('INSERT INTO customers(id,email,password,verified_at,created_at) VALUES (?,?,?,NULL,?)')
      .bind(id, email, await hashPassword(input.password), now).run();
  } catch (error) {
    if (/UNIQUE/i.test(String(error?.message))) throw new HttpError('Já existe uma conta com este email.', 409);
    throw error;
  }
  try {
    await deliverVerification(env, db, id, email, now);
  } catch (error) {
    // Do not leave an unverifiable account that blocks the address.
    await db.batch([
      db.prepare('DELETE FROM customer_verifications WHERE customer_id=?').bind(id),
      db.prepare('DELETE FROM customers WHERE id=? AND verified_at IS NULL').bind(id),
    ]);
    throw error;
  }
  return json({ ok: true });
}

async function resendVerification(request, env) {
  assertMailAvailable(env);
  const input = await body(request);
  const email = normalizeEmail(input.email);
  if (!emailPattern.test(email)) throw new HttpError('Indique um email válido.', 400);
  if (!await takeRequestSlot(env.DB, 'customer-verify', await sha256(email), 3, windowMs)) {
    throw new HttpError('Aguarde alguns minutos antes de pedir outro email.', 429);
  }
  const customer = await env.DB.prepare('SELECT id FROM customers WHERE email=? AND verified_at IS NULL').bind(email).first();
  if (customer) await deliverVerification(env, env.DB, customer.id, email, Date.now());
  return json({ ok: true });
}

async function verify(request, env) {
  const { token } = await body(request);
  if (typeof token !== 'string' || !tokenPattern.test(token)) throw new HttpError('Ligação inválida ou expirada.', 400);
  const now = Date.now();
  const row = await env.DB.prepare('DELETE FROM customer_verifications WHERE hash=? AND expires>? RETURNING customer_id')
    .bind(await sha256(token), now).first();
  if (!row) throw new HttpError('Ligação inválida ou expirada.', 400);
  await env.DB.prepare('UPDATE customers SET verified_at=? WHERE id=?').bind(now, row.customer_id).run();
  return json({ ok: true });
}

async function login(request, env) {
  const input = await body(request);
  const email = normalizeEmail(input.email);
  const password = typeof input.password === 'string' && input.password.length <= 256 ? input.password : '';
  if (!await takeRequestSlot(env.DB, 'customer-login-email', await sha256(email), 5, windowMs)) throw new HttpError('Tente novamente dentro de 15 minutos.', 429);
  const customer = await env.DB.prepare('SELECT id,email,password,verified_at FROM customers WHERE email=?').bind(email).first();
  if (!await verifyPassword(password, customer?.password) || !customer) throw new HttpError('Credenciais inválidas.', 401);
  if (!customer.verified_at) throw new HttpError('Confirme primeiro o seu email.', 403);
  const token = newToken();
  await env.DB.prepare('INSERT INTO customer_sessions(hash,customer_id,expires) VALUES (?,?,?)')
    .bind(await sha256(token), customer.id, Date.now() + sessionSeconds * 1000).run();
  return json({ customer: { id: customer.id, email: customer.email } }, 200, { 'Set-Cookie': customerCookie(token, sessionSeconds) });
}

function customerToken(request) {
  return request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1] ??
    request.headers.get('cookie')?.match(/(?:^|;\s*)customer_session=([a-f0-9]{64})(?:;|$)/)?.[1];
}

async function logout(request, env) {
  const token = customerToken(request);
  if (token) await env.DB.prepare('DELETE FROM customer_sessions WHERE hash=?').bind(await sha256(token)).run();
  return json({ ok: true }, 200, { 'Set-Cookie': customerCookie('', 0) });
}

async function me(request, env) {
  const token = customerToken(request);
  const customer = token && await env.DB.prepare(`SELECT c.id,c.email FROM customer_sessions s JOIN customers c ON c.id=s.customer_id
    WHERE s.hash=? AND s.expires>? AND c.verified_at IS NOT NULL`).bind(await sha256(token), Date.now()).first();
  return customer ? json({ customer }) : json({ message: 'Autenticação necessária.' }, 401);
}

const recovery = {
  customer: { table: 'customer_password_resets', owner: 'customer_id', accounts: 'customers', sessions: 'customer_sessions', hashColumn: 'hash', origin: 'CUSTOMER_ORIGIN', ttl: 3_600_000, kind: 'customer-reset', onlyVerified: true },
  staff: { table: 'password_resets', owner: 'user_id', accounts: 'users', sessions: 'sessions', hashColumn: 'token_hash', origin: 'MANAGEMENT_ORIGIN', ttl: 1_800_000, kind: 'staff-reset', onlyVerified: false },
};

async function forgotPassword(request, env, who) {
  const r = recovery[who];
  assertMailAvailable(env);
  const input = await body(request);
  const email = normalizeEmail(input.email);
  const account = emailPattern.test(email) && await env.DB.prepare(
    `SELECT id FROM ${r.accounts} WHERE email=?${r.onlyVerified ? ' AND verified_at IS NOT NULL' : ''}`).bind(email).first();
  // Same answer whether or not the account exists.
  if (account) {
    const token = newToken();
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM ${r.table} WHERE ${r.owner}=?`).bind(account.id),
      env.DB.prepare(`INSERT INTO ${r.table}(${r.hashColumn},${r.owner},expires) VALUES (?,?,?)`).bind(await sha256(token), account.id, Date.now() + r.ttl),
    ]);
    await sendAccountMail(env, email, link(env[r.origin], '/reset-password', token), r.kind);
  }
  return json({ ok: true });
}

async function resetPassword(request, env, who) {
  const r = recovery[who];
  const { token, password } = await body(request);
  if (typeof token !== 'string' || !tokenPattern.test(token) || !strongPassword(password)) throw new HttpError('Ligação inválida ou expirada, ou palavra-passe demasiado curta.', 400);
  // Hash first: the token row is consumed only if the new password can be stored.
  const hashed = await hashPassword(password);
  const row = await env.DB.prepare(`DELETE FROM ${r.table} WHERE ${r.hashColumn}=? AND expires>? RETURNING ${r.owner} AS owner`)
    .bind(await sha256(token), Date.now()).first();
  if (!row) throw new HttpError('Ligação inválida ou expirada.', 400);
  await env.DB.batch([
    env.DB.prepare(`UPDATE ${r.accounts} SET password=? WHERE id=?`).bind(hashed, row.owner),
    env.DB.prepare(`DELETE FROM ${r.sessions} WHERE ${who === 'customer' ? 'customer_id' : 'user_id'}=?`).bind(row.owner),
    env.DB.prepare(`DELETE FROM ${r.table} WHERE ${r.owner}=?`).bind(row.owner),
  ]);
  return json({ ok: true });
}

/** Returns a Response for account routes, or null when the path is not one of them. */
export async function handleAccountRoute(request, env) {
  const { pathname } = new URL(request.url);
  const customerPost = /^\/api\/v1\/customer\/(register|verify|resend-verification|login|logout|forgot-password|reset-password)$/.exec(pathname);
  const staffPost = /^\/api\/v1\/auth\/(forgot-password|reset-password)$/.exec(pathname);
  if (request.method === 'GET' && pathname === '/api/v1/customer/me') return me(request, env);
  if (request.method !== 'POST' || !(customerPost || staffPost)) return null;
  const who = customerPost ? 'customer' : 'staff';
  if (!originOk(request, who === 'customer' ? env.CUSTOMER_ORIGIN : env.MANAGEMENT_ORIGIN)) return json({ message: 'Origem do pedido inválida.' }, 403);
  const action = (customerPost ?? staffPost)[1];
  if (action !== 'logout' && !await takeRequestSlot(env.DB, `${who}-account:${action}`, await clientRateIdentity(request), 25, windowMs)) return throttled();
  switch (action) {
    case 'register': return register(request, env);
    case 'verify': return verify(request, env);
    case 'resend-verification': return resendVerification(request, env);
    case 'login': return login(request, env);
    case 'logout': return logout(request, env);
    case 'forgot-password': return forgotPassword(request, env, who);
    default: return resetPassword(request, env, who);
  }
}
