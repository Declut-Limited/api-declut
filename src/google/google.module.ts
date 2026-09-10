import { Module } from '@nestjs/common';
import { GoogleOAuthService } from './google-oauth.service';
import { FirebaseAdminModule } from '../firebase-admin/firebase-admin.module';

@Module({
  imports: [FirebaseAdminModule],
  providers: [GoogleOAuthService],
  exports: [GoogleOAuthService],
})
export class GoogleModule {}
