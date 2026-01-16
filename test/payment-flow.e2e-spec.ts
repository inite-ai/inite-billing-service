import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { TestAppModule } from '../src/test-app.module';
import { PrismaService } from '../src/common/services/prisma.service';
import { PaymentOrchestratorService } from '../src/payment-orchestrator/payment-orchestrator.service';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { MockJwtAuthGuard } from './mocks/auth.mock';
import { MockOneAdapter } from './mocks/one-adapter.mock';
import { cleanupTestData } from './helpers/cleanup.helper';

describe('Payment Flow E2E Tests', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orchestrator: PaymentOrchestratorService;
  let mockOneAdapter: MockOneAdapter;
  let authToken: string;
  let userId: string;
  let productId: string;
  let priceId: string;
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
    orchestrator = app.get<PaymentOrchestratorService>(PaymentOrchestratorService);
    mockOneAdapter = app.get<MockOneAdapter>(MockOneAdapter);

    userId = MockJwtAuthGuard.testUserId;
    authToken = `Bearer mock-token-${userId}`;

    // Create test product and price
    const product = await prisma.product.create({
      data: {
        code: 'test-product-payment',
        name: 'Test Product',
        moduleScope: 'test',
        type: 'one_time',
        isActive: true,
        metadata: {
          entitlements: ['test.entitlement'],
        },
      },
    });
    productId = product.id;

    const price = await prisma.price.create({
      data: {
        productId: product.id,
        code: 'test-price-payment',
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
    await new Promise(resolve => setTimeout(resolve, 200));
  });

  beforeEach(async () => {
    mockOneAdapter.clearMocks();

    // Create order and payment intent for each test
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
    providerIntentId = intentResult.providerIntentId;

    const intent = await prisma.paymentIntent.create({
      data: {
        orderId: order.id,
        rail: 'ONE',
        status: 'created',
        providerIntentId: intentResult.providerIntentId,
        providerCheckoutId: intentResult.providerCheckoutId,
        checkoutUrl: intentResult.checkoutUrl,
        amount: 100.0,
        currency: 'USD',
        expiresAt: intentResult.expiresAt,
      },
    });
    paymentIntentId = intent.id;
    providerIntentId = intent.providerIntentId!; // Store for use in tests
  });

  afterEach(async () => {
    // Clean up test-specific data
    if (paymentIntentId) {
      await prisma.entitlement.deleteMany({ where: { userId } });
      await prisma.invoice.deleteMany({ where: { orderId } });
      await prisma.paymentIntent.deleteMany({ where: { id: paymentIntentId } });
      await prisma.order.deleteMany({ where: { id: orderId } });
    }
  });

  describe('Payment State Transitions', () => {
    it('should transition from created to opened', async () => {
      // Update mock to return OPENED status
      mockOneAdapter.setIntentStatus(providerIntentId, 'OPENED');

      // Simulate webhook or status check
      await orchestrator.applyStateTransition(paymentIntentId, 'opened');

      const intent = await prisma.paymentIntent.findUnique({
        where: { id: paymentIntentId },
      });
      expect(intent?.status).toBe('opened');

      const order = await prisma.order.findUnique({
        where: { id: orderId },
      });
      expect(order?.status).toBe('open');
    });

    it('should transition from opened to paid and grant entitlements', async () => {
      // First transition to opened
      await orchestrator.applyStateTransition(paymentIntentId, 'opened');

      // Then transition to paid
      mockOneAdapter.setIntentStatus(providerIntentId, 'CLOSED');
      await orchestrator.applyStateTransition(paymentIntentId, 'paid');

      // Verify payment intent
      const intent = await prisma.paymentIntent.findUnique({
        where: { id: paymentIntentId },
      });
      expect(intent?.status).toBe('paid');

      // Verify order
      const order = await prisma.order.findUnique({
        where: { id: orderId },
      });
      expect(order?.status).toBe('paid');

      // Verify invoice created
      const invoice = await prisma.invoice.findFirst({
        where: { orderId },
      });
      expect(invoice).toBeDefined();
      expect(invoice?.status).toBe('paid');

      // Verify entitlements granted
      const entitlement = await prisma.entitlement.findFirst({
        where: {
          userId,
          key: 'test.entitlement',
          status: 'active',
        },
      });
      expect(entitlement).toBeDefined();
      expect(entitlement?.source).toBe('order');
    });

    it('should be idempotent - skip if already in target state', async () => {
      // Set to opened first  
      mockOneAdapter.setIntentStatus(providerIntentId, 'OPENED');
      await orchestrator.applyStateTransition(paymentIntentId, 'opened');

      // Try to transition to opened again - should be idempotent
      await orchestrator.applyStateTransition(paymentIntentId, 'opened');

      const intent = await prisma.paymentIntent.findUnique({
        where: { id: paymentIntentId },
      });
      expect(intent?.status).toBe('opened');
    });

    it('should handle refund and revoke entitlements', async () => {
      // First complete payment
      await orchestrator.applyStateTransition(paymentIntentId, 'opened');
      mockOneAdapter.setIntentStatus(providerIntentId, 'CLOSED');
      await orchestrator.applyStateTransition(paymentIntentId, 'paid');

      // Verify entitlement exists
      let entitlement = await prisma.entitlement.findFirst({
        where: { userId, key: 'test.entitlement', status: 'active' },
      });
      expect(entitlement).toBeDefined();

      // Refund
      mockOneAdapter.setIntentStatus(providerIntentId, 'REFUNDED');
      await orchestrator.applyStateTransition(paymentIntentId, 'refunded');

      // Verify intent
      const intent = await prisma.paymentIntent.findUnique({
        where: { id: paymentIntentId },
      });
      expect(intent?.status).toBe('refunded');

      // Verify order
      const order = await prisma.order.findUnique({
        where: { id: orderId },
      });
      expect(order?.status).toBe('refunded');

      // Verify entitlement revoked
      entitlement = await prisma.entitlement.findFirst({
        where: { userId, key: 'test.entitlement', status: 'active' },
      });
      expect(entitlement).toBeNull();

      const revoked = await prisma.entitlement.findFirst({
        where: { userId, key: 'test.entitlement', status: 'revoked' },
      });
      expect(revoked).toBeDefined();
    });
  });
});
