const publicSettings = {
  organization_id: null, app_name: 'Food Truck Live', company_name: '', logo: '',
  primary_color: '#ed8735', secondary_color: '#20271f', accent_color: '#f3a567',
  catalog_background_color: '#f5f4ef', contact_email: '', contact_phone: '', website: '',
};

export async function readPublicRoute(db, path) {
  if (path === '/api/v1/public/businesses') {
    const { results } = await db.prepare(`SELECT b.id,b.slug,b.name,b.color,s.description,s.address,
      s.latitude,s.longitude,s.is_open,s.logo,s.cover FROM businesses b
      LEFT JOIN business_settings s ON s.business_id=b.id
      LEFT JOIN organization_trucks ot ON ot.business_id=b.id
      WHERE COALESCE(ot.archived,0)=0 ORDER BY b.name,b.id`).all();
    return { businesses: results };
  }
  if (path === '/api/v1/public/app-settings') {
    const { results } = await db.prepare(`SELECT o.id AS organization_id,
      COALESCE(s.company_name,o.name) AS company_name,s.app_name,s.logo,s.primary_color,
      s.secondary_color,s.accent_color,s.catalog_background_color,s.contact_email,s.contact_phone,s.website
      FROM organizations o LEFT JOIN organization_settings s ON s.organization_id=o.id ORDER BY o.id LIMIT 2`).all();
    if (results.length !== 1) return publicSettings;
    return Object.fromEntries(Object.entries(publicSettings).map(([key, fallback]) => [key, results[0][key] ?? fallback]));
  }
  return null;
}

export async function readOrganizations(db, userID, includeStaff) {
  const members = 'SELECT o.id,o.name,om.role FROM organizations o JOIN organization_members om ON om.organization_id=o.id WHERE om.user_id=?';
  if (!includeStaff) return (await db.prepare(`${members} ORDER BY o.name,o.id`).bind(userID).all()).results;
  const { results } = await db.prepare(`${members}
    UNION SELECT o.id,o.name,'staff' AS role FROM organizations o
    JOIN organization_trucks t ON t.organization_id=o.id JOIN memberships m ON m.business_id=t.business_id
    WHERE m.user_id=? AND NOT t.archived AND NOT EXISTS (
      SELECT 1 FROM organization_members om WHERE om.organization_id=o.id AND om.user_id=?
    ) ORDER BY name,id`).bind(userID, userID, userID).all();
  return results;
}
