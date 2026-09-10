import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { getAuth } from 'firebase-admin/auth';
import { FirebaseAdminService } from '../firebase-admin/firebase-admin.service';

export interface GoogleIdentity {
  googleId: string;
  email: string;
  name: string;
}

/**
 * Verifies a Firebase ID token via the Firebase Admin SDK — the frontend
 * signs in with Google, exchanges that credential for a Firebase session
 * (auth().signInWithCredential(GoogleAuthProvider.credential(...))), and
 * sends us the resulting Firebase ID token, not a raw Google one.
 * googleId here is Firebase's own uid, not Google's `sub` claim.
 */
@Injectable()
export class GoogleOAuthService {
  constructor(private readonly firebaseAdmin: FirebaseAdminService) {}

  async verifyIdToken(idToken: string): Promise<GoogleIdentity> {
    const app = this.firebaseAdmin.getApp();
    if (!app) {
      throw new InternalServerErrorException(
        'Google sign-in is not configured on this server yet',
      );
    }

    const decoded = await getAuth(app).verifyIdToken(idToken);

    // This endpoint is Google-sign-in specific — reject a Firebase token
    // issued by any other sign-in method (email/password, phone, etc.).
    if (decoded.firebase?.sign_in_provider !== 'google.com') {
      throw new Error('Not a Google sign-in token');
    }
    if (!decoded.email) {
      throw new Error('Google token missing required claims');
    }

    return {
      googleId: decoded.uid,
      email: decoded.email,
      name: decoded.name ?? decoded.email.split('@')[0],
    };
  }
}
