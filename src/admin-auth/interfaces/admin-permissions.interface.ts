export const ADMIN_PERMISSION_MODULES = [
  'users',
  'listings',
  'categories',
  'reviews',
  'transactions',
  'reports',
  'activity',
  'content',
  'notifications',
  'settings',
] as const;

export type AdminPermissionModule = (typeof ADMIN_PERMISSION_MODULES)[number];
export type AdminPermissionAction = 'view' | 'write' | 'delete';

export interface AdminModulePermissions {
  view: boolean;
  write: boolean;
  delete: boolean;
}

export type AdminPermissions = Record<
  AdminPermissionModule,
  AdminModulePermissions
>;
