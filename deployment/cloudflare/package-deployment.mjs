import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { loadD1Migrations } from './d1-schema.mjs';
import { buildBootstrap } from './build-bootstrap.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(version ?? '')) throw new Error('Provide a deployment version');
const output = join(root, 'output', 'cloudflare', version);
await mkdir(join(root, 'output', 'cloudflare'), { recursive: true });
await mkdir(output);
const files = {};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function write(relative, bytes) {
  const parts = relative.split('/');
  await mkdir(join(output, ...parts.slice(0, -1)), { recursive: true });
  await writeFile(join(output, ...parts), bytes, { flag: 'wx' });
  files[relative] = { bytes: bytes.length, sha256: digest(bytes) };
}

async function copyAssets(source, prefix) {
  for (const entry of (await readdir(source, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.') || /\.(?:map|pem|key|env)$/i.test(entry.name)) continue;
    const relative = `${prefix}/${entry.name}`;
    const absolute = join(source, entry.name);
    if (entry.isDirectory()) await copyAssets(absolute, relative);
    else if (entry.isFile()) await write(relative, await readFile(absolute));
    else throw new Error(`Unexpected asset: ${relative}`);
  }
}

const api = await build({ entryPoints: [fileURLToPath(new URL('./api-worker.mjs', import.meta.url))],
  bundle: true, minify: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
await write('api/api-worker.mjs', api.outputFiles[0].contents);
await write('bootstrap/bootstrap-worker.mjs', (await buildBootstrap()).outputFiles[0].contents);
const bridge = await build({ entryPoints: [fileURLToPath(new URL('./bootstrap-bridge.mjs', import.meta.url))],
  bundle: true, minify: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
await write('bridge/bootstrap-bridge.mjs', bridge.outputFiles[0].contents);
const migrations = await loadD1Migrations();
for (const migration of migrations) await write(`migrations/${migration.name}.sql`, Buffer.from(migration.sql));

const workers = { api: { entry: 'api/api-worker.mjs', visibility: 'private' },
  bootstrap: { entry: 'bootstrap/bootstrap-worker.mjs', visibility: 'private', temporary: true },
  bridge: { entry: 'bridge/bootstrap-bridge.mjs', visibility: 'public', temporary: true } };
for (const profile of ['customer', 'management']) {
  const app = join(root, 'apps', profile);
  const scratch = await import('node:fs/promises').then(fs => fs.mkdtemp(join(output, '.wrangler-')));
  try {
    const result = spawnSync(process.execPath, [join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
      'deploy', '--dry-run', '--config', 'wrangler.foodtruck.json', '--outdir', scratch], { cwd: app, stdio: 'inherit' });
    if (result.error || result.status !== 0) throw result.error ?? new Error(`Wrangler failed for ${profile}`);
    const names = (await readdir(scratch)).filter(name => !name.endsWith('.map') && name !== 'README.md');
    if (names.length !== 1 || names[0] !== 'foodtruck-worker.js') throw new Error(`Unexpected Wrangler modules for ${profile}`);
    const entry = `${profile}/foodtruck-worker.js`;
    await write(entry, await readFile(join(scratch, names[0])));
    await copyAssets(join(app, '.open-next', 'assets'), `${profile}/assets`);
    workers[profile] = { entry, assets: `${profile}/assets`, visibility: 'public' };
  } finally {
    const { rm } = await import('node:fs/promises');
    if (!scratch.startsWith(join(output, '.wrangler-'))) throw new Error('Invalid temporary directory');
    await rm(scratch, { recursive: true, force: true });
  }
}

const manifest = { format: 1, application: 'food-truck-live', version, status: 'integration-preview',
  capabilities: { onlinePayments: false, email: 'optional', images: 'optional' },
  hosting: { free: 'unverified', paid: 'unverified' }, workers,
  schema: { minimum: migrations.length, maximum: migrations.length,
    migrations: migrations.map(({ name, sha256 }) => ({ name, sha256 })) }, files };
await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
console.log(output);
