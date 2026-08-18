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

  // The only two account roles in this system are User and Admin — two
  // separate collections. There is no third role and no field named `role`
  // anywhere: naming this `title` instead of `role` is deliberate, so
  // nothing on an Admin document can be misread as a second role tier.
  // It's a free-text job title (e.g. "Operations Manager") for display
  // only — access control never branches on it. Every admin's actual
  // access is entirely the `permissions` map below — two admins with the
  // same `title` can have completely different permissions, and that's the
  // intended shape (permission-based, not role-based access control).
  @Prop({ trim: true })
  title?: string;

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
