import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

export enum AuthProvider {
  GOOGLE = 'google',
  EMAIL = 'email',
}

export enum KycStatus {
  UNVERIFIED = 'unverified',
  PENDING = 'pending',
  VERIFIED = 'verified',
  REJECTED = 'rejected',
}

/**
 * @Schema/@Prop are Mongoose decorators (via @nestjs/mongoose) that build a
 * Mongoose schema from a TS class — the Nest-idiomatic alternative to writing
 * a plain `new mongoose.Schema({...})` object, so the shape doubles as your
 * TypeScript type.
 */
@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true, trim: true })
  name: string;

  // Required by RegisterDto for email/password signup (email + password +
  // phone, per CLAUDE.md's Auth Architecture) — not required at the schema
  // level because Google sign-in (POST /auth/google) only ever gives us
  // email/name and was never asked to collect phone too. Sparse unique
  // index mirrors googleId below: many documents with no phone don't
  // collide on "null". Used as the alternate login identifier (email OR
  // phone + password) for email/password accounts.
  @Prop({ unique: true, sparse: true, trim: true })
  phone?: string;

  @Prop({ type: String, enum: AuthProvider, required: true })
  authProvider: AuthProvider;

  // Only set for authProvider = 'google' — Google's `sub` claim. Sparse
  // index: unique among documents that HAVE this field, so many local-auth
  // users with no googleId don't collide on "null".
  @Prop({ unique: true, sparse: true })
  googleId?: string;

  // Only set for authProvider = 'email'. select: false means a normal
  // `User.find()` never returns this field — you have to explicitly ask for
  // it (`.select('+passwordHash')`), so it can't leak into an API response
  // by accident.
  @Prop({ select: false })
  passwordHash?: string;

  // Signup-time OTP email verification (see AuthService.verifyEmail). Google
  // accounts are implicitly trusted (Google already verified the email
  // before issuing the ID token) and are created with this already true —
  // there is no separate "verify your email" step for the Google path.
  @Prop({ default: false })
  emailVerified: boolean;

  // KYC status for this marketplace user. Admin accounts are a wholly
  // separate collection (see src/admin-auth/schemas/admin.schema.ts) and
  // never have a User document at all, so there's no "admin bypasses KYC"
  // special-casing needed here anymore — every User is a real buyer/seller.
  @Prop({ type: String, enum: KycStatus, default: KycStatus.UNVERIFIED })
  kycStatus: KycStatus;

  // Cached, not computed live — see CLAUDE.md's Trust Score spec. Formula
  // gets wired in once the Reviews/Transactions modules exist to feed it;
  // until then every user sits at 0.
  @Prop({ default: 0 })
  trustScore: number;

  // Cached, recalculated by ReviewsService whenever a review targeting this
  // user is created or removed — never computed live on profile reads.
  @Prop({ default: 0 })
  avgRating: number;

  @Prop({ default: 0 })
  reviewCount: number;

  // Seller payout bank details. Raw fields entered by the user for now —
  // the Payments module (Paystack) will validate/resolve these and attach a
  // subaccount code when it's built.
  @Prop()
  bankCode?: string;

  @Prop()
  bankName?: string;

  @Prop()
  accountNumber?: string;

  @Prop()
  accountName?: string;

  // Set by the Payments module the first time this seller's bank details
  // are used in a checkout — cached so subsequent transactions don't create
  // a new Paystack subaccount every time.
  @Prop()
  paystackSubaccountCode?: string;

  // Not @Prop-decorated — `timestamps: true` on @Schema() injects these at
  // runtime. Declaring them here just gives TypeScript visibility into them.
  createdAt: Date;
  updatedAt: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
