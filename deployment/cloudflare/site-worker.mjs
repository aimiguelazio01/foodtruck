// The OpenNext build entry calls this with its generated handler. Keep the API
// on a service binding so its Worker needs no public URL.
export function withFoodtruckAPI(site, profile) {
  if (profile !== 'customer' && profile !== 'management') throw new Error('Unknown Food Truck site profile');
  return {
    ...site,
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      if (!url.pathname.startsWith('/api/v1/') && !url.pathname.startsWith('/uploads/')) {
        return site.fetch(request, env, ctx);
      }
      if (profile === 'customer' && !/^\/(?:uploads\/|api\/v1\/(?:public\/|customer\/|installation\/status$))/.test(url.pathname)) {
        return new Response(null, { status: 404 });
      }
      if (!env.FOODTRUCK_API) {
        return Response.json({ message: 'Serviço temporariamente indisponível.' }, { status: 503 });
      }
      // Forward the original request so method, body, Origin and session cookies
      // reach the API. Never follow a redirect from the binding in this proxy.
      return env.FOODTRUCK_API.fetch(new Request(request, { redirect: 'manual' }));
    },
  };
}
