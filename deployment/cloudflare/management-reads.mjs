const capabilities = ['menus', 'inventory', 'orders', 'calendar', 'branding', 'customers', 'reports', 'tasks', 'schedule'];
const staffCapabilities = new Set(['menus', 'orders', 'tasks', 'schedule']);

function access(row) {
  const role = row.role;
  if (!['owner', 'truck_admin', 'manager', 'staff'].includes(role)) return null;
  const isAdmin = role === 'owner' || role === 'truck_admin';
  const custom = row.permissions !== null;
  const overrides = custom ? JSON.parse(row.permissions) : null;
  return { role, isAdmin, custom, permissions: Object.fromEntries(capabilities.map(key => [key,
    isAdmin || (custom ? overrides[key] === true : role === 'staff' ? staffCapabilities.has(key) : key !== 'branding'),
  ])) };
}

const businessAccessQuery = `SELECT b.id,b.name,b.slug,b.color,COALESCE(t.archived,0) AS archived,
  CASE WHEN om.role IN ('network_owner','network_admin') THEN 'owner' ELSE m.role END AS role,p.permissions
  FROM businesses b LEFT JOIN organization_trucks t ON t.business_id=b.id
  LEFT JOIN organization_members om ON om.organization_id=t.organization_id AND om.user_id=?
  LEFT JOIN memberships m ON m.business_id=b.id AND m.user_id=?
  LEFT JOIN membership_permissions p ON p.user_id=m.user_id AND p.business_id=m.business_id
  WHERE (m.user_id IS NOT NULL OR om.role IN ('network_owner','network_admin'))`;

export async function readManagedBusinesses(db, userID) {
  const { results } = await db.prepare(`${businessAccessQuery} ORDER BY b.name,b.id`).bind(userID, userID).all();
  return results.flatMap(({ role, permissions, ...business }) => {
    const rights = access({ role, permissions });
    return rights ? [{ ...business, archived: Boolean(business.archived), ...rights }] : [];
  });
}

const resources = {
  products: ['menus', 'SELECT p.*,d.* FROM products p LEFT JOIN product_details d ON d.product_id=p.id WHERE p.business_id=? ORDER BY p.name,p.id'],
  settings: ['branding', 'SELECT * FROM business_settings WHERE business_id=?'],
};

export async function readManagedResource(db, userID, businessID, resource) {
  const [capability, sql] = resources[resource];
  const rights = await businessRights(db, userID, businessID);
  if (!rights?.permissions[capability]) return null;
  const { results } = await db.prepare(sql).bind(businessID).all();
  return { [resource]: resource === 'settings' ? results[0] ?? null : results };
}

export async function businessRights(db, userID, businessID) {
  const row = await db.prepare(`${businessAccessQuery} AND b.id=?`).bind(userID, userID, businessID).first();
  const rights = row && access(row);
  return rights ? { ...rights, archived: Boolean(row.archived) } : null;
}
