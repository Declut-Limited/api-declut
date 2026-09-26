import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

export enum AuthProvider {
  GOOGLE = 'google',
  EMAIL_PHONE = 'email_phone',
}

export enum KycStatus {
  UNVERIFIED = 'unverified',
  PENDING = 'pending',
  VERIFIED = 'verified',
  REJECTED = 'rejected',
}

// 'pending' = not yet completed email verification (distinct from
// kycStatus, which tracks identity verification separately). Flips to
// 'active' the moment emailVerified becomes true. DEACTIVATED/BANNED added
// 2026-09-17, explicit instruction, alongside two new admin actions
// (UsersService.deactivate()/ban()) — 'suspended' stays a distinct,
// time-boxed action with its own Suspension sub-document; these two are
// simpler flat status flips, undone the same way suspend already is, via
// reactivate().
export enum AccountStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  PENDING = 'pending',
  DEACTIVATED = 'deactivated',
  BANNED = 'banned',
}

@Schema({ _id: false })
class RefreshTokenInfo {
  @Prop({ required: true })
  hashedToken: string;

  @Prop({ required: true })
  expiresAt: Date;
}

@Schema({ _id: false })
class KycInfo {
  @Prop({ default: false })
  verifiedNIN: boolean;

  @Prop({ default: false })
  livenessChecked: boolean;
}

@Schema({ _id: false })
class Suspension {
  // Permanent — never touched by unsuspend() (explicit instruction,
  // 2026-09-19: "do not remove the predefined reason"). Why the suspension
  // happened stays on record even after it's lifted; the reason it was
  // *lifted* lives in its own unsuspensionReason field below instead.
  @Prop({ required: true })
  reason: string;

  @Prop({ required: true })
  durationDays: number;

  // Nulled (not removed) by unsuspend() — required: true dropped so that
  // write doesn't fail validation. 2026-09-19, explicit instruction ("the
  // atDate ... to null"). Explicit `type: Date` — @nestjs/mongoose can't
  // infer a type from a `Date | null` union via reflection.
  @Prop({ type: Date })
  suspendedAt?: Date | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Admin', required: true })
  suspendedBy: Types.ObjectId;

  // Set only by UsersService.unsuspend() — 2026-09-19, explicit instruction.
  @Prop()
  unsuspendedAt?: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Admin' })
  unsuspendedBy?: Types.ObjectId;

  // The acting admin's own stated reason for lifting the suspension —
  // distinct from `reason` above (why it was imposed). Free text, no
  // predefined list. 2026-09-19, explicit instruction.
  @Prop({ trim: true, maxlength: 1000 })
  unsuspensionReason?: string;
}

// Mirrors Suspension above, trimmed — a ban has no duration/outcome
// concept (it's indefinite, not time-boxed). Set/cleared by
// UsersService.ban()/reactivate(), same admin-triggered pattern as
// Suspension. 2026-09-19, explicit instruction ("implement banned like we
// did for Suspension").
@Schema({ _id: false })
class Ban {
  @Prop({ required: true })
  reason: string;

  @Prop({ required: true })
  bannedAt: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Admin', required: true })
  bannedBy: Types.ObjectId;
}

// Self-service account deactivation (POST /users/me/deactivate) — added
// 2026-09-19, explicit instruction. Distinct from the existing admin-
// triggered UsersService.deactivate() (a flat status flip with no reason
// capture) — these predefined reasons ("I need a break...") only make sense
// as the account owner's own stated reason for leaving.
export const USER_DEACTIVATION_REASONS = [
  'I need a break from declut',
  'I want a fresh start',
  "I don't like declut",
  'I have sold all my items',
  'others',
] as const;
export type UserDeactivationReasonValue =
  (typeof USER_DEACTIVATION_REASONS)[number];

// Mirrors Suspension/Ban's shape — one object, not a field split across
// deactivatedAt + deactivationReason (reworked 2026-09-19, explicit
// instruction — "do the deactivation like you did the suspension and ban").
// No *By field on deactivation itself (unlike Suspension.suspendedBy/
// Ban.bannedBy) — deactivation is always self-service, there's no separate
// acting party to record for that half; reactivatedBy below is different,
// since restoring the account IS always an admin action.
@Schema({ _id: false })
class Deactivation {
  // Permanent — never touched by reactivateFromDeactivation() (explicit
  // instruction, 2026-09-19: "do not remove the predefined reason for
  // deactivations"). Why the account was deactivated stays on record even
  // after it's restored; the reason it was *restored* lives in its own
  // reactivationReason field below instead. Not `required` (unlike the DTO,
  // which does require it at the actual deactivation boundary) — an account
  // deactivated via the older flat, reason-less UsersService.deactivate()
  // has no `deactivation` object at all, and reactivating it must still
  // work without one to preserve.
  @Prop({ enum: USER_DEACTIVATION_REASONS })
  reason?: UserDeactivationReasonValue;

  @Prop({ trim: true, maxlength: 1000 })
  comment?: string;

  // Nulled (not removed) by reactivateFromDeactivation() — required: true
  // dropped so that write doesn't fail validation. 2026-09-19, explicit
  // instruction ("the atDate ... to null"). Explicit `type: Date` —
  // @nestjs/mongoose can't infer a type from a `Date | null` union via
  // reflection.
  @Prop({ type: Date })
  deactivatedAt?: Date | null;

  // Set only by UsersService.reactivateFromDeactivation() — 2026-09-19,
  // explicit instruction. Always an admin action (self-deactivation is
  // self-service, but restoring access is not — matches this app's existing
  // "reactivate/unsuspend are all admin-only" precedent).
  @Prop()
  reactivatedAt?: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Admin' })
  reactivatedBy?: Types.ObjectId;

  // The acting admin's own stated reason for restoring the account —
  // distinct from `reason` above (why it was deactivated in the first
  // place). Free text, no predefined list. 2026-09-19, explicit instruction.
  @Prop({ trim: true, maxlength: 1000 })
  reactivationReason?: string;
}

// Single user type — can both buy and sell. "buyer"/"seller" elsewhere in
// the codebase just mean which side of a given transaction this user is on.
@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true, trim: true })
  name: string;

  // Alternate login identifier alongside email (email/password signup only).
  @Prop({ unique: true, sparse: true, trim: true })
  phone?: string;

  @Prop({ type: String, enum: AuthProvider, required: true })
  authProvider: AuthProvider;

  @Prop({ unique: true, sparse: true })
  googleId?: string;

  @Prop({ select: false })
  password?: string;

  @Prop({ default: false })
  emailVerified: boolean;

  @Prop({ type: String, enum: KycStatus, default: KycStatus.UNVERIFIED })
  kycStatus: KycStatus;

  @Prop({ type: KycInfo, default: () => ({}) })
  kyc: KycInfo;

  // Only one active push token at a time, by design — logging in on a new
  // device overwrites this rather than accumulating an array. Set from
  // register/login/login-with-biometric's own pushToken body field.
  @Prop()
  deviceToken?: string;

  @Prop({ type: RefreshTokenInfo, select: false })
  refreshToken?: RefreshTokenInfo;

  // Updated on every login/refresh — see the identical field on Admin for
  // why login/refresh rather than every authenticated request. Added
  // 2026-09-18, explicit instruction.
  @Prop()
  lastSeenAt?: Date;

  @Prop({ type: String, enum: AccountStatus, default: AccountStatus.PENDING })
  accountStatus: AccountStatus;

  @Prop({ type: Suspension })
  suspension?: Suspension;

  @Prop({ type: Ban })
  ban?: Ban;

  // Set only by POST /users/me/deactivate (self-service) — see
  // UsersService.deactivateOwnAccount(). Admin-triggered deactivate() (a
  // flat status flip, no reason) leaves this unset.
  @Prop({ type: Deactivation })
  deactivation?: Deactivation;

  // USR-#### — assigned once at creation via CounterService.
  @Prop({ unique: true, sparse: true })
  slug?: string;

  // Added to satisfy the Listing.seller/Review.reviewer populate contracts —
  // no onboarding flow sets these yet (no business-seller signup step, no
  // avatar upload endpoint), so both sit undefined for every user today.
  @Prop({ trim: true })
  company?: string;

  @Prop()
  profileImage?: string;

  // Client-side biometric-login preference — the actual fingerprint/FaceID
  // check happens on-device; this just remembers whether the user opted in.
  @Prop({ default: false })
  loginWithFingerprintOrFaceid: boolean;

  @Prop({ default: 0 })
  avgRating: number;

  @Prop({ default: 0 })
  reviewCount: number;

  // Seller payout bank details live on their own BankAccount document
  // (src/bank-accounts/), not here — this is just the denormalized "do they
  // have one" flag, set true the moment BankAccountsService.create()
  // succeeds. TransactionsService gates checkout/release on this flag, then
  // reads the actual bank details from BankAccount.
  @Prop({ default: false })
  hasPayoutDetails: boolean;

  // Re-added 2026-09-12 (explicit instruction) — was removed 2026-09-10.
  // TrustScoreService.recalculate() writes this on every trigger event; only
  // ever surfaced back to the user themselves, on GET /users/me.
  @Prop({ default: 0 })
  trustScore: number;

  // A simple incrementing count of admin-issued policy strikes — distinct
  // from trustScore (a formula-derived, recalculable number). Only ever
  // incremented by TrustScoreService.applyPolicyStrike(), called from
  // TransactionsService.adminDelistAndRefund() when an admin upholds a
  // buyer's report. Admin-visible only (GET /admin/users list, user detail
  // by id/slug) plus the user's own GET /users/me — never on the public
  // profile or any listing/seller summary. Added 2026-09-17.
  @Prop({ default: 0 })
  policyStrike: number;

  createdAt: Date;
  updatedAt: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
