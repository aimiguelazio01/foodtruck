// Builds the object the demonstration Worker reads from R2 ("demo/fixture.json"): the fictional data plus the
// column names of every D1 table. The columns come from the real migrations (applied to a throw-away SQLite),
// so a fixture column that no longer exists in the schema is dropped instead of breaking the reset.
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { loadD1Migrations } from '../cloudflare/d1-schema.mjs';
import { migrationStatements } from '../cloudflare/d1-migrate.mjs';

export async function buildSeedPackage() {
  const fixture = JSON.parse(await readFile(new URL('./fixture.json', import.meta.url), 'utf8'));
  const database = new DatabaseSync(':memory:');
  try {
    for (const { sql } of await loadD1Migrations()) for (const statement of migrationStatements(sql)) database.exec(statement);
    const schema = {};
    for (const { name } of database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
      schema[name] = database.prepare(`PRAGMA table_info("${name.replaceAll('"', '""')}")`).all().map(column => column.name);
    }
    return { fixture, schema };
  } finally {
    database.close();
  }
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll('\\', '/')}`).href) {
  const output = process.argv[2];
  if (!output) throw new Error('Uso: node deployment/demo/build-seed-package.mjs <ficheiro-de-saída.json>');
  const { writeFile } = await import('node:fs/promises');
  await writeFile(output, JSON.stringify(await buildSeedPackage()));
  console.log(`Pacote da demonstração escrito em ${output}`);
}
