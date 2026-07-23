import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { envValidationSchema } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AuthGuardsModule } from './auth/guards/guards.module';
import { ListingsModule } from './listings/listings.module';
import { FavoritesModule } from './favorites/favorites.module';
import { KycModule } from './kyc/kyc.module';
import { OffersModule } from './offers/offers.module';
import { PaymentsModule } from './payments/payments.module';
import { TransactionsModule } from './transactions/transactions.module';
import { ReviewsModule } from './reviews/reviews.module';
import { TrustScoreModule } from './trust-score/trust-score.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AdminModule } from './admin/admin.module';
import { SettingsModule } from './settings/settings.module';

@Module({
  imports: [
    // isGlobal: true makes ConfigService injectable anywhere without every
    // feature module re-importing ConfigModule. validationSchema runs once
    // at boot — if a required env var is missing, the app refuses to start
    // instead of throwing later when some service first tries to use it.
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),
    // forRootAsync + a factory (rather than forRoot with a hardcoded URI) is
    // the pattern for "this module needs a value that only ConfigService
    // knows" — Nest resolves ConfigModule first, injects ConfigService into
    // the factory, and only then connects to Mongo.
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI'),
      }),
    }),
    // Global baseline rate limit as a safety net; stricter per-route limits
    // (auth, payment-initiating endpoints) get their own @Throttle() overrides
    // when those modules are built.
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 100,
      },
    ]),
    ScheduleModule.forRoot(),
    AuthGuardsModule,
    HealthModule,
    UsersModule,
    AuthModule,
    ListingsModule,
    FavoritesModule,
    KycModule,
    OffersModule,
    PaymentsModule,
    TransactionsModule,
    ReviewsModule,
    TrustScoreModule,
    NotificationsModule,
    AdminModule,
    SettingsModule,
  ],
  providers: [
    // APP_GUARD/APP_FILTER/APP_INTERCEPTOR are Nest's tokens for registering
    // a provider as a *global* guard/filter/interceptor via DI, instead of
    // NestFactory.create's app.useGlobal*() calls in main.ts. Doing it here
    // means they participate in Nest's dependency injection (useful later —
    // e.g. a guard that injects a service), unlike the main.ts equivalents.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule {}
