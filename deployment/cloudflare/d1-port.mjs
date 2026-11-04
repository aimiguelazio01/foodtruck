import { GUARD_TABLE, WriteConflict, isConflictMessage } from '../../packages/backend/db/port.js';

// Adapts a D1 binding to the shared database port (packages/backend/db/port.ts).
// D1 has no interactive transactions: `batch` is the only atomic primitive, so `expectChanges` is
// turned into a guard row that violates NOT NULL (aborting and rolling back the batch) when changes() differs.
export function d1Db(d1) {
  const prepare = (sql, params = []) => d1.prepare(sql).bind(...params);
  return {
    async all(sql, params) {
      return (await prepare(sql, params).all()).results;
    },
    async first(sql, params) {
      return (await prepare(sql, params).first()) ?? null;
    },
    async batch(statements) {
      const list = [];
      for (const { sql, params, expectChanges } of statements) {
        list.push(prepare(sql, params));
        if (expectChanges !== undefined) {
          list.push(prepare(`INSERT INTO ${GUARD_TABLE}(ok) SELECT CASE WHEN changes() = ? THEN 1 END`, [expectChanges]));
        }
      }
      list.push(prepare(`DELETE FROM ${GUARD_TABLE}`));
      try {
        await d1.batch(list);
      } catch (error) {
        if (isConflictMessage(String(error?.message ?? error)) || isConflictMessage(String(error?.cause?.message ?? ''))) {
          throw new WriteConflict(String(error?.message ?? error));
        }
        throw error;
      }
    },
  };
}
