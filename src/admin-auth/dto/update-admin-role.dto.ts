import { IsMongoId } from 'class-validator';

// Replaces the old per-admin permissions-edit endpoint — an admin's access
// now comes entirely from its assigned Role, so "editing an admin's
// permissions" is reassigning which Role it points at.
export class UpdateAdminRoleDto {
  @IsMongoId()
  roleId: string;
}
