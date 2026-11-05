import { test, after, before } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { loadD1Migrations } from './d1-schema.mjs';
import { applyD1Migrations } from './d1-migrate.mjs';
import { d1Db } from './d1-port.mjs';
import { inventoryScenarios } from '../../packages/backend/tests/inventory.scenarios.js';
import { catalogScenarios } from '../../packages/backend/tests/catalog.scenarios.js';
import { peopleScenarios } from '../../packages/backend/tests/people.scenarios.js';

// Runs the shared service scenarios on a real workerd D1 (not the synchronous node:sqlite stand-in),
// so the parallel scenarios exercise genuinely interleaved batches.
const scenarioSets = [['inventory', inventoryScenarios], ['catalog', catalogScenarios], ['people', peopleScenarios]];
let runtime;
let db;

before(async () => {
  runtime = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'shared', modules: true, compatibilityDate: '2026-11-03',
    d1Databases: ['DB'], script: 'export default { fetch() { return new Response("ok"); } }' }] }));
  const d1 = await runtime.getD1Database('DB', 'shared');
  await applyD1Migrations(d1, await loadD1Migrations());
  db = d1Db(d1);
});
after(async () => { await runtime?.dispose(); });

for (const [set, scenarios] of scenarioSets) {
  for (const scenario of scenarios) {
    test(`D1 ${set}: ${scenario.name}`, { timeout: 60_000 }, () => scenario.run(db));
  }
}
