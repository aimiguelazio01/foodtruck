import { constants } from 'node:fs';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteConfiguration, stageSite } from './stage-site.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const adapter = resolve(root, 'node_modules/@opennextjs/cloudflare');
const manifest = JSON.parse(await readFile(resolve(adapter, 'package.json'), 'utf8'));
const cli = resolve(adapter, manifest.bin['opennextjs-cloudflare']);
const profiles = process.argv.slice(2);
if (profiles.some(profile => !['customer', 'management'].includes(profile))) throw new Error('Choose customer or management');

for (const profile of profiles.length ? profiles : ['customer', 'management']) {
  const directory = resolve(root, 'apps', profile);
  const settings = { directory, profile, name: `foodtruck-${profile}`, apiName: 'foodtruck-api' };
  const config = 'wrangler.foodtruck.json';
  await copyFile(new URL('./open-next.config.ts', import.meta.url), resolve(directory, 'open-next.config.ts'), constants.COPYFILE_EXCL)
    .catch(error => { if (error.code !== 'EEXIST') throw error; });
  await writeFile(resolve(directory, config), JSON.stringify(siteConfiguration(settings, '.open-next/worker.js'), null, 2) + '\n');
  await new Promise((done, reject) => {
    const child = spawn(process.execPath, [cli, 'build', '--config', config], {
      cwd: directory, stdio: 'inherit', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? done() : reject(new Error(`OpenNext build failed for ${profile} (${code})`)));
  });
  await stageSite(settings);
}
