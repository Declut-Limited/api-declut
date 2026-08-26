import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { AdminJwtAuthGuard } from '../admin-auth/guards/admin-jwt-auth.guard';
import { PermissionsGuard } from '../admin-auth/guards/permissions.guard';
import { RequirePermission } from '../admin-auth/decorators/require-permission.decorator';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import type { AdminAccessTokenPayload } from '../admin-auth/interfaces/admin-jwt-payload.interface';

@Controller('admin/categories')
@UseGuards(AdminJwtAuthGuard, PermissionsGuard)
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @RequirePermission('categories', 'view')
  list() {
    return this.categoriesService.list();
  }

  @Get('export')
  @RequirePermission('categories', 'view')
  async export(@Res() res: Response) {
    const csv = await this.categoriesService.exportCsv();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="categories.csv"',
    );
    res.send(csv);
  }

  @Post()
  @RequirePermission('categories', 'write')
  create(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Body() dto: CreateCategoryDto,
  ) {
    return this.categoriesService.create(admin.sub, dto);
  }

  @Patch(':id/toggle')
  @RequirePermission('categories', 'write')
  toggle(@Param('id') id: string) {
    return this.categoriesService.toggleStatus(id);
  }

  @Patch(':id')
  @RequirePermission('categories', 'write')
  update(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.categoriesService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('categories', 'delete')
  async remove(@Param('id') id: string) {
    await this.categoriesService.remove(id);
    return { removed: true };
  }
}
