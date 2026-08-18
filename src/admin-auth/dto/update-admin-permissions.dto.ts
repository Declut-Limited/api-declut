import { IsObject } from 'class-validator';
import { AdminPermissionModule } from '../interfaces/admin-permissions.interface';

export class UpdateAdminPermissionsDto {
  // Partial patch, not a full replace — a module/action omitted here keeps
  // its current value rather than resetting to false. Loosely validated
  // here; merged against the target admin's existing permissions in
  // AdminAuthService.updatePermissions().
  @IsObject()
  permissions: Partial<
    Record<
      AdminPermissionModule,
      Partial<{ view: boolean; write: boolean; delete: boolean }>
    >
  >;
}
