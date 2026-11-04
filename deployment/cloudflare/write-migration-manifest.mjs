import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';

// Regenerates migrations/manifest.json (name + sha256, in apply order) from the .sql files.
// Existing migrations must never change: d1-migrate.mjs refuses a database whose recorded checksums differ.
// Order is numeric prefix, then name, except the historical 003 pair which keeps its recorded position.
const directory = new URL('./migrations/', import.meta.url);
const previous = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'));
const known = new Map(previous.map(({ name, sha256 }) => [name, sha256]));
const names = (await readdir(directory)).filter(file => file.endsWith('.sql')).map(file => file.slice(0, -4)).sort();
const ordered = [...previous.map(({ name }) => name), ...names.filter(name => !known.has(name))];
const manifest = [];
for (const name of ordered) {
  const sha256 = createHash('sha256').update(await readFile(new URL(`${name}.sql`, directory))).digest('hex');
  if (known.has(name) && known.get(name) !== sha256) throw new Error(`Released migration ${name} was modified`);
  manifest.push({ name, sha256 });
}
await writeFile(new URL('manifest.json', directory), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`${manifest.length} migrations; added ${manifest.length - previous.length}`);
