import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import EmbeddedPostgres from './local-cluster.mjs';

// Usage: node scripts/with-test-postgres.mjs <script.ts> [args...]
// Starts a throwaway embedded PostgreSQL, runs the script with tsx and DATABASE_URL pointing at it, then removes it.
const [script, ...args] = process.argv.slice(2);
if (!script) throw new Error('Provide a script to run');
const dir = resolve('data/test-postgres', randomBytes(6).toString('hex'));
mkdirSync(dir, { recursive: true });
const password = randomBytes(24).toString('hex');
const port = Number(process.env.TEST_PG_PORT || 55440);
const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'tester', password, port, persistent: true,
  postgresFlags: ['-h', '127.0.0.1'], onLog: () => {}, onError: () => {} });
let code = 1;
try {
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('scenario');
  const env = { ...process.env, DATABASE_URL: `postgresql://tester:${password}@127.0.0.1:${port}/scenario` };
  for (const key of ['DATABASE_CA_CERT_FILE', 'DATABASE_CA_CERT_PEM', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'S3_BUCKET', 'BREVO_API_KEY', 'SMTP_URL', 'VERCEL']) delete env[key];
  code = await new Promise((done, reject) => {
    const child = spawn(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), script, ...args], { env, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', status => done(status ?? 1));
  });
} finally {
  await pg.stop().catch(() => {});
  rmSync(dir, { recursive: true, force: true });
}
process.exit(code);
