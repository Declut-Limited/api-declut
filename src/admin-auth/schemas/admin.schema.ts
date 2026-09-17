import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type AdminDocument = HydratedDocument<Admin>;

// A narrower set than User's own AccountStatus — no 'pending' (an admin is
// never mid-email-verification) and no 'banned' (ban is user-only, explicit
// instruction, 2026-09-17). Default 'active', unlike User's default
// 'pending' — an admin is only ever created directly by another admin
// (createSubAdmin()) or the seed script, never through a self-serve signup
// flow with a verification gap to sit "pending" through.
export enum AdminAccountStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
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

  @Prop({
    type: String,
    enum: AdminAccountStatus,
    default: AdminAccountStatus.ACTIVE,
  })
  accountStatus: AdminAccountStatus;

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
