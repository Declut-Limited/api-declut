import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { envValidationSchema } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AuthGuardsModule } from './auth/guards/guards.module';
import { ListingsModule } from './listings/listings.module';
import { MediaModule } from './media/media.module';
import { FavoritesModule } from './favorites/favorites.module';
import { KycModule } from './kyc/kyc.module';
import { PaymentsModule } from './payments/payments.module';
import { BankAccountsModule } from './bank-accounts/bank-accounts.module';
import { TransactionsModule } from './transactions/transactions.module';
import { EscrowModule } from './escrow/escrow.module';
import { ReviewsModule } from './reviews/reviews.module';
import { TrustScoreModule } from './trust-score/trust-score.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AdminModule } from './admin/admin.module';
import { SettingsModule } from './settings/settings.module';
import { CategoriesModule } from './categories/categories.module';
import { ReportsModule } from './reports/reports.module';
import { ContentModule } from './content/content.module';
import { RolesModule } from './roles/roles.module';
import { WaitlistModule } from './waitlist/waitlist.module';
import { AuditContextMiddleware } from './common/middleware/audit-context.middleware';

@Module({
  imports: [
    // isGlobal: true makes ConfigService injectable anywhere without every feature module re-importing ConfigModule. validationSchema runs once at boot — if a required env var is missing, the app refuses to start instead of throwing later when some service first tries to use it.
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),
    // forRootAsync + a factory (rather than forRoot with a hardcoded URI) is the pattern for "this module needs a value that only ConfigService knows" — Nest resolves ConfigModule first, injects ConfigService into the factory, and only then connects to Mongo.
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI'),
      }),
    }),
    // Global baseline rate limit as a safety net; stricter per-route limits (auth, payment-initiating endpoints) get their own @Throttle() overrides when those modules are built.
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 100,
      },
    ]),
    ScheduleModule.forRoot(),
    // Backs the notification-broadcast queue. REDIS_URL is required (Joi-validated at boot, no fallback). lazyConnect + maxRetriesPerRequest: null (BullMQ's own requirement) so an unreachable Redis doesn't block app boot — jobs just won't process until it's reachable.
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.getOrThrow<string>('REDIS_URL');
        const url = new URL(redisUrl);
        // Manually decomposing the URL (rather than handing the raw string to ioredis) means TLS never gets applied on its own — has to be set explicitly. Can't trust the `rediss:` scheme alone either: Upstash's own copy-pasted connection string uses a plain `redis://` scheme while still requiring TLS on the actual endpoint (confirmed live — a plaintext connection to it connects then immediately resets). Defaulting TLS on for any non-loopback host covers every managed provider correctly; only a local/self-hosted Redis on the same machine skips it.
        const isLoopback = ['127.0.0.1', 'localhost', '::1'].includes(
          url.hostname,
        );
        const useTls = url.protocol === 'rediss:' || !isLoopback;
        return {
          connection: {
            host: url.hostname,
            port: Number(url.port) || 6379,
            username: url.username || undefined,
            password: url.password || undefined,
            ...(useTls ? { tls: {} } : {}),
            lazyConnect: true,
            maxRetriesPerRequest: null,
            // Capped backoff, not the default rapid-retry — an unreachable Redis in this environment shouldn't flood the logs reconnecting every few ms.
            retryStrategy: (times: number) => Math.min(times * 1000, 30000),
          },
        };
      },
    }),
    AuthGuardsModule,
    HealthModule,
    UsersModule,
    AuthModule,
    ListingsModule,
    MediaModule,
    FavoritesModule,
    KycModule,
    PaymentsModule,
    BankAccountsModule,
    TransactionsModule,
    EscrowModule,
    ReviewsModule,
    TrustScoreModule,
    NotificationsModule,
    AdminModule,
    SettingsModule,
    CategoriesModule,
    ReportsModule,
    ContentModule,
    RolesModule,
    WaitlistModule,
  ],
  providers: [
    // APP_GUARD/APP_FILTER/APP_INTERCEPTOR are Nest's tokens for registering a provider as a *global* guard/filter/interceptor via DI, instead of NestFactory.create's app.useGlobal*() calls in main.ts. Doing it here means they participate in Nest's dependency injection (useful later — e.g. a guard that injects a service), unlike the main.ts equivalents.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuditContextMiddleware).forRoutes('*');
  }
}
