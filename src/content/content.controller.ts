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
import { CreateArticleDto } from './dto/create-article.dto';
import { UpdateArticleDto } from './dto/update-article.dto';
import { ListArticlesDto } from './dto/list-articles.dto';
import { AdminJwtAuthGuard } from '../admin-auth/guards/admin-jwt-auth.guard';
import { PermissionsGuard } from '../admin-auth/guards/permissions.guard';
import { RequirePermission } from '../admin-auth/decorators/require-permission.decorator';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import type { AdminAccessTokenPayload } from '../admin-auth/interfaces/admin-jwt-payload.interface';

@Controller('admin/content')
@UseGuards(AdminJwtAuthGuard, PermissionsGuard)
export class ContentController {
  constructor(private readonly contentService: ContentService) {}

  @Get()
  @RequirePermission('content', 'view')
  list(@Query() dto: ListArticlesDto) {
    return this.contentService.list(dto);
  }

  @Post()
  @RequirePermission('content', 'write')
  create(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Body() dto: CreateArticleDto,
  ) {
    return this.contentService.create(admin.sub, dto);
  }

  @Get(':slug')
  @RequirePermission('content', 'view')
  findBySlug(@Param('slug') slug: string) {
    return this.contentService.findBySlug(slug);
  }

  @Patch(':id')
  @RequirePermission('content', 'write')
  update(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateArticleDto,
  ) {
    return this.contentService.update(id, admin.sub, dto);
  }

  @Patch(':id/publish')
  @RequirePermission('content', 'write')
  publish(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.contentService.publish(id, admin.sub);
  }

  @Patch(':id/retire')
  @RequirePermission('content', 'write')
  retire(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Param('id') id: string,
  ) {
    return this.contentService.retire(id, admin.sub);
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
