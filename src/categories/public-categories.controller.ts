import { Controller, Get } from '@nestjs/common';
import { CategoriesService } from './categories.service';

// No guard — public browse/filter endpoint, not an admin route. Same
// "fully unauthenticated" posture as WaitlistController.
@Controller('categories')
export class PublicCategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  list() {
    return this.categoriesService.listPublic();
  }
}
