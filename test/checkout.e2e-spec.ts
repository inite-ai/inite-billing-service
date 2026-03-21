import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { TestAppModule } from './test-app.module';
import { PrismaService } from '../src/common/services/prisma.service';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { MockJwtAuthGuard } from './mocks/auth.mock';
import { MockOneAdapter } from './mocks/one-adapter.mock';
import { cleanupTestData } from './helpers/cleanup.helper';

describe('Checkout E2E Tests', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mockOneAdapter: MockOneAdapter;
  let authToken: string;
  let userId: string;
  let productId: string;
  let priceId: string;

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
    authToken = `Bearer mock-token-${userId}`;

    // Create test product and price
    const product = await prisma.product.create({
      data: {
        code: 'test-product',
        name: 'Test Product',
        moduleScope: 'test',
        type: 'one_time',
        isActive: true,
      },
    });
    productId = product.id;

    const price = await prisma.price.create({
      data: {
        productId: product.id,
        code: 'test-price',
        currency: 'USD',
        amount: 100.0,
        isActive: true,
      },
    });
    priceId = price.id;
  });

  afterAll(async () => {
    await cleanupTestData(prisma);
    await prisma.$disconnect();
    await app.close();
    // Force exit after cleanup
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  afterEach(async () => {
    mockOneAdapter.clearMocks();
    // Clean up created test data
    await prisma.referral.deleteMany({ where: { referredUserId: userId } });
    await prisma.affiliate.deleteMany({ where: { referralCode: 'TESTREF123' } });
  });

  describe('POST /v1/checkout/session', () => {
    it('should create checkout session for one-time payment', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/checkout/session')
        .set('Authorization', authToken)
        .send({
          priceCode: 'test-price',
          mode: 'PAYMENT',
          rail: 'ONE',
          successUrl: 'https://app.inite.ai/success',
          errorUrl: 'https://app.inite.ai/error',
        })
        .expect(201);

      expect(response.body).toHaveProperty('orderId');
      expect(response.body).toHaveProperty('paymentIntentId');
      expect(response.body).toHaveProperty('checkoutUrl');
      expect(response.body.checkoutUrl).toContain('checkout.one.lat');

      // Verify order created
      const order = await prisma.order.findUnique({
        where: { id: response.body.orderId },
      });
      expect(order).toBeDefined();
      expect(order?.status).toBe('created');
      expect(order?.amount.toString()).toBe('100');

      // Verify payment intent created
      const intent = await prisma.paymentIntent.findUnique({
        where: { id: response.body.paymentIntentId },
      });
      expect(intent).toBeDefined();
      expect(intent?.rail).toBe('ONE');
      expect(intent?.status).toBe('created');
    });

    it('should create checkout session for subscription', async () => {
      // Create subscription product
      const subProduct = await prisma.product.create({
        data: {
          code: 'test-subscription',
          name: 'Test Subscription',
          moduleScope: 'test',
          type: 'subscription',
          isActive: true,
        },
      });

      const subPrice = await prisma.price.create({
        data: {
          productId: subProduct.id,
          code: 'test-sub-price',
          currency: 'USD',
          amount: 29.99,
          interval: 'month',
          isActive: true,
        },
      });

      const response = await request(app.getHttpServer())
        .post('/v1/checkout/session')
        .set('Authorization', authToken)
        .send({
          priceCode: 'test-sub-price',
          mode: 'SUBSCRIPTION',
          rail: 'ONE',
        })
        .expect(201);

      expect(response.body).toHaveProperty('orderId');
      expect(response.body).toHaveProperty('checkoutUrl');
    });

    it('should support referral code in checkout', async () => {
      // Create affiliate
      const affiliate = await prisma.affiliate.create({
        data: {
          userId: '00000000-0000-0000-0000-000000000002', // Different user
          referralCode: 'TESTREF123',
          status: 'active',
          commissionRate: 0.5,
        },
      });

      const response = await request(app.getHttpServer())
        .post('/v1/checkout/session')
        .set('Authorization', authToken)
        .send({
          priceCode: 'test-price',
          mode: 'PAYMENT',
          referralCode: 'TESTREF123',
        })
        .expect(201);

      expect(response.body).toHaveProperty('orderId');

      // Verify referral tracked
      const referral = await prisma.referral.findFirst({
        where: { referredUserId: userId },
      });
      expect(referral).toBeDefined();
      expect(referral?.referralCode).toBe('TESTREF123');
    });

    it('should support idempotency key', async () => {
      const idempotencyKey = 'test-idempotency-key-123';

      const response1 = await request(app.getHttpServer())
        .post('/v1/checkout/session')
        .set('Authorization', authToken)
        .set('idempotency-key', idempotencyKey)
        .send({
          priceCode: 'test-price',
          mode: 'PAYMENT',
        })
        .expect(201);

      const response2 = await request(app.getHttpServer())
        .post('/v1/checkout/session')
        .set('Authorization', authToken)
        .set('idempotency-key', idempotencyKey)
        .send({
          priceCode: 'test-price',
          mode: 'PAYMENT',
        })
        .expect(201);

      // Should return same order
      expect(response1.body.orderId).toBe(response2.body.orderId);
    });

    it('should validate price code exists', async () => {
      await request(app.getHttpServer())
        .post('/v1/checkout/session')
        .set('Authorization', authToken)
        .send({
          priceCode: 'non-existent-price',
          mode: 'PAYMENT',
        })
        .expect(404);
    });

    it('should validate mode matches product type', async () => {
      await request(app.getHttpServer())
        .post('/v1/checkout/session')
        .set('Authorization', authToken)
        .send({
          priceCode: 'test-price', // one_time product
          mode: 'SUBSCRIPTION', // wrong mode
        })
        .expect(400);
    });
  });
});
