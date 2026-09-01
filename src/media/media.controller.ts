import { Controller, Delete, Get, Query, UseGuards } from '@nestjs/common';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { BulkUploadSignatureDto } from './dto/bulk-upload-signature.dto';
import { DeleteImageDto } from './dto/delete-image.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

// We never touch raw image/video bytes — these hand out short-lived signed
// Cloudinary payloads for the client to upload directly with, per
// CLAUDE.md's Security Requirements. Delete is the one exception that must
// happen server-side, since only we hold CLOUDINARY_API_SECRET.
@Controller('media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  constructor(private readonly cloudinaryService: CloudinaryService) {}

  @Get('upload-signature')
  getUploadSignature() {
    return this.cloudinaryService.generateUploadSignature();
  }

  @Get('upload-signature/bulk')
  getBulkUploadSignatures(@Query() dto: BulkUploadSignatureDto) {
    return this.cloudinaryService.generateBulkUploadSignatures(dto.count ?? 3);
  }

  @Delete('image')
  deleteImage(@Query() dto: DeleteImageDto) {
    return this.cloudinaryService.deleteImage(dto.publicId);
  }
}
