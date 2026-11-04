import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { loadD1Migrations } from './d1-schema.mjs';

export async function buildBootstrap() {
  const migrations = await loadD1Migrations();
  return build({ entryPoints: [fileURLToPath(new URL('./bootstrap-worker.mjs', import.meta.url))],
    bundle: true, minify: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    plugins: [{ name: 'verified-d1-migrations', setup(builder) {
      builder.onResolve({ filter: /^foodtruck:migrations$/ }, () => ({ path: 'migrations', namespace: 'foodtruck' }));
      builder.onLoad({ filter: /^migrations$/, namespace: 'foodtruck' }, () => ({ contents: JSON.stringify(migrations), loader: 'json' }));
    } }],
  });
}
