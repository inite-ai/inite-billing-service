import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { TestAppModule } from './test-app.module';
import { PrismaService } from '../src/common/services/prisma.service';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { MockJwtAuthGuard } from './mocks/auth.mock';
import { MockOneAdapter } from './mocks/one-adapter.mock';
import { cleanupTestData } from './helpers/cleanup.helper';

describe('Webhooks E2E Tests', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mockOneAdapter: MockOneAdapter;
  let userId: string;
  let orderId: string;
  let paymentIntentId: string;
  let providerIntentId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(MockJwtAuthGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
    prisma = app.get<PrismaService>(PrismaService);
    mockOneAdapter = app.get<MockOneAdapter>(MockOneAdapter);

    userId = MockJwtAuthGuard.testUserId;
  });

  afterAll(async () => {
    await cleanupTestData(prisma);
    await app.close();
    await prisma.$disconnect();
    await new Promise(resolve => setTimeout(resolve, 200));
  });

  beforeEach(async () => {
    mockOneAdapter.clearMocks();

    // Create test order and payment intent
    const product = await prisma.product.create({
      data: {
        code: `test-product-webhook-${Date.now()}-${Math.random()}`,
        name: 'Test Product',
        moduleScope: 'test',
        type: 'one_time',
        isActive: true,
      },
    });

    const price = await prisma.price.create({
      data: {
        productId: product.id,
        code: `test-price-webhook-${Date.now()}-${Math.random()}`,
        currency: 'USD',
        amount: 100.0,
        isActive: true,
      },
    });

    const order = await prisma.order.create({
      data: {
        userId,
        priceId: price.id,
        mode: 'PAYMENT',
        status: 'created',
        amount: 100.0,
        currency: 'USD',
        externalId: `order_${Date.now()}`,
      },
    });
    orderId = order.id;

    const intentResult = await mockOneAdapter.createPaymentIntent({
      orderId: order.externalId!,
      amount: 100,
      currency: 'USD',
      mode: 'PAYMENT',
    });
    providerIntentId = intentResult.providerIntentId;

    const intent = await prisma.paymentIntent.create({
      data: {
        orderId: order.id,
        rail: 'ONE',
        status: 'created',
        providerIntentId: intentResult.providerIntentId,
        amount: 100.0,
        currency: 'USD',
      },
    });
    paymentIntentId = intent.id;
  });

  afterEach(async () => {
  });

  describe('POST /webhooks/one', () => {
    it('should store webhook event idempotently', async () => {
      const webhookPayload = {
        id: 'webhook-123',
        event_type: 'payment.order.updated',
        entity_id: providerIntentId,
        status: 'CLOSED',
      };

      // First webhook
      const response1 = await request(app.getHttpServer())
        .post('/webhooks/one')
        .send(webhookPayload)
        .expect(200);

      expect(response1.body.received).toBe(true);

      // Duplicate webhook (same webhook_id)
      const response2 = await request(app.getHttpServer())
        .post('/webhooks/one')
        .send(webhookPayload)
        .expect(200);

      expect(response2.body.received).toBe(true);

      // Verify only one webhook event stored
      const events = await prisma.webhookEvent.findMany({
        where: {
          rail: 'ONE',
          webhookId: 'webhook-123',
        },
      });

      expect(events.length).toBe(1);
    });

    it('should parse webhook and store correctly', async () => {
      const webhookPayload = {
        id: 'webhook-456',
        event_type: 'payment.order.updated',
        entity_id: providerIntentId,
        status: 'OPENED',
      };

      await request(app.getHttpServer())
        .post('/webhooks/one')
        .send(webhookPayload)
        .expect(200);

      const event = await prisma.webhookEvent.findUnique({
        where: {
          rail_webhookId: {
            rail: 'ONE',
            webhookId: 'webhook-456',
          },
        },
      });

      expect(event).toBeDefined();
      expect(event?.eventType).toBe('payment.order.updated');
      expect(event?.entityId).toBe(providerIntentId);
      expect(event?.status).toBe('received');
    });
  });

  describe('POST /webhooks/crypto', () => {
    it('should store crypto webhook', async () => {
      const webhookPayload = {
        id: 'crypto-webhook-123',
        event_type: 'transaction.confirmed',
        tx_hash: '0x1234567890abcdef',
        invoice_id: 'crypto-invoice-123',
        confirmations: 3,
      };

      const response = await request(app.getHttpServer())
        .post('/webhooks/crypto')
        .send(webhookPayload)
        .expect(200);

      expect(response.body.received).toBe(true);

      const event = await prisma.webhookEvent.findUnique({
        where: {
          rail_webhookId: {
            rail: 'CRYPTO',
            webhookId: 'crypto-webhook-123',
          },
        },
      });

      expect(event).toBeDefined();
      expect(event?.eventType).toBe('transaction.confirmed');
    });
  });
});
