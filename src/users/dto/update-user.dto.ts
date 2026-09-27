import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  // Cloudinary URL — client uploads directly via GET /media/upload-signature, same as Listing images.
  @IsOptional()
  @IsString()
  profileImage?: string;
}
