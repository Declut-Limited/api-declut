import * as Joi from 'joi';

/**
 * Vars marked optional() here belong to modules we haven't built yet
 * (KYC, Payments, Cloudinary, Notifications). Tighten each to required()
 * when its module is wired up, per CLAUDE.md's "fail fast" convention.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().default(3000),

  MONGODB_URI: Joi.string().required(),

  ALLOWED_ORIGINS: Joi.string().required(),

  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRY: Joi.string()
    .pattern(/^[0-9]+(ms|s|m|h|d|w|y)$/)
    .default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_EXPIRY: Joi.string()
    .pattern(/^[0-9]+(ms|s|m|h|d|w|y)$/)
    .default('30d'),
  BCRYPT_SALT_ROUNDS: Joi.number().default(12),

  // Signs the stateless forgot-password OTP-session token AND the
  // post-verification reset token for regular Users — distinct claims
  // (`purpose`) differentiate the two within this one secret. Deliberately
  // separate from JWT_ACCESS_SECRET/JWT_REFRESH_SECRET so a leak of one
  // doesn't cross-contaminate the other, and separate from the admin
  // equivalent below for the same reason.
  JWT_PASSWORD_RESET_SECRET: Joi.string().min(32).required(),
  OTP_EXPIRY_MINUTES: Joi.number().default(10),
  PASSWORD_RESET_TOKEN_EXPIRY_MINUTES: Joi.number().default(15),

  // Admin accounts are now a wholly separate Mongoose collection with their
  // own JWT secrets — structurally impossible to forge an admin token from
  // a compromised regular-user secret, or vice versa.
  JWT_ADMIN_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ADMIN_ACCESS_EXPIRY: Joi.string()
    .pattern(/^[0-9]+(ms|s|m|h|d|w|y)$/)
    .default('15m'),
  JWT_ADMIN_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_ADMIN_REFRESH_EXPIRY: Joi.string()
    .pattern(/^[0-9]+(ms|s|m|h|d|w|y)$/)
    .default('30d'),
  JWT_ADMIN_PASSWORD_RESET_SECRET: Joi.string().min(32).required(),

  EMAIL_FROM: Joi.string().allow('').optional(),
  EMAIL_FROM_NAME: Joi.string().default('Declut'),

  // Comma-separated OAuth client id(s) accepted as a valid audience when
  // verifying a Google ID token (e.g. iOS + Android + Web client ids).
  // Optional for now since we don't have real values yet — GoogleOAuthService
  // throws a clear 500 if POST /auth/google is hit before this is set.
  GOOGLE_CLIENT_ID: Joi.string().allow('').optional(),

  ESCROW_STALLED_THRESHOLD_DAYS: Joi.number().default(5),
  COMMISSION_PERCENTAGE: Joi.number().default(10),
  OFFER_EXPIRY_DAYS: Joi.number().default(3),
  DEFAULT_SEARCH_RADIUS_KM: Joi.number().default(15),
  // Not named in CLAUDE.md (just "a small number of failed attempts") —
  // picked a default when building the Payments module.
  MAX_CODE_ATTEMPTS: Joi.number().default(3),

  FIREBASE_PROJECT_ID: Joi.string().allow('').optional(),
  FIREBASE_CLIENT_EMAIL: Joi.string().allow('').optional(),
  FIREBASE_PRIVATE_KEY: Joi.string().allow('').optional(),

  PAYSTACK_PUBLIC_KEY: Joi.string().allow('').optional(),
  PAYSTACK_SECRET_KEY: Joi.string().allow('').optional(),

  QOREID_CLIENT_ID: Joi.string().allow('').optional(),
  QOREID_CLIENT_SECRET: Joi.string().allow('').optional(),
  QOREID_BASE_URL: Joi.string().allow('').optional(),

  CLOUDINARY_CLOUD_NAME: Joi.string().allow('').optional(),
  CLOUDINARY_API_KEY: Joi.string().allow('').optional(),
  CLOUDINARY_API_SECRET: Joi.string().allow('').optional(),

  BREVO_API_KEY: Joi.string().allow('').optional(),
});
