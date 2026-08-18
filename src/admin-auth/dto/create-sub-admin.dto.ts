import {
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AdminPermissionModule } from '../interfaces/admin-permissions.interface';

export class CreateSubAdminDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @IsString()
  @MinLength(8)
  @MaxLength(64)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'password must contain at least one letter and one number',
  })
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  role?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  company?: string;

  // Loosely validated here; normalized against the fixed 9-module set in
  // AdminAuthService (buildPermissions) — unknown keys are dropped, missing
  // flags default to false.
  @IsOptional()
  @IsObject()
  permissions?: Partial<
    Record<
      AdminPermissionModule,
      Partial<{ view: boolean; write: boolean; delete: boolean }>
    >
  >;
}
