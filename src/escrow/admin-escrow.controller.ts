import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { EscrowService } from './escrow.service';
import { ListEscrowsDto } from './dto/list-escrows.dto';
import { AdminJwtAuthGuard } from '../admin-auth/guards/admin-jwt-auth.guard';
import { PermissionsGuard } from '../admin-auth/guards/permissions.guard';
import { RequirePermission } from '../admin-auth/decorators/require-permission.decorator';

// Gated under the existing transactions permission bucket — no dedicated
// Escrow RBAC bucket, same "no home of its own, grouped under the closest
// domain" precedent offers used.
@Controller('admin/escrows')
@UseGuards(AdminJwtAuthGuard, PermissionsGuard)
export class AdminEscrowController {
  constructor(private readonly escrowService: EscrowService) {}

  @Get()
  @RequirePermission('transactions', 'view')
  list(@Query() dto: ListEscrowsDto) {
    return this.escrowService.adminList(dto.page ?? 1, dto.limit ?? 20);
  }
}
