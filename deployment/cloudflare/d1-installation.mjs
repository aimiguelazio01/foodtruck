const hasInstallation = `EXISTS(SELECT 1 FROM installation_state)
  OR EXISTS(SELECT 1 FROM users) OR EXISTS(SELECT 1 FROM organizations)
  OR EXISTS(SELECT 1 FROM businesses)`;

export async function isD1Configured(db) {
  const state = await db.prepare(`SELECT (${hasInstallation}) AS configured`).first();
  return state.configured === 1;
}

// Call only after authenticating the installer and validating the input.
// Password hashing and logo uploads take place outside the SQL batch.
export async function initializeD1Business(db, input) {
  const { email, passwordHash, name, address, phone, contactEmail, logo, primaryColor, secondaryColor, bootstrapID = null } = input;
  const [user, organization, business] = Array.from({ length: 3 }, () => crypto.randomUUID());
  const query = (sql, ...params) => db.prepare(sql).bind(...params);
  const statements = [
    query(`INSERT INTO installation_state(id,mode,bootstrap_id) VALUES (1,CASE WHEN ${hasInstallation} THEN NULL ELSE 'system' END,?)`, bootstrapID),
    query('INSERT INTO users(id,email,password) VALUES (?,?,?)', user, email, passwordHash),
    query('INSERT INTO organizations(id,name) VALUES (?,?)', organization, name),
    query("INSERT INTO organization_members VALUES (?,?,'network_owner')", organization, user),
    query('INSERT INTO businesses(id,slug,name,color) VALUES (?,?,?,?)', business, `negocio-${business.slice(0, 8)}`, name, primaryColor),
    query("INSERT INTO memberships VALUES (?,?,'owner')", user, business),
    query('INSERT INTO organization_trucks(organization_id,business_id) VALUES (?,?)', organization, business),
    query(`INSERT INTO organization_settings(organization_id,company_name,address,contact_email,contact_phone,logo,primary_color,secondary_color)
      VALUES (?,?,?,?,?,?,?,?)`, organization, name, address, contactEmail, phone, logo, primaryColor, secondaryColor),
    query(`INSERT INTO business_settings(business_id,address,contact,logo,secondary_color)
      VALUES (?,?,?,?,?)`, business, address, phone, logo, secondaryColor),
  ];
  await db.batch(statements);
  return { organization, business };
}
