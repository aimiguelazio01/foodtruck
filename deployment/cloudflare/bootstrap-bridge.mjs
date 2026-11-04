import { installationAuthorized } from './installation-worker.mjs';

export default {
  async fetch(request, env) {
    const headers = { 'Cache-Control': 'no-store' };
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/initialize') return new Response(null, { status: 404, headers });
    if (!await installationAuthorized(request, env)) return new Response(null, { status: 403, headers });
    if (!env.FOODTRUCK_SETUP) return new Response(null, { status: 503, headers });
    // The binding points only at this installation's private bootstrap Worker.
    return env.FOODTRUCK_SETUP.fetch(new Request('https://setup.internal/initialize', {
      method: 'POST', headers: { 'x-install-token': request.headers.get('x-install-token'), 'Content-Type': 'application/json' },
      body: request.body, redirect: 'manual',
    }));
  },
};
