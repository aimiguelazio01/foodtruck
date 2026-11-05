import { HttpError } from '../../packages/backend/db/port.js';
import { isAllowed } from '../../packages/backend/auth/capability.js';
import { accessFor } from '../../packages/backend/auth/access.js';
import { changeInventory, listInventory, listMovements } from '../../packages/backend/services/inventory.js';
import { createProduct, updateProduct } from '../../packages/backend/services/products.js';
import { listEvents, saveEvent } from '../../packages/backend/services/events.js';
import { changeTask, listTasks } from '../../packages/backend/services/tasks.js';
import { createUser, listUsers, updatePermissions } from '../../packages/backend/services/users.js';
import { d1Db } from './d1-port.mjs';
import { readBoundedJSON } from './installation-worker.mjs';
import { hashPassword } from './passwords.mjs';
import { json, originAllowed, sessionUser } from './http.mjs';

// Routes backed by the shared services in packages/backend/services (the same code the Fastify API runs).
// Every route declares the capability Fastify's requiredCapability() assigns to the same path.
const business = String.raw`^/api/v1/manage/businesses/([a-zA-Z0-9-]{1,100})`;
const item = String.raw`/([a-zA-Z0-9-]{1,100})`;
const denied = 'Não tem permissão para esta operação.';
const route = (method, suffix, capability, run, forbidden = denied) =>
  ({ method, pattern: new RegExp(`${business}${suffix}$`), capability, run, forbidden });
const inventoryChange = action => ({ db, params, body, user }) =>
  changeInventory(db, { action, businessId: params[0], itemId: params[1], body, userId: user.id });
const taskChange = method => ({ db, params, body, user, access }) =>
  changeTask(db, { method, businessId: params[0], taskId: params[1], body, actor: { userId: user.id, role: access.role } });
const adminOnly = 'Apenas o administrador pode gerir utilizadores e permissões.';

export const sharedRoutes = [
  route('GET', '/inventory', 'inventory', async ({ db, params, url }) =>
    ({ inventory: await listInventory(db, params[0], url.searchParams.get('removed') === '1') })),
  route('GET', `/inventory${item}/movements`, 'inventory', async ({ db, params }) =>
    ({ movements: await listMovements(db, params[0], params[1]) })),
  route('POST', '/inventory', 'inventory', inventoryChange('create')),
  route('PATCH', `/inventory${item}`, 'inventory', inventoryChange('edit')),
  route('DELETE', `/inventory${item}`, 'inventory', inventoryChange('remove')),
  route('POST', `/inventory${item}/restore`, 'inventory', inventoryChange('restore')),
  route('POST', `/inventory${item}/stock`, 'inventory', inventoryChange('stock')),
  route('POST', '/products', 'menus', ({ db, params, body, user }) => createProduct(db, { businessId: params[0], body, userId: user.id })),
  route('PATCH', `/products${item}`, 'menus', ({ db, params, body, user }) =>
    updateProduct(db, { businessId: params[0], productId: params[1], body, userId: user.id })),
  route('GET', '/events', 'calendar', async ({ db, params }) => ({ events: await listEvents(db, params[0]) })),
  route('POST', '/events', 'calendar', ({ db, params, body, user, authorize }) =>
    saveEvent(db, { method: 'POST', businessId: params[0], body, userId: user.id, authorizeTarget: authorize })),
  route('PATCH', `/events${item}`, 'calendar', ({ db, params, body, user, authorize }) =>
    saveEvent(db, { method: 'PATCH', businessId: params[0], eventId: params[1], body, userId: user.id, authorizeTarget: authorize })),
  route('GET', '/tasks', 'tasks', ({ db, params, user, access }) => listTasks(db, params[0], { userId: user.id, role: access.role })),
  route('POST', '/tasks', 'tasks', taskChange('POST')),
  route('PATCH', `/tasks${item}`, 'tasks', taskChange('PATCH')),
  route('DELETE', `/tasks${item}`, 'tasks', taskChange('DELETE')),
  route('GET', '/users', 'admin', ({ db, params }) => listUsers(db, params[0]), adminOnly),
  route('POST', '/users', 'admin', ({ db, params, body, user }) =>
    createUser(db, { businessId: params[0], body, actorId: user.id, hashPassword }), adminOnly),
  route('PATCH', `/users${item}/permissions`, 'admin', ({ db, params, body, user }) =>
    updatePermissions(db, { businessId: params[0], userId: params[1], body, actorId: user.id }), adminOnly),
];

/** Returns a Response when a shared route matches, otherwise null so the caller can try its other routes. */
export async function handleSharedRoute(request, env) {
  const url = new URL(request.url);
  for (const candidate of sharedRoutes) {
    if (candidate.method !== request.method) continue;
    const match = candidate.pattern.exec(url.pathname);
    if (!match) continue;
    try {
      const mutation = request.method !== 'GET';
      if (mutation && !originAllowed(request, env)) return json({ message: 'Origem do pedido inválida.' }, 403);
      const user = await sessionUser(request, env.DB);
      if (!user) return json({ message: 'Autenticação necessária.' }, 401);
      let body = {};
      if (mutation && request.body !== null) {
        body = await readBoundedJSON(request);
        if (!body) return json({ message: 'Pedido inválido.' }, 400);
      }
      const params = match.slice(1);
      const db = d1Db(env.DB);
      const access = await accessFor(db, user.id, params[0]);
      if (!isAllowed(access, candidate.capability, request.method, body.command)) return json({ message: candidate.forbidden }, 403);
      // Same capability on another business (e.g. moving an event to a second truck).
      const authorize = async businessId => {
        if (!isAllowed(await accessFor(db, user.id, businessId), candidate.capability, request.method, body.command)) {
          throw new HttpError(denied, 403);
        }
      };
      return json(await candidate.run({ db, params, url, body, user, env, access, authorize }));
    } catch (error) {
      if (error instanceof HttpError) return json({ message: error.message }, error.statusCode);
      throw error;
    }
  }
  return null;
}
