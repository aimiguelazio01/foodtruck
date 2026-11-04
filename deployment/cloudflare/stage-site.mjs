import { copyFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const namePattern = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

export function siteConfiguration({ profile, name, apiName }, main = '.open-next/foodtruck-worker.mjs') {
  if (!['customer', 'management'].includes(profile) || !namePattern.test(name) ||
      !namePattern.test(apiName) || name === apiName) throw new Error('Invalid Cloudflare site or API Worker name');
  return {
    name, main,
    compatibility_date: '2026-11-03',
    compatibility_flags: ['nodejs_compat', 'global_fetch_strictly_public'],
    workers_dev: false,
    preview_urls: false,
    assets: { directory: '.open-next/assets', binding: 'ASSETS', run_worker_first: ['/api/v1/*', '/uploads/*'] },
    services: [
      { binding: 'WORKER_SELF_REFERENCE', service: name },
      { binding: 'FOODTRUCK_API', service: apiName },
    ],
  };
}

export async function stageSite({ directory, profile, name, apiName }) {
  const config = siteConfiguration({ profile, name, apiName });
  const output = resolve(directory, '.open-next');
  if (!(await stat(resolve(output, 'worker.js'))).isFile() || !(await stat(resolve(output, 'assets'))).isDirectory()) {
    throw new Error('Build the site with OpenNext before staging it');
  }
  await copyFile(new URL('./site-worker.mjs', import.meta.url), resolve(output, 'foodtruck-api-proxy.mjs'));
  await writeFile(resolve(output, 'foodtruck-worker.mjs'), `import site from './worker.js';
import { withFoodtruckAPI } from './foodtruck-api-proxy.mjs';
export * from './worker.js';
export default withFoodtruckAPI(site, ${JSON.stringify(profile)});
`);
  // Keep the generated profile away from the user's existing Wrangler config.
  await writeFile(resolve(directory, 'wrangler.foodtruck.json'), JSON.stringify(config, null, 2) + '\n');
  return config;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [profile, name, apiName] = process.argv.slice(2);
  if (!['customer', 'management'].includes(profile)) throw new Error('Usage: node deployment/cloudflare/stage-site.mjs <customer|management> <site-worker-name> <api-worker-name>');
  await stageSite({ directory: fileURLToPath(new URL(`../../apps/${profile}/`, import.meta.url)), profile, name, apiName });
}
