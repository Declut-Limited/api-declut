import {
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AdminPermissionModule } from '../../admin-auth/interfaces/admin-permissions.interface';

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  // Partial patch, not a full replace — a module/action omitted here keeps its current value rather than resetting to false. Same merge convention as the old per-admin permissions-edit endpoint it replaces.
  @IsOptional()
  @IsObject()
  permissions?: Partial<
    Record<
      AdminPermissionModule,
      Partial<{ view: boolean; write: boolean; delete: boolean }>
    >
  >;
}
