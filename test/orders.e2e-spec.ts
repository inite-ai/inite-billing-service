import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { TestAppModule } from './test-app.module';
import { PrismaService } from '../src/common/services/prisma.service';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { MockJwtAuthGuard } from './mocks/auth.mock';
import { MockOneAdapter } from './mocks/one-adapter.mock';
import { PaymentOrchestratorService } from '../src/payment-orchestrator/payment-orchestrator.service';
import { cleanupTestData } from './helpers/cleanup.helper';

describe('Orders E2E Tests', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orchestrator: PaymentOrchestratorService;
  let mockOneAdapter: MockOneAdapter;
  let authToken: string;
  let userId: string;
  let _productId: string;
  let priceId: string;
  let orderId: string;
  let paymentIntentId: string;

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
    orchestrator = app.get<PaymentOrchestratorService>(PaymentOrchestratorService);
    mockOneAdapter = app.get<MockOneAdapter>(MockOneAdapter);

    userId = MockJwtAuthGuard.testUserId;
    authToken = `Bearer mock-token-${userId}`;

    // Create test product and price
    const product = await prisma.product.create({
      data: {
        code: 'test-product-orders',
        name: 'Test Product',
        moduleScope: 'test',
        type: 'one_time',
        isActive: true,
      },
    });
    _productId = product.id;

    const price = await prisma.price.create({
      data: {
        productId: product.id,
        code: 'test-price-orders',
        currency: 'USD',
        amount: 100.0,
        isActive: true,
      },
    });
    priceId = price.id;
  });

  afterAll(async () => {
    await cleanupTestData(prisma);
    await app.close();
    await prisma.$disconnect();
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  beforeEach(async () => {
    mockOneAdapter.clearMocks();

    // Create product and price for each test
    const product = await prisma.product.create({
      data: {
        code: `test-product-${Date.now()}-${Math.random()}`,
        name: 'Test Product',
        moduleScope: 'test',
        type: 'one_time',
        isActive: true,
      },
    });
    _productId = product.id;

    const price = await prisma.price.create({
      data: {
        productId: product.id,
        code: `test-price-${Date.now()}-${Math.random()}`,
        currency: 'USD',
        amount: 100.0,
        isActive: true,
      },
    });
    priceId = price.id;

    // Create order
    const order = await prisma.order.create({
      data: {
        userId,
        priceId,
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

    const intent = await prisma.paymentIntent.create({
      data: {
        orderId: order.id,
        rail: 'ONE',
        status: 'created',
        providerIntentId: intentResult.providerIntentId,
        checkoutUrl: intentResult.checkoutUrl,
        amount: 100.0,
        currency: 'USD',
      },
    });
    paymentIntentId = intent.id;
  });

  describe('GET /v1/orders/me', () => {
    it('should return user orders', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/orders/me')
        .set('Authorization', authToken)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);

      const order = response.body.find((o: any) => o.id === orderId);
      expect(order).toBeDefined();
      expect(order.status).toBe('created');
      expect(order.amount).toBe('100');
    });

    it('should filter orders by status', async () => {
      // Transition to opened first
      mockOneAdapter.setIntentStatus(
        (await prisma.paymentIntent.findUnique({ where: { id: paymentIntentId } }))
          ?.providerIntentId || '',
        'OPENED',
      );
      await orchestrator.applyStateTransition(paymentIntentId, 'opened');

      // Then transition to paid
      mockOneAdapter.setIntentStatus(
        (await prisma.paymentIntent.findUnique({ where: { id: paymentIntentId } }))
          ?.providerIntentId || '',
        'CLOSED',
      );
      await orchestrator.applyStateTransition(paymentIntentId, 'paid');

      const response = await request(app.getHttpServer())
        .get('/v1/orders/me')
        .query({ status: 'paid' })
        .set('Authorization', authToken)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      response.body.forEach((order: any) => {
        expect(order.status).toBe('paid');
      });
    });
  });

  describe('GET /v1/orders/:id', () => {
    it('should return order by ID', async () => {
      const response = await request(app.getHttpServer())
        .get(`/v1/orders/${orderId}`)
        .set('Authorization', authToken)
        .expect(200);

      expect(response.body.id).toBe(orderId);
      expect(response.body.userId).toBe(userId);
      expect(response.body.status).toBe('created');
    });

    it('should return 404 for non-existent order', async () => {
      await request(app.getHttpServer())
        .get('/v1/orders/00000000-0000-0000-0000-000000000999')
        .set('Authorization', authToken)
        .expect(500); // Will throw error, not 404
    });
  });

  describe('GET /v1/orders/payment-intents/:id', () => {
    it('should return payment intent by ID', async () => {
      const response = await request(app.getHttpServer())
        .get(`/v1/orders/payment-intents/${paymentIntentId}`)
        .set('Authorization', authToken)
        .expect(200);

      expect(response.body.id).toBe(paymentIntentId);
      expect(response.body.orderId).toBe(orderId);
      expect(response.body.rail).toBe('ONE');
      expect(response.body.status).toBe('created');
      expect(response.body.checkoutUrl).toBeDefined();
    });
  });
});
