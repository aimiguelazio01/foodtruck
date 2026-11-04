// Runtime-independent database port shared by the Fastify/PostgreSQL API and the Cloudflare Worker/D1 API.
//
// Rules for shared SQL (so one statement runs unchanged on PostgreSQL and SQLite/D1):
//  - use `?` placeholders; the PostgreSQL adapter rewrites them to $1..$n;
//  - no `::type` casts, `FOR UPDATE`, advisory locks or `RETURNING`; use `CAST(x AS integer)`;
//  - in `INSERT ... SELECT`, wrap numeric parameters in CAST (PostgreSQL types bare parameters as text);
//  - never bind booleans; use 0/1 integers and `CASE WHEN ... THEN 1 ELSE 0 END`.
//
// There are no interactive transactions. A write is "pre-validation reads (for precise messages)"
// followed by ONE atomic `batch` whose statements re-assert every precondition in SQL.

export type Param = string | number | null;

export interface Statement {
  sql: string;
  params?: Param[];
  /** The statement must change exactly this many rows, or the whole batch rolls back. */
  expectChanges?: number;
  /** Business whose realtime subscribers are told about the change (PostgreSQL LISTEN/NOTIFY; D1 relies on domain_events polling). */
  notify?: string;
}

export interface Db {
  all<T = Record<string, unknown>>(sql: string, params?: Param[]): Promise<T[]>;
  first<T = Record<string, unknown>>(sql: string, params?: Param[]): Promise<T | null>;
  /** Runs all statements atomically. Throws {@link WriteConflict} when a guard, constraint or `expectChanges` fails. */
  batch(statements: Statement[]): Promise<void>;
}

export class HttpError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
    this.name = 'HttpError';
  }
}

/** A guarded write lost a race or violated a constraint; nothing was written. */
export class WriteConflict extends Error {
  constructor(message = 'Write conflict') {
    super(message);
    this.name = 'WriteConflict';
  }
}

export const fail = (message: string, statusCode = 400): never => {
  throw new HttpError(message, statusCode);
};

/** Table every adapter uses for assertions; rows are removed at the end of each batch. */
export const GUARD_TABLE = 'write_guard';

/** Aborts the whole batch unless `conditionSql` is true when this statement runs. */
export const assertThat = (conditionSql: string, params: Param[] = []): Statement => ({
  sql: `INSERT INTO ${GUARD_TABLE}(ok) SELECT CASE WHEN ${conditionSql} THEN 1 END`,
  params,
});

export const newId = (): string => globalThis.crypto.randomUUID();

/** Records a change for realtime consumers (polling on D1, LISTEN/NOTIFY on PostgreSQL). */
export const changed = (businessId: string, now = Date.now()): Statement => ({
  sql: 'INSERT INTO domain_events(id,business_id,created_at) VALUES(?,?,?)',
  params: [newId(), businessId, now],
  notify: businessId,
});

export const audit = (businessId: string, userId: string | null, action: string, now = Date.now()): Statement => ({
  sql: 'INSERT INTO audit_events(id,business_id,user_id,action,created_at) VALUES(?,?,?,?,?)',
  params: [newId(), businessId, userId, action, now],
});

/** Constraint violations that mean "this write lost a race or is invalid now". */
export const isConflictMessage = (message: string): boolean =>
  /NOT NULL constraint failed|UNIQUE constraint failed|CHECK constraint failed|FOREIGN KEY constraint failed|Invalid event coordinates|retain a network owner|violates (not-null|unique|check|foreign key) constraint|integer out of range/i.test(message);
