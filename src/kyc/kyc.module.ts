import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { KycVerification, KycVerificationSchema } from './schemas/kyc-verification.schema';
import { KycService } from './kyc.service';
import { KycController } from './kyc.controller';
import { KYC_PROVIDER } from './providers/kyc-provider.interface';
import { QoreIdProvider } from './providers/qoreid.provider';
import { UsersModule } from '../users/users.module';
import { TrustScoreModule } from '../trust-score/trust-score.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: KycVerification.name, schema: KycVerificationSchema },
    ]),
    UsersModule,
    TrustScoreModule,
    NotificationsModule,
  ],
  controllers: [KycController],
  providers: [
    KycService,
    // Vendor swap = change this one binding, nothing else in the module.
    { provide: KYC_PROVIDER, useClass: QoreIdProvider },
  ],
})
export class KycModule {}
