import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { ListUserCategoriesDto } from './dto/list-user-categories.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

// Authenticated (JwtAuthGuard), paginated — distinct from PublicCategoriesController's unauthenticated, unpaginated /categories.
@Controller('categories/all')
@UseGuards(JwtAuthGuard)
export class UserCategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  list(@Query() dto: ListUserCategoriesDto) {
    return this.categoriesService.listForUser(dto.page ?? 1, dto.limit ?? 20);
  }
}
