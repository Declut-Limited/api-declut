// dashboard listed first — explicit instruction, 2026-09-17 ("make sure
// dashboard permissions object always comes first"): buildAdminPermissions()
// below builds its output via Object.fromEntries over this array, so key
// order here is what fixes the resulting permissions object's key order too.
// waitlist/referrals/feedback added the same day — referrals and feedback
// have no actual module/endpoints in this codebase yet (grepped, confirmed
// absent) — their buckets are added dormant, same precedent as the
// `notifications` bucket sitting unused for a while before Notification
// Broadcasts came along to need it. waitlist's endpoints are real and gated
// with these permissions as of the same change (see AdminWaitlistController).
export const ADMIN_PERMISSION_MODULES = [
  'dashboard',
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
  'waitlist',
  'referrals',
  'feedback',
  // Added 2026-09-26 — KYC override used to be gated under 'users'/write on
  // the operational AdminController; it now has its own dedicated module
  // (src/kyc/admin-kyc.controller.ts) and its own bucket, deliberately not
  // backfilled onto existing Roles (unlike waitlist's own bucket addition,
  // which explicitly preserved existing de-facto access) — this is a real,
  // intentional narrowing: an admin who could override KYC via users/write
  // before this now needs kyc/write granted explicitly.
  'kyc',
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
