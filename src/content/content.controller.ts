import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ContentService } from './content.service';
import { CreateContentDto } from './dto/create-content.dto';
import { UpdateContentDto } from './dto/update-content.dto';
import { ListContentDto } from './dto/list-content.dto';
import { AdminJwtAuthGuard } from '../admin-auth/guards/admin-jwt-auth.guard';
import { PermissionsGuard } from '../admin-auth/guards/permissions.guard';
import { RequirePermission } from '../admin-auth/decorators/require-permission.decorator';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import type { AdminAccessTokenPayload } from '../admin-auth/interfaces/admin-jwt-payload.interface';

@Controller('admin/content')
@UseGuards(AdminJwtAuthGuard, PermissionsGuard)
export class ContentController {
  constructor(private readonly contentService: ContentService) {}

  @Post()
  @RequirePermission('content', 'write')
  create(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Body() dto: CreateContentDto,
  ) {
    return this.contentService.create(admin.sub, dto);
  }

  @Get()
  @RequirePermission('content', 'view')
  list(@Query() dto: ListContentDto) {
    return this.contentService.list(dto);
  }

  @Get('slug/:slug')
  @RequirePermission('content', 'view')
  findBySlug(@Param('slug') slug: string) {
    return this.contentService.findBySlug(slug);
  }

  @Get(':id')
  @RequirePermission('content', 'view')
  findById(@Param('id') id: string) {
    return this.contentService.findById(id);
  }

  @Patch(':id')
  @RequirePermission('content', 'write')
  update(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateContentDto,
  ) {
    return this.contentService.update(id, admin.sub, dto);
  }

  @Delete(':id')
  @RequirePermission('content', 'delete')
  async remove(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Param('id') id: string,
  ) {
    await this.contentService.remove(id, admin.sub);
    return { removed: true };
  }
}
