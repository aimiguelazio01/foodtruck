import migrations from 'foodtruck:migrations';
import { applyD1Migrations } from './d1-migrate.mjs';
import { handleInstallation, installationAuthorized } from './installation-worker.mjs';

const response = (message, status) => Response.json({ message }, { status, headers: { 'Cache-Control': 'no-store' } });

export default {
  async fetch(request, env) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/initialize') return response('Página não encontrada.', 404);
    if (!await installationAuthorized(request, env)) return response('Token de configuração inválido ou expirado.', 403);
    if (typeof env.BOOTSTRAP_ID !== 'string' || !/^foodtruck-[a-f0-9]{32}$/.test(env.BOOTSTRAP_ID)) return response('Identificador de instalação inválido.', 503);
    try {
      await applyD1Migrations(env.DB, migrations);
      const receipt = await env.DB.prepare('SELECT bootstrap_id FROM installation_state WHERE id=1').first();
      if (receipt?.bootstrap_id === env.BOOTSTRAP_ID) {
        return Response.json({ ok: true, installation: env.BOOTSTRAP_ID }, { headers: { 'Cache-Control': 'no-store' } });
      }
      const url = new URL(request.url);
      url.pathname = '/api/v1/installation/complete';
      const result = await handleInstallation(new Request(url, request), env);
      if (result.status === 201) {
        return Response.json({ ok: true, installation: env.BOOTSTRAP_ID }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
      }
      return result;
    } catch {
      return response('Não foi possível preparar a base de dados. Retome a instalação para tentar novamente.', 503);
    }
  },
};
