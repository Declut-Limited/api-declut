import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';

export interface UploadSignature {
  signature: string;
  timestamp: number;
  apiKey: string;
  cloudName: string;
  folder: string;
}

/**
 * We never touch raw image bytes — the mobile app uploads straight to
 * Cloudinary using a short-lived signed payload from here, per CLAUDE.md's
 * "signed uploads" requirement. Same lazy-config pattern as GoogleOAuthService:
 * throws a clear 500 if hit before real Cloudinary credentials are set,
 * rather than failing at app boot.
 */
@Injectable()
export class CloudinaryService {
  constructor(private readonly config: ConfigService) {}

  generateUploadSignature(folder = 'listings'): UploadSignature {
    const cloudName = this.config.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiKey = this.config.get<string>('CLOUDINARY_API_KEY');
    const apiSecret = this.config.get<string>('CLOUDINARY_API_SECRET');

    if (!cloudName || !apiKey || !apiSecret) {
      throw new InternalServerErrorException(
        'Image upload is not configured on this server yet',
      );
    }

    const timestamp = Math.round(Date.now() / 1000);
    const signature = cloudinary.utils.api_sign_request(
      { timestamp, folder },
      apiSecret,
    );

    return { signature, timestamp, apiKey, cloudName, folder };
  }
}
