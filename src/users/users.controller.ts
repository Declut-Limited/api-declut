import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { DeactivateAccountDto } from './dto/deactivate-account.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/jwt-payload.interface';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getMe(@CurrentUser() user: AccessTokenPayload) {
    return this.usersService.getPrivateProfile(user.sub);
  }

  @Patch('me')
  updateMe(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.updateProfile(user.sub, dto);
  }

  // Self-service — the caller deactivates their own account and is logged
  // out immediately (refresh token cleared server-side). We never delete
  // the account, only deactivate it.
  @HttpCode(HttpStatus.OK)
  @Post('me/deactivate')
  async deactivateMe(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: DeactivateAccountDto,
  ) {
    await this.usersService.deactivateOwnAccount(user.sub, dto);
    return { deactivated: true };
  }

  // Public profile of any user (e.g. a seller viewed from a listing) — no
  // ownership check needed, it intentionally returns the same
  // already-public-safe subset for anyone who's logged in.
  @Get(':id')
  getById(@Param('id') id: string) {
    return this.usersService.getPublicProfile(id);
  }
}
