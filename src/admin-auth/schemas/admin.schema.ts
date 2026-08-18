import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { ADMIN_PERMISSION_MODULES } from '../interfaces/admin-permissions.interface';
import type { AdminPermissions } from '../interfaces/admin-permissions.interface';

export type AdminDocument = HydratedDocument<Admin>;

@Schema({ _id: false })
class RefreshTokenInfo {
  @Prop({ required: true })
  hashedToken: string;

  @Prop({ required: true })
  expiresAt: Date;
}

function defaultPermissions(): AdminPermissions {
  return Object.fromEntries(
    ADMIN_PERMISSION_MODULES.map((m) => [
      m,
      { view: false, write: false, delete: false },
    ]),
  ) as AdminPermissions;
}

// Separate collection from User — an admin is never a User document.
@Schema({ timestamps: true })
export class Admin {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true, trim: true })
  name: string;

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

  // Free-text title (e.g. "Operations Manager") — not a named role that maps
  // to a fixed permission bundle. Access control is entirely the
  // `permissions` map below.
  @Prop({ trim: true })
  role?: string;

  @Prop({ trim: true })
  company?: string;

  @Prop({ type: Object, default: defaultPermissions })
  permissions: AdminPermissions;

  // Provenance only — permissions (above) are the real access control.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Admin' })
  createdBy?: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export const AdminSchema = SchemaFactory.createForClass(Admin);
