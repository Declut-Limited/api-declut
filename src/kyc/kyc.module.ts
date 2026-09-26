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
import { QoreIdProvider } from './providers/qoreid.provider';
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
    // Vendor swap = change this one binding, nothing else in the module.
    { provide: KYC_PROVIDER, useClass: QoreIdProvider },
  ],
  exports: [KycService],
})
export class KycModule {}
