import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ContactMessageDocument = HydratedDocument<ContactMessage>;

// One row per "Get in touch" submission from the public marketing site — no
// User relationship, this is a fully anonymous, unauthenticated form.
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class ContactMessage {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true, trim: true })
  phone: string;

  @Prop({ required: true, trim: true })
  message: string;

  // Snapshotted from CONTACT_ADMIN_EMAIL at submission time — a later env
  // change must not retroactively rewrite which address an already-saved
  // submission was addressed to.
  @Prop({ required: true })
  adminEmailSentTo: string;

  createdAt: Date;
}

export const ContactMessageSchema =
  SchemaFactory.createForClass(ContactMessage);
