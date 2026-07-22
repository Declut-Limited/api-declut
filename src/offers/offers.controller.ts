import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OffersService } from './offers.service';
import { CreateOfferDto } from './dto/create-offer.dto';
import { CounterOfferDto } from './dto/counter-offer.dto';
import { ListOffersDto } from './dto/list-offers.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../auth/interfaces/jwt-payload.interface';

@Controller('offers')
@UseGuards(JwtAuthGuard)
export class OffersController {
  constructor(private readonly offersService: OffersService) {}

  @Get()
  list(@CurrentUser() user: AccessTokenPayload, @Query() dto: ListOffersDto) {
    return this.offersService.listForUser(user.sub, dto);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.offersService.findById(id, user.sub);
  }

  @Post()
  create(@CurrentUser() user: AccessTokenPayload, @Body() dto: CreateOfferDto) {
    return this.offersService.create(user.sub, dto);
  }

  @Patch(':id/accept')
  accept(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.offersService.accept(id, user.sub);
  }

  @Patch(':id/reject')
  reject(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.offersService.reject(id, user.sub);
  }

  @Post(':id/counter')
  counter(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: CounterOfferDto,
  ) {
    return this.offersService.counter(id, user.sub, dto);
  }

  @Patch(':id/withdraw')
  withdraw(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string) {
    return this.offersService.withdraw(id, user.sub);
  }
}
