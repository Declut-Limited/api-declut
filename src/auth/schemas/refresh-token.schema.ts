import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type RefreshTokenDocument = HydratedDocument<RefreshToken>;

@Schema({ timestamps: true })
export class RefreshToken {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  user: Types.ObjectId;

  // Unique id embedded in the JWT's `jti` claim — lets us look this document
  // up in O(1) without ever storing or querying by the raw token itself.
  @Prop({ required: true, unique: true, index: true })
  jti: string;

  // bcrypt hash of the full issued refresh JWT. Belt-and-braces on top of the
  // jti lookup: even if the jti index were somehow guessable, the presented
  // token still has to match this hash before it's accepted.
  @Prop({ required: true })
  tokenHash: string;

  @Prop({ required: true })
  expiresAt: Date;

  @Prop()
  revokedAt?: Date;
}

export const RefreshTokenSchema = SchemaFactory.createForClass(RefreshToken);
