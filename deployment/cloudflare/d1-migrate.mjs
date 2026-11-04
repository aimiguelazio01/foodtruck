// The release generator emits each trigger's closing END on its own line.
// Keep trigger bodies intact when turning a migration into a D1 batch.
export function migrationStatements(sql) {
  const statements = [];
  let lines = [];
  for (const line of sql.split('\n')) {
    if (!lines.length && (!line.trim() || line.trimStart().startsWith('--'))) continue;
    lines.push(line);
    const trigger = /^CREATE TRIGGER\b/i.test(lines[0].trimStart());
    if (trigger ? /^END;\s*$/i.test(line.trim()) : /;\s*$/.test(line)) {
      statements.push(lines.join('\n'));
      lines = [];
    }
  }
  if (lines.length) throw new Error('Unterminated D1 migration statement');
  return statements;
}

export async function applyD1Migrations(db, migrations) {
  const batches = migrations.map(({ sql, name, sha256 }) => ({ name, sha256, statements: migrationStatements(sql) }));
  await db.prepare(`CREATE TABLE IF NOT EXISTS foodtruck_schema_migrations (
    sequence INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, sha256 TEXT NOT NULL
  )`).run();
  const { results } = await db.prepare('SELECT sequence,name,sha256 FROM foodtruck_schema_migrations ORDER BY sequence').all();
  for (const [index, row] of results.entries()) {
    const migration = batches[index];
    if (row.sequence !== index + 1 || migration?.name !== row.name || migration.sha256 !== row.sha256) {
      throw new Error(`Incompatible D1 migration history at sequence ${index + 1}`);
    }
  }
  for (let index = results.length; index < batches.length; index++) {
    const { name, sha256, statements } = batches[index];
    // Insert the unique marker first so a concurrent deployment cannot re-run DDL.
    const marker = db.prepare('INSERT INTO foodtruck_schema_migrations VALUES (?, ?, ?)').bind(index + 1, name, sha256);
    try {
      await db.batch([marker, ...statements.map(sql => db.prepare(sql))]);
    } catch (error) {
      // The request may have committed even if its acknowledgement was lost.
      const recorded = await db.prepare('SELECT name,sha256 FROM foodtruck_schema_migrations WHERE sequence=?').bind(index + 1).first();
      if (recorded?.name !== name || recorded.sha256 !== sha256) throw error;
    }
  }
  return { version: batches.length };
}
