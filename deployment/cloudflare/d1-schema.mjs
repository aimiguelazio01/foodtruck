import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export async function loadD1Migrations() {
  const directory = new URL('./migrations/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'));
  const seen = new Set();
  return Promise.all(manifest.map(async ({ name, sha256 }) => {
    if (!/^[0-9]{3}_[a-z_]+$/.test(name) || seen.has(name)) throw new Error('Invalid D1 migration manifest');
    seen.add(name);
    const sql = await readFile(new URL(`${name}.sql`, directory), 'utf8');
    if (createHash('sha256').update(sql).digest('hex') !== sha256) throw new Error(`D1 migration checksum mismatch: ${name}`);
    return { name, sql, sha256 };
  }));
}
