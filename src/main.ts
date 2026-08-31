import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  const config = app.get(ConfigService);

  // Backs NotificationsGateway (the admin notification bell) — the only WebSocket usage in this app.
  app.useWebSocketAdapter(new IoAdapter(app));

  // Every HTTP route lives under /api (e.g. /api/auth/login).
  app.setGlobalPrefix('api');

  // Express 5 defaults to the 'simple' query parser (no bracket-notation nesting) — 'extended' restores it, needed for ListingFilterDto's itemCondition[new]/priceRange[min] style query params.
  app.set('query parser', 'extended');

  app.use(helmet());

  app.useBodyParser('json', { limit: '20mb' });

  app.enableCors({
    origin: true,
    credentials: true,
  });

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
