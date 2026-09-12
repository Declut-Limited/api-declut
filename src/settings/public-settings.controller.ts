import { Controller, Get } from '@nestjs/common';
import { SettingsService } from './settings.service';

// No guard — public read of platform settings, same "fully unauthenticated"
// posture as PublicCategoriesController/WaitlistController. Returns a
// curated subset (see SettingsService.getPublic()), not the raw admin
// document.
@Controller('settings')
export class PublicSettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  get() {
    return this.settingsService.getPublic();
  }
}
