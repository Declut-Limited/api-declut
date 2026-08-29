import { PaginationDto } from '../../common/dto/pagination.dto';

// Pagination only — no date-range filtering (explicitly excluded for Roles).
export class ListRolesDto extends PaginationDto {}
