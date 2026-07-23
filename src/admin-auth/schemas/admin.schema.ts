import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type AdminDocument = HydratedDocument<Admin>;

/**
 * A wholly separate collection from User — an admin account is never a
 * User document with a role flag. This is a deliberate reversal of the
 * earlier decision (documented in CLAUDE.md's Auth Architecture section)
 * to keep admins on the same identity model; revisited per explicit
 * instruction. See CLAUDE.md's "Admin Auth Model" section for the
 * reasoning and trade-offs.
 */
@Schema({ timestamps: true })
export class Admin {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true, trim: true })
  name: string;

  // Always set — email/password is the ONLY admin auth path, there is no
  // admin equivalent of Google sign-in.
  @Prop({ required: true, select: false })
  passwordHash: string;

  // Who created this admin — null for the bootstrapped root admin (seeded
  // via scripts/seed-admin.ts, which has no existing admin to attribute
  // creation to). Every admin has equal permissions in v1 (no RBAC tiers,
  // per CLAUDE.md's "not the PRD's full RBAC matrix") — this is purely an
  // audit trail, not a permission hierarchy.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Admin' })
  createdBy?: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export const AdminSchema = SchemaFactory.createForClass(Admin);
