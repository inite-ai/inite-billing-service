import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { PaymentOrchestratorService } from './payment-orchestrator/payment-orchestrator.service';
import { OneAdapter } from './adapters/one/one.adapter';
import { CryptoAdapter } from './adapters/crypto/crypto.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // CORS
  app.enableCors();

  // Swagger/OpenAPI
  const config = new DocumentBuilder()
    .setTitle('INITE Billing Service')
    .setDescription('Payment-rail agnostic billing and subscriptions API')
    .setVersion('1.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-api-key' }, 'service-key')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  // Register adapters with orchestrator
  const orchestrator = app.get(PaymentOrchestratorService);
  const oneAdapter = app.get(OneAdapter);
  const cryptoAdapter = app.get(CryptoAdapter);

  orchestrator.registerAdapter(oneAdapter);
  orchestrator.registerAdapter(cryptoAdapter);

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(`🚀 INITE Billing Service running on http://localhost:${port}`);
  console.log(`📚 Swagger docs available at http://localhost:${port}/api`);
}

bootstrap();

