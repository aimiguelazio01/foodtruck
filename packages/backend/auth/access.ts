import type {Db} from '../db/port.js';
import type {Access} from './capability.js';

export const capabilities=['menus','inventory','orders','calendar','branding','customers','reports','tasks','schedule'] as const;
export type Capability=typeof capabilities[number];

export function defaultPermissions(role:string):Record<Capability,boolean>{
 return Object.fromEntries(capabilities.map(k=>[k,role==='staff'?['menus','orders','tasks','schedule'].includes(k):role==='manager'?k!=='branding':true])) as Record<Capability,boolean>;
}

/** Role and effective permissions of a user on a business, or null when they have no access. */
export async function accessFor(db:Db,userId:string,businessId:string):Promise<Access|null>{
 const row=await db.first<{role:string}>(`SELECT role FROM (
   SELECT 'owner' AS role,0 AS priority FROM organization_members om JOIN organization_trucks ot ON ot.organization_id=om.organization_id
    WHERE om.user_id=? AND ot.business_id=? AND om.role IN ('network_owner','network_admin')
   UNION ALL SELECT m.role,1 AS priority FROM memberships m WHERE m.user_id=? AND m.business_id=?) access_rows
  ORDER BY priority LIMIT 1`,[userId,businessId,userId,businessId]);
 if(!row)return null;
 const role=row.role,isAdmin=['owner','truck_admin'].includes(role);
 // PostgreSQL returns jsonb as an object, D1 returns the stored JSON text.
 const stored=(await db.first<{permissions:unknown}>('SELECT permissions FROM membership_permissions WHERE user_id=? AND business_id=?',[userId,businessId]))?.permissions;
 const custom=typeof stored==='string'?JSON.parse(stored) as Record<string,unknown>:stored as Record<string,unknown>|undefined;
 // Existing staff can view menus; editing becomes available only through an explicit grant.
 return {role,isAdmin,custom:!!custom,
  permissions:isAdmin?defaultPermissions('owner'):custom?Object.fromEntries(capabilities.map(k=>[k,custom[k]===true])):defaultPermissions(role)};
}
