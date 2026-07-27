import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: capture the exact request bytes on `req.rawBody`. Provider webhook
  // signatures (Stripe, ONE, Resend/svix) are computed over the raw body — a
  // re-serialized `JSON.stringify(req.body)` does not match, so without this the
  // signatures fail (Stripe webhooks 403). Body is still parsed as usual.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Security headers & cookie parsing
  app.use(helmet());
  app.use(cookieParser());
  // Real client IPs behind a reverse proxy (risk velocity checks rely on req.ip)
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // CORS
  app.enableCors({
    origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3001'],
    credentials: true,
  });

  // Swagger/OpenAPI (disabled in production)
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('INITE Billing Service')
      .setDescription('Payment-rail agnostic billing and subscriptions API')
      .setVersion('1.0')
      .addBearerAuth()
      .addApiKey({ type: 'apiKey', in: 'header', name: 'x-api-key' }, 'service-key')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api', app, document);
  }

  // Payment adapters self-register via the ConnectorRegistry (auto-discovered
  // by @RegisterConnector) — the orchestrator pulls them in on module init, so
  // there is no hand-maintained registration list here anymore.

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(`🚀 INITE Billing Service running on http://localhost:${port}`);
  console.log(`📚 Swagger docs available at http://localhost:${port}/api`);
}

bootstrap();
