import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { WaitlistService } from './waitlist.service';
import { JoinWaitlistDto } from './dto/join-waitlist.dto';

// No guard — this is the marketing landing page signup form, not an
// authenticated in-app action. The one intentionally fully-public write
// endpoint in this codebase.
@Controller('waitlist')
export class WaitlistController {
  constructor(private readonly waitlistService: WaitlistService) {}

  @Post()
  @HttpCode(200)
  async join(@Body() dto: JoinWaitlistDto) {
    await this.waitlistService.join(dto);
    return { message: "You're on the waitlist" };
  }
}
