import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { PaymentOrchestratorService } from './payment-orchestrator/payment-orchestrator.service';
import { OneAdapter } from './adapters/one/one.adapter';
import { CryptoAdapter } from './adapters/crypto/crypto.adapter';
import { LavaAdapter } from './adapters/lava/lava.adapter';
import { StripeAdapter } from './adapters/stripe/stripe.adapter';
import { AppleIAPAdapter } from './adapters/apple-iap/apple-iap.adapter';
import { GooglePlayAdapter } from './adapters/google-play/google-play.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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

  // Register adapters with orchestrator
  const orchestrator = app.get(PaymentOrchestratorService);
  const oneAdapter = app.get(OneAdapter);
  const cryptoAdapter = app.get(CryptoAdapter);
  const lavaAdapter = app.get(LavaAdapter);
  const stripeAdapter = app.get(StripeAdapter);
  const appleIAPAdapter = app.get(AppleIAPAdapter);
  const googlePlayAdapter = app.get(GooglePlayAdapter);

  orchestrator.registerAdapter(oneAdapter);
  orchestrator.registerAdapter(cryptoAdapter);
  orchestrator.registerAdapter(lavaAdapter);
  orchestrator.registerAdapter(stripeAdapter);
  orchestrator.registerAdapter(appleIAPAdapter);
  orchestrator.registerAdapter(googlePlayAdapter);

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(`🚀 INITE Billing Service running on http://localhost:${port}`);
  console.log(`📚 Swagger docs available at http://localhost:${port}/api`);
}

bootstrap();
