import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type AdminDocument = HydratedDocument<Admin>;

@Schema({ _id: false })
class RefreshTokenInfo {
  @Prop({ required: true })
  hashedToken: string;

  @Prop({ required: true })
  expiresAt: Date;
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
