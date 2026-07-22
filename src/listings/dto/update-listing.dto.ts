import { PartialType } from '@nestjs/mapped-types';
import { CreateListingDto } from './create-listing.dto';

// PartialType makes every field from CreateListingDto optional while
// keeping its validators — the Nest-idiomatic way to derive an "edit" DTO
// from a "create" DTO without repeating every decorator.
export class UpdateListingDto extends PartialType(CreateListingDto) {}
