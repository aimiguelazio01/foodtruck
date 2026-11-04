import { handleInstallation, readBoundedJSON } from './installation-worker.mjs';
import { verifyPassword } from './passwords.mjs';
import { readOrganizations, readPublicRoute } from './read-routes.mjs';
import { readPublicMenu } from './menu.mjs';
import { checkoutRoute } from './checkout-route.mjs';
import { orderAccess, readManagedOrders, readOrderHistory, readTrackedOrder, trackingToken } from './order-reads.mjs';
import { changeManagedOrder } from './order-change.mjs';
import { runMaintenance } from './maintenance.mjs';
import { businessRights, readManagedBusinesses, readManagedResource } from './management-reads.mjs';
import { canManageCompany, manageCompanySettings } from './company-settings.mjs';
import { mediaPath, readMedia, saveImage } from './media.mjs';
import { clientRateIdentity, takeRequestSlot } from './rate-limits.mjs';

const rateWindow = 900_000;
const throttled = () => json({ message: 'Demasiados pedidos. Tente novamente mais tarde.' }, 429, { 'Retry-After': '900' });

const sessionSeconds = 28_800;
const encoder = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
const hash = async value => hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
const cookie = (token, age) => `staff_session=${token}; HttpOnly; SameSite=Lax; Secure; Path=/; Max-Age=${age}`;
const json = (body, status = 200, headers = {}) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Foodtruck-Updates': 'poll', ...headers },
});

async function login(request, env) {
  const body = await readBoundedJSON(request);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || email.length > 254 || typeof body.password !== 'string' || body.password.length > 256) {
    return json({ message: 'Credenciais inválidas.' }, 400);
  }
  const db = env.DB;
  const now = Date.now();
  // Reserve an attempt before hashing. The cap remains atomic across isolates.
  const attempt = await db.prepare(`INSERT INTO login_attempts(email,count,reset) VALUES (?,1,?)
    ON CONFLICT(email) DO UPDATE SET count=CASE WHEN reset<=? THEN 1 ELSE count+1 END,
    reset=CASE WHEN reset<=? THEN excluded.reset ELSE reset END
    WHERE reset<=? OR count<5 RETURNING reset`).bind(email, now + 900_000, now, now, now).first();
  if (!attempt) return json({ message: 'Tente novamente dentro de 15 minutos.' }, 429);
  const user = await db.prepare('SELECT id,email,password FROM users WHERE email=?').bind(email).first();
  if (!await verifyPassword(body.password, user?.password) || !user) {
    return json({ message: 'Credenciais inválidas.' }, 401);
  }
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  await db.batch([
    db.prepare('INSERT INTO sessions(hash,user_id,expires) VALUES (?,?,?)').bind(await hash(token), user.id, now + sessionSeconds * 1000),
    db.prepare('DELETE FROM login_attempts WHERE email=? AND reset=?').bind(email, attempt.reset),
  ]);
  return json({ user: { id: user.id, email: user.email } }, 200, { 'Set-Cookie': cookie(token, sessionSeconds) });
}

function sessionToken(request) {
  return request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1] ??
    request.headers.get('cookie')?.match(/(?:^|;\s*)staff_session=([a-f0-9]{64})(?:;|$)/)?.[1];
}

async function sessionUser(request, db) {
  const token = sessionToken(request);
  if (!token) return null;
  return db.prepare(`SELECT u.id,u.email FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.hash=? AND s.expires>?`).bind(await hash(token), Date.now()).first();
}

async function logout(request, env) {
  const token = sessionToken(request);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE hash=?').bind(await hash(token)).run();
  return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
}

export default {
  async scheduled(event, env) {
    await runMaintenance(env.DB, event.scheduledTime);
  },
  async fetch(request, env) {
    try {
      const path = new URL(request.url).pathname;
      const media = mediaPath.exec(path);
      if (media && (request.method === 'GET' || request.method === 'HEAD')) return await readMedia(env, media[1], request.method === 'HEAD');
      const logo = /^\/api\/v1\/network\/([a-zA-Z0-9-]{1,100})\/company\/images$/.exec(path);
      const businessImage = /^\/api\/v1\/manage\/businesses\/([a-zA-Z0-9-]{1,100})\/images$/.exec(path);
      if ((logo || businessImage) && request.method === 'POST') {
        if (!env.MANAGEMENT_ORIGIN || request.headers.get('origin') !== env.MANAGEMENT_ORIGIN) return json({ message: 'Origem do pedido inválida.' }, 403);
        const user = await sessionUser(request, env.DB);
        if (!user) return json({ message: 'Autenticação necessária.' }, 401);
        let allowed;
        if (logo) {
          allowed = await canManageCompany(env.DB, logo[1], user.id);
        } else {
          const rights = await businessRights(env.DB, user.id, businessImage[1]);
          allowed = rights && !rights.archived && (rights.isAdmin ||
            ((rights.permissions.menus || rights.permissions.branding) && (rights.custom || rights.role !== 'staff')));
        }
        if (!allowed) return json({ message: 'Não tem permissão para esta operação.' }, 403);
        if (!await takeRequestSlot(env.DB, 'upload', user.id, 30, rateWindow)) return throttled();
        const result = await saveImage(request, env);
        return json(result.body, result.status);
      }
      const company = /^\/api\/v1\/network\/([a-zA-Z0-9-]{1,100})\/(company|branding)$/.exec(path);
      if (company && (request.method === 'POST' || (request.method === 'GET' && company[2] === 'company'))) {
        if (request.method === 'POST' && (!env.MANAGEMENT_ORIGIN || request.headers.get('origin') !== env.MANAGEMENT_ORIGIN)) {
          return json({ message: 'Origem do pedido inválida.' }, 403);
        }
        const user = await sessionUser(request, env.DB);
        if (!user) return json({ message: 'Autenticação necessária.' }, 401);
        const result = await manageCompanySettings(env.DB, request, company[1], user.id, company[2]);
        return json(result.body, result.status);
      }
      const checkout = /^\/api\/v1\/public\/businesses\/([a-z0-9-]{1,80})\/orders$/.exec(path);
      if (request.method === 'POST' && checkout) {
        if (!await takeRequestSlot(env.DB, 'checkout', await clientRateIdentity(request), 30, rateWindow)) return throttled();
        return await checkoutRoute(request, env.DB, checkout[1]);
      }
      const mutation = /^\/api\/v1\/manage\/businesses\/([a-zA-Z0-9-]{1,100})\/orders\/([0-9a-f-]{36})\/(status|payment)$/.exec(path);
      if (mutation && request.method === (mutation[3] === 'payment' ? 'POST' : 'PATCH')) {
        if (!env.MANAGEMENT_ORIGIN || request.headers.get('origin') !== env.MANAGEMENT_ORIGIN) {
          return json({ message: 'Origem do pedido inválida.' }, 403);
        }
        const user = await sessionUser(request, env.DB);
        if (!user) return json({ message: 'Autenticação necessária.' }, 401);
        if (!await orderAccess(env.DB, user.id, mutation[1])) return json({ message: 'Não tem permissão para esta operação.' }, 403);
        const input = await readBoundedJSON(request);
        if (!input) return json({ message: 'Pedido inválido.' }, 400);
        const result = await changeManagedOrder(env.DB, mutation[1], mutation[2], user.id, mutation[3], input);
        return result.status === 200 ? json({ ok: true }) : json({ message: result.message }, result.status);
      }
      if (request.method === 'GET') {
        const resource = /^\/api\/v1\/manage\/businesses\/([a-zA-Z0-9-]{1,100})\/(products|inventory|events|settings)$/.exec(path);
        if (resource || path === '/api/v1/manage/businesses' || path === '/api/v1/manage/customer-app') {
          const user = await sessionUser(request, env.DB);
          if (!user) return json({ message: 'Autenticação necessária.' }, 401);
          if (resource) {
            const result = await readManagedResource(env.DB, user.id, resource[1], resource[2]);
            return result ? json(result) : json({ message: 'Não tem permissão para esta operação.' }, 403);
          }
          if (path.endsWith('/customer-app')) {
            if (!env.CUSTOMER_ORIGIN) return json({ message: 'Página de encomendas por configurar.' }, 503);
            return new Response(null, { status: 302, headers: { Location: new URL('/', env.CUSTOMER_ORIGIN).href, 'Cache-Control': 'no-store' } });
          }
          return json({ businesses: await readManagedBusinesses(env.DB, user.id) });
        }
        const tracking = /^\/api\/v1\/customer\/orders\/([0-9a-f-]{36})$/.exec(path);
        if (tracking) {
          const token = trackingToken(request, tracking[1]);
          const order = token && await readTrackedOrder(env.DB, tracking[1], await hash(token));
          return order ? json({ order }) : json({ error: 'Not found' }, 404);
        }
        const managed = /^\/api\/v1\/manage\/businesses\/([a-zA-Z0-9-]{1,100})\/orders(?:\/([0-9a-f-]{36})\/history)?$/.exec(path);
        if (managed) {
          const user = await sessionUser(request, env.DB);
          if (!user) return json({ message: 'Autenticação necessária.' }, 401);
          const role = await orderAccess(env.DB, user.id, managed[1]);
          if (!role) return json({ message: 'Não tem permissão para esta operação.' }, 403);
          if (managed[2]) {
            const history = await readOrderHistory(env.DB, managed[1], managed[2]);
            return history ? json({ history }) : json({ message: 'Encomenda não encontrada.' }, 404);
          }
          return json({ orders: await readManagedOrders(env.DB, managed[1], role) });
        }
        const publicData = await readPublicRoute(env.DB, path);
        if (publicData) return json(publicData);
        const menu = /^\/api\/v1\/public\/businesses\/([a-z0-9-]{1,80})$/.exec(path);
        if (menu) {
          const data = await readPublicMenu(env.DB, menu[1]);
          if (!data) return json({ error: 'Not found' }, 404);
          const { catalogRevision, ...publicMenu } = data;
          return json(publicMenu);
        }
        if (['/api/v1/auth/me', '/api/v1/manage/organizations', '/api/v1/network/me/organizations'].includes(path)) {
          const user = await sessionUser(request, env.DB);
          if (!user) return json({ message: 'Autenticação necessária.' }, 401);
          if (path === '/api/v1/auth/me') return json({ user });
          return json({ organizations: await readOrganizations(env.DB, user.id, path.includes('/network/')) });
        }
      }
      if (request.method === 'POST' && ['/api/v1/auth/login', '/api/v1/auth/logout'].includes(path)) {
        if (!env.MANAGEMENT_ORIGIN || request.headers.get('origin') !== env.MANAGEMENT_ORIGIN) {
          return json({ message: 'Origem do pedido inválida.' }, 403);
        }
        if (path.endsWith('/logout')) return await logout(request, env);
        if (!await takeRequestSlot(env.DB, 'staff-login', await clientRateIdentity(request), 25, rateWindow)) return throttled();
        return await login(request, env);
      }
      return await handleInstallation(request, env) ?? json({ message: 'Página não encontrada.' }, 404);
    } catch {
      return json({ message: 'Serviço temporariamente indisponível.' }, 503);
    }
  },
};
