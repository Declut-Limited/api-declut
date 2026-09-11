import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { App, cert, getApps, initializeApp } from 'firebase-admin/app';

// Shared lazy Firebase Admin app init — extracted so FcmService and
// GoogleOAuthService (Firebase-verified Google sign-in) don't each carry
// their own copy and risk double-initializing the default app.
@Injectable()
export class FirebaseAdminService {
  private app?: App;

  constructor(private readonly config: ConfigService) {}

  getApp(): App | null {
    if (this.app) {
      return this.app;
    }

    const projectId = this.config.get<string>('FIREBASE_PROJECT_ID');
    const clientEmail = this.config.get<string>('FIREBASE_CLIENT_EMAIL');
    const privateKey = this.config.get<string>('FIREBASE_PRIVATE_KEY');

    if (!projectId || !clientEmail || !privateKey) {
      return null;
    }

    const existing = getApps();
    this.app =
      existing.length > 0
        ? existing[0]
        : initializeApp({
            credential: cert({
              projectId,
              clientEmail,
              // env vars store the PEM key with literal \n escape sequences.
              // privateKey: privateKey.replace(/\\n/g,'\n'),
              privateKey: privateKey.replace(/\\\\n/g,'\n'),
            }),
          });
    return this.app;
  }
}
