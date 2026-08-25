import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { ADMIN_PERMISSION_MODULES } from '../../admin-auth/interfaces/admin-permissions.interface';
import type { AdminPermissions } from '../../admin-auth/interfaces/admin-permissions.interface';

export type RoleDocument = HydratedDocument<Role>;

function defaultPermissions(): AdminPermissions {
  return Object.fromEntries(
    ADMIN_PERMISSION_MODULES.map((m) => [
      m,
      { view: false, write: false, delete: false },
    ]),
  ) as AdminPermissions;
}

// A named, reusable bundle of privileges — an Admin's actual access comes
// entirely from the Role it's assigned to (Admin.role), not from anything
// stored on the Admin document itself. userCount is NOT a field here —
// it's computed live (AdminAuthService.countByRole()) wherever a Role is
// read, same "don't cache what a query can answer" reasoning already used
// for listingsCount elsewhere in this app.
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class Role {
  @Prop({ required: true, unique: true, trim: true })
  name: string;

  @Prop({ type: Object, default: defaultPermissions })
  permissions: AdminPermissions;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Admin', required: true })
  createdBy: Types.ObjectId;

  createdAt: Date;
}

export const RoleSchema = SchemaFactory.createForClass(Role);
