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
// 'active' the moment emailVerified becomes true.
export enum AccountStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  PENDING = 'pending',
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
  @Prop({ required: true })
  reason: string;

  @Prop({ required: true })
  durationDays: number;

  @Prop({ required: true })
  outcome: string;

  @Prop()
  notes?: string;

  @Prop({ required: true })
  suspendedAt: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Admin', required: true })
  suspendedBy: Types.ObjectId;
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

  @Prop({ type: [String], default: [] })
  deviceTokens: string[];

  @Prop({ type: RefreshTokenInfo, select: false })
  refreshToken?: RefreshTokenInfo;

  @Prop({ type: String, enum: AccountStatus, default: AccountStatus.PENDING })
  accountStatus: AccountStatus;

  @Prop({ type: Suspension })
  suspension?: Suspension;

  // USR-#### — assigned once at creation via CounterService.
  @Prop({ unique: true, sparse: true })
  slug?: string;

  // Added to satisfy the Listing.seller/Review.reviewer populate contracts —
  // no onboarding flow sets these yet (no business-seller signup step, no
  // avatar upload endpoint), so both sit undefined for every user today.
  @Prop({ trim: true })
  company?: string;

  @Prop()
  image?: string;

  // Cached, recalculated on trigger events — see Trust Score / Reviews specs.
  @Prop({ default: 0 })
  trustScore: number;

  @Prop({ default: 0 })
  avgRating: number;

  @Prop({ default: 0 })
  reviewCount: number;

  // Seller payout bank details.
  @Prop()
  bankCode?: string;

  @Prop()
  bankName?: string;

  @Prop()
  accountNumber?: string;

  @Prop()
  accountName?: string;

  @Prop()
  paystackSubaccountCode?: string;

  createdAt: Date;
  updatedAt: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
