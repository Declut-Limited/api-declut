import { IsEnum, IsOptional } from 'class-validator';
import { PaginatedDateRangeDto } from '../../common/dto/date-range.dto';
import { EscrowStatus } from '../schemas/escrow.schema';

export class ListEscrowsDto extends PaginatedDateRangeDto {
  @IsOptional()
  @IsEnum(EscrowStatus)
  status?: EscrowStatus;
}
