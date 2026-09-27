import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  KycVerification,
  KycVerificationSchema,
} from './schemas/kyc-verification.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { KycService } from './kyc.service';
import { KycController } from './kyc.controller';
import { AdminKycController } from './admin-kyc.controller';
import { KYC_PROVIDER } from './providers/kyc-provider.interface';
import { AutoApproveKycProvider } from './providers/auto-approve.provider';
import { UsersModule } from '../users/users.module';
import { TrustScoreModule } from '../trust-score/trust-score.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: KycVerification.name, schema: KycVerificationSchema },
      // Registered directly (not routed through UsersModule) — read-only
      // admin-listing need, same avoid-a-cycle pattern TrustScoreModule/
      // CategoriesService already use for this exact kind of cross-module
      // read elsewhere in this app.
      { name: User.name, schema: UserSchema },
    ]),
    UsersModule,
    TrustScoreModule,
    NotificationsModule,
    AdminAuthModule,
    AuditLogModule,
  ],
  controllers: [KycController, AdminKycController],
  providers: [
    KycService,
    // Temporarily bound to an auto-approve stand-in — QoreID's own vendor
    // setup isn't complete yet (explicit instruction, 2026-09-27). Swap back
    // to `{ provide: KYC_PROVIDER, useClass: QoreIdProvider }` (import from
    // './providers/qoreid.provider') once QoreID is actually configured —
    // nothing else in this module or KycService needs to change.
    { provide: KYC_PROVIDER, useClass: AutoApproveKycProvider },
  ],
  exports: [KycService],
})
export class KycModule {}
