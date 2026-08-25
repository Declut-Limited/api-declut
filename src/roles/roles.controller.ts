import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { AdminJwtAuthGuard } from '../admin-auth/guards/admin-jwt-auth.guard';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import type { AdminAccessTokenPayload } from '../admin-auth/interfaces/admin-jwt-payload.interface';
// TEMP: PermissionsGuard disabled (chicken-and-egg — no role has roles:write yet) so any logged-in admin can create/manage roles. Restore before shipping.

@Controller('admin/roles')
@UseGuards(AdminJwtAuthGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Post()
  create(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Body() dto: CreateRoleDto,
  ) {
    return this.rolesService.create(dto, admin.sub);
  }

  @Get()
  findAll() {
    return this.rolesService.findAll();
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.rolesService.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.rolesService.remove(id);
    return { removed: true };
  }
}
