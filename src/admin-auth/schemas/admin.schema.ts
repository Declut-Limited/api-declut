import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type AdminDocument = HydratedDocument<Admin>;

// Reworked 2026-09-18, explicit instruction — 'suspended' removed entirely
// (only 3 values now: pending/active/deactivated), and the meaning of
// 'pending' flipped from "no such state" to the new default: a freshly
// created admin sits PENDING until their first successful login, which
// flips it to ACTIVE (see AdminAuthService.login()). Still no 'banned' —
// ban stays user-only.
export enum AdminAccountStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  DEACTIVATED = 'deactivated',
}

@Schema({ _id: false })
class RefreshTokenInfo {
  @Prop({ required: true })
  hashedToken: string;

  @Prop({ required: true })
  expiresAt: Date;
}

// Admin-only, not a shared/standalone schema (explicit instruction,
// 2026-09-17) — countryCode is always '+234' for now (see
// normalizeNigerianPhone()), phoneNumber is the bare local number with any
// leading 0 stripped.
@Schema({ _id: false })
export class Phone {
  @Prop({ required: true })
  phoneNumber: string;

  @Prop({ required: true, default: '+234' })
  countryCode: string;
}

// Endpoint 2 of the 3 admin-profile update endpoints (PATCH
// /admin/auth/me/dashboard-preferences), added 2026-08-27. Per-admin
// display preferences only — nothing in the app currently reads these to
// change actual behavior (e.g. rowsPerPage isn't wired into any list
// endpoint's default limit yet).
@Schema({ _id: false })
export class DashboardPreferences {
  @Prop({ trim: true, default: 'Dashboard' })
  landingPage: string;

  @Prop({ min: 1, max: 200, default: 10 })
  rowsPerPage: number;

  @Prop({
    enum: ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'],
    default: 'DD/MM/YYYY',
  })
  dateFormat: string;

  @Prop({ enum: ['12-Hour', '24-Hour'], default: '12-Hour' })
  timeFormat: string;

  @Prop({ default: 'Africa/Lagos' })
  timezone: string;

  @Prop({ trim: true, default: 'English' })
  language: string;
}

// Separate collection from User — an admin is never a User document.
@Schema({ timestamps: true })
export class Admin {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true, trim: true })
  name: string;

  // General-profile fields (added 2026-08-27, PATCH /admin/auth/me/general).
  // Optional — admins created before this existed have neither until they
  // save the general-profile form. Kept alongside `name` rather than
  // replacing it (explicit instruction): whenever either changes via that
  // endpoint, `name` is recomputed as `${firstName} ${lastName}` so every
  // existing admin.name read site keeps working unchanged.
  @Prop({ trim: true })
  firstName?: string;

  @Prop({ trim: true })
  lastName?: string;

  // Reworked 2026-09-17, explicit instruction — was a plain trimmed string
  // before this.
  @Prop({ type: Phone })
  phone?: Phone;

  // Default flipped PENDING <- ACTIVE 2026-09-18, explicit instruction — see
  // AdminAccountStatus's own comment. A one-time migration backfilled every
  // pre-existing admin to ACTIVE (using lastLoginAt's presence as the
  // signal — they'd obviously already had a first login), so this default
  // only actually applies to an admin created after this change.
  @Prop({
    type: String,
    enum: AdminAccountStatus,
    default: AdminAccountStatus.PENDING,
  })
  accountStatus: AdminAccountStatus;

  // Set once, the very first time this admin successfully logs in — the
  // same moment accountStatus flips PENDING -> ACTIVE (see
  // AdminAuthService.login()). Never touched again afterward. Added
  // 2026-09-18, explicit instruction.
  @Prop()
  initialLoginAt?: Date;

  // Updated on every login/refresh (a session being actively used), for
  // both User and Admin (see the User schema's own lastSeenAt). Judgment
  // call, flagged: "last active" could instead mean "last authenticated
  // request," but that would mean a DB write on every single guarded
  // request — a real cost this app's guards don't pay anywhere else (both
  // JwtAuthGuard and AdminJwtAuthGuard are pure stateless JWT verification,
  // zero DB lookups). login/refresh already write to the DB regardless
  // (rotating the refresh token), so piggybacking here is free by
  // comparison. Added 2026-09-18, explicit instruction.
  @Prop()
  lastSeenAt?: Date;

  @Prop({ type: DashboardPreferences, default: () => ({}) })
  dashboardPreferences: DashboardPreferences;

  // ADM-#### — assigned once at creation via CounterService. sparse since
  // admins created before this field existed have none, no backfill.
  @Prop({ unique: true, sparse: true })
  slug?: string;

  @Prop({ required: true, select: false })
  password: string;

  @Prop({ type: RefreshTokenInfo, select: false })
  refreshToken?: RefreshTokenInfo;

  // SHA-256 hash of the raw token emailed for password reset — the raw
  // token itself is never stored. Cleared on successful reset.
  @Prop({ select: false })
  passwordResetToken?: string;

  @Prop()
  passwordResetExpires?: Date;

  // Set on every successful password change — both the in-app
  // change-password flow and the forgot-password reset flow (added
  // 2026-08-27, returned on GET /admin/auth/me).
  @Prop()
  passwordChangedAt?: Date;

  // Set on every successful login (POST /admin/auth/login) — not on
  // refresh, which extends an existing session rather than starting a new
  // one. Added 2026-08-27, returned on GET /admin/auth/me.
  @Prop()
  lastLoginAt?: Date;

  // Set whenever the general-profile or dashboard-preferences endpoints
  // save a change — not on role reassignment (access control, not profile
  // content) or password change (tracked separately by passwordChangedAt).
  // Added 2026-08-27, returned on GET /admin/auth/me.
  @Prop()
  lastProfileUpdateAt?: Date;

  // The only two ACCOUNT types in this system are User and Admin — two
  // separate collections, unrelated to `role` below. `title` is a
  // free-text job title (e.g. "Operations Manager") for display only —
  // access control never branches on it.
  @Prop({ trim: true })
  title?: string;

  @Prop({ trim: true })
  company?: string;

  // Reverses the earlier "permission-based, not role-based" design
  // (explicit instruction): an admin's actual access is now entirely
  // whatever Role it's assigned — see src/roles/. No permissions object
  // lives on Admin anymore; PermissionsGuard populates this and checks
  // role.permissions fresh on every request.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Role' })
  role?: Types.ObjectId;

  // Provenance only, unrelated to access control.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Admin' })
  createdBy?: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export const AdminSchema = SchemaFactory.createForClass(Admin);
