import { IsNotEmpty, IsString } from 'class-validator';

export class DeleteImageDto {
  // Cloudinary's own identifier, not the hosted URL — returned to the client directly in Cloudinary's upload response.
  @IsString()
  @IsNotEmpty()
  publicId: string;
}
