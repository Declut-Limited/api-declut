import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type AdminRefreshTokenDocument = HydratedDocument<AdminRefreshToken>;

// Mirrors src/auth/schemas/refresh-token.schema.ts exactly, scoped to the
// Admin collection instead of User — kept as its own collection (not a
// shared one with a `subjectType` discriminator) so the two identity
// spaces stay structurally isolated end to end, same reasoning as the
// separate JWT secrets.
@Schema({ timestamps: true })
export class AdminRefreshToken {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Admin',
    required: true,
    index: true,
  })
  admin: Types.ObjectId;

  @Prop({ required: true, unique: true, index: true })
  jti: string;

  @Prop({ required: true })
  tokenHash: string;

  @Prop({ required: true })
  expiresAt: Date;

  @Prop()
  revokedAt?: Date;
}

export const AdminRefreshTokenSchema =
  SchemaFactory.createForClass(AdminRefreshToken);
