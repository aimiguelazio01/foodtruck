// Single definition of who may perform which kind of operation on a business.
// Used by the Fastify API (`requireMember`) and the Cloudflare Worker routes.
export interface Access{role:string;isAdmin:boolean;custom:boolean;permissions:Record<string,boolean>}

/**
 * `capability` is the area an operation belongs to (menus, inventory, orders, calendar, ...), 'images', 'admin' or null.
 * With no capability, `roles` (when given) restricts by membership role.
 */
export function isAllowed(access:Access|null,capability:string|null,method:string,command?:unknown,roles?:string[]):boolean{
 let allowed=!!access;
 if(access&&!access.isAdmin){
  if(capability==='admin')allowed=false;
  else if(capability==='images')allowed=!!(access.permissions.menus||access.permissions.branding)&&(access.custom||access.role!=='staff');
  else if(capability){
   allowed=access.permissions[capability]===true;
   // Default (non-custom) staff may only toggle product availability on menus.
   if(!access.custom&&access.role==='staff'&&capability==='menus'&&method!=='GET')allowed=command==='availability';
  }
  else if(roles)allowed=roles.includes(access.role);
 }
 return allowed;
}
