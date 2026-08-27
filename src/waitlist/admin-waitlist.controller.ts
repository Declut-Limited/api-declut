import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { WaitlistService } from './waitlist.service';
import { ListWaitlistDto } from './dto/list-waitlist.dto';
import { InviteWaitlistDto } from './dto/invite-waitlist.dto';
import { BulkInviteWaitlistDto } from './dto/bulk-invite-waitlist.dto';
import { AdminJwtAuthGuard } from '../admin-auth/guards/admin-jwt-auth.guard';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import type { AdminAccessTokenPayload } from '../admin-auth/interfaces/admin-jwt-payload.interface';

@Controller('admin/waitlist')
@UseGuards(AdminJwtAuthGuard)
export class AdminWaitlistController {
  constructor(private readonly waitlistService: WaitlistService) {}

  @Get()
  list(@Query() dto: ListWaitlistDto) {
    return this.waitlistService.list(dto);
  }

  @Get('insights')
  getInsights() {
    return this.waitlistService.getInsights();
  }

  // Backs "select all eligible for bulk invite" — still waiting, never invited.
  @Get('uninvited')
  listUninvited(@Query() dto: ListWaitlistDto) {
    return this.waitlistService.listUninvited(dto);
  }

  @Post('bulk-invite')
  bulkInvite(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Body() dto: BulkInviteWaitlistDto,
  ) {
    return this.waitlistService.bulkInvite(dto, admin.sub);
  }

  @Post(':id/invite')
  async invite(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: InviteWaitlistDto,
  ) {
    await this.waitlistService.inviteSingle(id, dto, admin.sub);
    return { invited: true };
  }

  @Delete(':id')
  async remove(
    @CurrentAdmin() admin: AdminAccessTokenPayload,
    @Param('id') id: string,
  ) {
    await this.waitlistService.remove(id, admin.sub);
    return { removed: true };
  }
}
