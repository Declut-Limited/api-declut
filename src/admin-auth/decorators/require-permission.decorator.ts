import { SetMetadata } from '@nestjs/common';
import {
  AdminPermissionAction,
  AdminPermissionModule,
} from '../interfaces/admin-permissions.interface';

export const REQUIRE_PERMISSION_KEY = 'requirePermission';

export interface RequiredPermission {
  module: AdminPermissionModule;
  action: AdminPermissionAction;
}

export const RequirePermission = (
  module: AdminPermissionModule,
  action: AdminPermissionAction,
) => SetMetadata(REQUIRE_PERMISSION_KEY, { module, action });
