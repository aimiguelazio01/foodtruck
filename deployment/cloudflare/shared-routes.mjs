import { HttpError } from '../../packages/backend/db/port.js';
import { isAllowed } from '../../packages/backend/auth/capability.js';
import { changeInventory, listInventory, listMovements } from '../../packages/backend/services/inventory.js';
import { d1Db } from './d1-port.mjs';
import { readBoundedJSON } from './installation-worker.mjs';
import { businessRights } from './management-reads.mjs';
import { json, originAllowed, sessionUser } from './http.mjs';

// Routes backed by the shared services in packages/backend/services (the same code the Fastify API runs).
// Every route declares the capability Fastify's requiredCapability() assigns to the same path.
const business = String.raw`^/api/v1/manage/businesses/([a-zA-Z0-9-]{1,100})`;
const item = String.raw`/([a-zA-Z0-9-]{1,100})`;
const route = (method, suffix, capability, run) => ({ method, pattern: new RegExp(`${business}${suffix}$`), capability, run });
const inventoryChange = action => ({ db, params, body, user }) =>
  changeInventory(db, { action, businessId: params[0], itemId: params[1], body, userId: user.id });

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
      const rights = await businessRights(env.DB, user.id, params[0]);
      if (!isAllowed(rights, candidate.capability, request.method, body.command)) {
        return json({ message: 'Não tem permissão para esta operação.' }, 403);
      }
      return json(await candidate.run({ db: d1Db(env.DB), params, url, body, user, env }));
    } catch (error) {
      if (error instanceof HttpError) return json({ message: error.message }, error.statusCode);
      throw error;
    }
  }
  return null;
}
