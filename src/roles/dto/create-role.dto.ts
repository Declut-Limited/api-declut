import {
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AdminPermissionModule } from '../../admin-auth/interfaces/admin-permissions.interface';

export class CreateRoleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  // Loosely validated here; normalized against the fixed permission-module set in RolesService (buildPermissions) — unknown keys are dropped, missing flags default to false.
  @IsOptional()
  @IsObject()
  permissions?: Partial<
    Record<
      AdminPermissionModule,
      Partial<{ view: boolean; write: boolean; delete: boolean }>
    >
  >;
}
