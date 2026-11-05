// Turns deployment/demo/fixture.json into D1 statements for the shared demonstration site.
// Pure: no I/O, so the same code runs in the Node tests and inside the Worker.

// Never deleted: the D1 trigger "Organization must retain a network owner" forbids removing the last owner,
// and sessions of people looking around now should survive a reset. These rows are upserted.
export const frameTables = ['users', 'businesses', 'memberships', 'organizations', 'organization_members',
  'organization_trucks', 'organization_settings'];

// Emptied and reloaded on every reset. Listed children-first: that is the delete order, and the insert order is the reverse.
export const volatileTables = ['order_items', 'reservations', 'orders', 'stock_movements', 'audit_events', 'recipes',
  'product_details', 'event_products', 'modifier_options', 'modifier_groups', 'products', 'categories', 'events',
  'saved_locations', 'inventory', 'tasks', 'customer_notes', 'customer_sessions', 'customer_verifications',
  'customer_password_resets', 'customers', 'business_settings', 'domain_events'];

const timestampColumns = new Set(['created_at', 'pickup_at', 'starts_at', 'ends_at', 'location_updated_at', 'gps_updated_at', 'due_at']);
const quote = name => `"${name.replaceAll('"', '""')}"`;
export const demoOwnerEmail = 'owner@urban-burger.demo';
export const demoNetwork = 'demo-network';
// Not a valid scrypt/PBKDF2 hash: the demo user can only come in through /api/v1/demo/session.
export const unusablePassword = 'demo-session-only';

function insert(table, row, columns, conflict) {
  const keys = Object.keys(row).filter(key => columns.includes(key));
  const tail = conflict ?? '';
  return { sql: `INSERT INTO ${quote(table)} (${keys.map(quote).join(',')}) VALUES (${keys.map(() => '?').join(',')})${tail}`,
    params: keys.map(key => row[key]) };
}

/**
 * @param fixture parsed fixture.json ({capturedAt, tables})
 * @param schema  { tableName: [columnNames] } read from the live D1 database
 * @param now     epoch ms the dates are shifted to (the fixture's capture time becomes "now")
 */
export function buildDemoSeed(fixture, schema, now = Date.now()) {
  const shift = now - fixture.capturedAt;
  const statements = [];
  for (const table of volatileTables) if (schema[table]) statements.push({ sql: `DELETE FROM ${quote(table)}`, params: [] });

  const rows = table => (fixture.tables[table] ?? []).map(original => {
    const row = { ...original };
    for (const key of timestampColumns) if (typeof row[key] === 'number') row[key] += shift;
    if (table === 'users') row.password = unusablePassword;
    return row;
  });
  // Frame rows keep their keys; a reset only refreshes their content.
  const upsert = (table, row, keyColumns) => {
    const columns = schema[table];
    const base = insert(table, row, columns);
    const updates = Object.keys(row).filter(key => columns.includes(key) && !keyColumns.includes(key))
      .map(key => `${quote(key)}=excluded.${quote(key)}`);
    const conflict = updates.length
      ? ` ON CONFLICT(${keyColumns.map(quote).join(',')}) DO UPDATE SET ${updates.join(',')}` : ' ON CONFLICT DO NOTHING';
    statements.push({ sql: base.sql + conflict, params: base.params });
  };
  for (const row of rows('users')) upsert('users', row, ['id']);
  for (const row of rows('businesses')) upsert('businesses', row, ['id']);
  for (const row of rows('memberships')) upsert('memberships', row, ['user_id', 'business_id']);

  const owner = rows('users').find(user => user.email === demoOwnerEmail);
  if (!owner) throw new Error('A fixture não tem o utilizador de demonstração.');
  upsert('organizations', { id: demoNetwork, name: 'Rede de demonstração' }, ['id']);
  upsert('organization_members', { organization_id: demoNetwork, user_id: owner.id, role: 'network_owner' }, ['organization_id', 'user_id']);
  for (const business of rows('businesses')) {
    upsert('organization_trucks', { organization_id: demoNetwork, business_id: business.id }, ['organization_id', 'business_id']);
  }
  upsert('organization_settings', { organization_id: demoNetwork, company_name: 'Rede de demonstração' }, ['organization_id']);

  for (const table of [...volatileTables].reverse()) {
    if (!schema[table]) continue;
    for (const row of rows(table)) statements.push(insert(table, row, schema[table]));
  }
  statements.push({ sql: "INSERT INTO installation_state(id,mode) VALUES (1,'demo') ON CONFLICT(id) DO UPDATE SET mode='demo'", params: [] });
  return statements;
}
