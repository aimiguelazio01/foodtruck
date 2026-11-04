import { readBoundedJSON } from './installation-worker.mjs';

const companyFields = ['company_name', 'legal_name', 'tax_id', 'address', 'contact_email', 'contact_phone', 'website'];
const colors = ['primary_color', 'secondary_color', 'accent_color', 'catalog_background_color'];
const brandingFields = ['app_name', 'logo', ...colors];
const administrator = `EXISTS (SELECT 1 FROM organization_members
  WHERE organization_id=? AND user_id=? AND role IN ('network_owner','network_admin'))`;

export async function canManageCompany(db, organization, user) {
  return Boolean(await db.prepare(`SELECT 1 AS allowed WHERE ${administrator}`).bind(organization, user).first());
}

export async function manageCompanySettings(db, request, organization, user, section) {
  const query = (sql, ...params) => db.prepare(sql).bind(...params);
  const forbidden = { status: 403, body: { message: 'Apenas o administrador da rede pode configurar a empresa e a aplicação.' } };
  if (!await canManageCompany(db, organization, user)) return forbidden;
  if (request.method === 'GET') {
    const settings = await query('SELECT * FROM organization_settings WHERE organization_id=?', organization).first();
    return settings ? { status: 200, body: { settings } } : { status: 404, body: { message: 'Empresa não encontrada.' } };
  }

  const body = await readBoundedJSON(request);
  const fields = section === 'company' ? companyFields : brandingFields.filter(key => key !== 'catalog_background_color' || body?.[key] !== undefined);
  const invalid = { status: 400, body: { message: 'Preencha corretamente os dados da empresa e da aplicação.' } };
  if (!body || fields.some(key => typeof body[key] !== 'string' || body[key].length > (key === 'address' ? 1000 : 250))) return invalid;
  const values = Object.fromEntries(fields.map(key => [key, body[key].trim()]));
  if (section === 'company') {
    if (!values.company_name || (values.contact_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.contact_email))) return invalid;
    if (values.website) {
      try {
        const url = new URL(values.website);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return invalid;
      } catch { return invalid; }
    }
  } else if (!values.app_name || colors.some(key => key in values && !/^#[\da-f]{6}$/i.test(values[key])) ||
      (values.logo && !/^\/uploads\/[\da-f-]{36}\.webp$/.test(values.logo))) return invalid;

  const statements = [
    query(`INSERT INTO organization_settings(organization_id,company_name) SELECT id,name FROM organizations
      WHERE id=? AND ${administrator} ON CONFLICT(organization_id) DO NOTHING`, organization, organization, user),
    query(`UPDATE organization_settings SET ${fields.map(key => `${key}=?`).join(',')}
      WHERE organization_id=? AND ${administrator}`, ...fields.map(key => values[key]), organization, organization, user),
    query(`INSERT INTO network_audit(id,organization_id,user_id,action,created_at)
      SELECT ?,?,?,?,? WHERE ${administrator}`, crypto.randomUUID(), organization, user, `settings:${section}`, Date.now(), organization, user),
  ];
  if (section === 'company') {
    statements.push(query(`UPDATE organizations SET name=? WHERE id=? AND ${administrator}`, values.company_name, organization, organization, user));
  }
  const results = await db.batch(statements);
  return results[1].meta.changes === 1 ? { status: 200, body: { ok: true } } : forbidden;
}
