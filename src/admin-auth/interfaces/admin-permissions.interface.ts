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
  'roles',
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

// Every module defaults to false — a new Role starts with zero access until explicitly granted, never silently over-privileged. Only the known permission-module keys are ever stored, regardless of what the caller sends.
export function buildAdminPermissions(
  input?: Partial<
    Record<AdminPermissionModule, Partial<AdminModulePermissions>>
  >,
): AdminPermissions {
  return Object.fromEntries(
    ADMIN_PERMISSION_MODULES.map((moduleKey) => [
      moduleKey,
      {
        view: Boolean(input?.[moduleKey]?.view),
        write: Boolean(input?.[moduleKey]?.write),
        delete: Boolean(input?.[moduleKey]?.delete),
      },
    ]),
  ) as AdminPermissions;
}
