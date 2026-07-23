import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: true keeps the original request bytes available via
  // req.rawBody alongside the normal parsed req.body — needed to verify the
  // Paystack webhook's HMAC signature, which is computed over Paystack's
  // exact original bytes, not a re-serialization of our parsed JSON.
  // Typed as NestExpressApplication so useBodyParser() below is available —
  // it's an Express-adapter-specific method, not on the generic interface.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  const config = app.get(ConfigService);

  // Every HTTP route now lives under /api (e.g. /api/auth/login). This is
  // Nest's HTTP router prefix only — it doesn't touch the WebSocket
  // gateway, so AdminNotificationsGateway's /admin-notifications namespace
  // is unaffected and stays exactly as documented.
  app.setGlobalPrefix('api');

  // Explicit rather than relying on Nest's default — makes the WS
  // transport for AdminNotificationsGateway unambiguous.
  app.useWebSocketAdapter(new IoAdapter(app));

  app.use(helmet());

  // Express's default JSON body limit (100kb) is too small for the KYC
  // selfie upload (base64, never persisted — just proxied to the KYC
  // provider). useBodyParser (not a manual express.json() call) keeps
  // Nest's rawBody capture intact while raising the limit.
  app.useBodyParser('json', { limit: '20mb' });

  app.enableCors({
    origin: true,
    credentials: true,
  });

  // A global pipe runs before every route handler. whitelist strips any
  // request-body property not declared on the DTO; forbidNonWhitelisted
  // rejects the request outright instead of silently dropping the extra
  // field — this is what stops an unvalidated body from ever reaching a
  // service, per CLAUDE.md's DTO-everywhere rule.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = config.get<number>('PORT', 3000);
  await app.listen(port);
}
void bootstrap();
