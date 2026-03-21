import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { TestAppModule } from './test-app.module';
import { PrismaService } from '../src/common/services/prisma.service';
import { PaymentOrchestratorService } from '../src/payment-orchestrator/payment-orchestrator.service';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { MockJwtAuthGuard } from './mocks/auth.mock';
import { MockOneAdapter } from './mocks/one-adapter.mock';
import { cleanupTestData } from './helpers/cleanup.helper';

describe('Affiliates E2E Tests', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orchestrator: PaymentOrchestratorService;
  let mockOneAdapter: MockOneAdapter;
  let authToken: string;
  let userId: string;
  let affiliateId: string;
  let referralCode: string;
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
    orchestrator = app.get<PaymentOrchestratorService>(PaymentOrchestratorService);
    mockOneAdapter = app.get<MockOneAdapter>(MockOneAdapter);

    userId = MockJwtAuthGuard.testUserId;
    authToken = `Bearer mock-token-${userId}`;

    // Create test product and price
    const product = await prisma.product.create({
      data: {
        code: 'test-product-affiliate',
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
        code: 'test-price-affiliate',
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

  afterEach(async () => {
    mockOneAdapter.clearMocks();
  });

  beforeEach(async () => {
    // Create test product and price for each test
    const product = await prisma.product.create({
      data: {
        code: `test-product-${Date.now()}-${Math.random()}`,
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
        code: `test-price-${Date.now()}-${Math.random()}`,
        currency: 'USD',
        amount: 100.0,
        isActive: true,
      },
    });
    priceId = price.id;
  });

  describe('POST /v1/affiliates', () => {
    it('should create affiliate account', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/affiliates')
        .set('Authorization', authToken)
        .send({})
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('referralCode');
      expect(response.body).toHaveProperty('referralUrl');
      expect(response.body.userId).toBe(userId);
      expect(response.body.status).toBe('active');
      expect(response.body.commissionRate).toBe('0.5');

      affiliateId = response.body.id;
      referralCode = response.body.referralCode;
    });

    it('should return existing affiliate if already exists', async () => {
      const response1 = await request(app.getHttpServer())
        .post('/v1/affiliates')
        .set('Authorization', authToken)
        .send({})
        .expect(201);

      const response2 = await request(app.getHttpServer())
        .post('/v1/affiliates')
        .set('Authorization', authToken)
        .send({})
        .expect(201);

      // Should return same affiliate
      expect(response1.body.id).toBe(response2.body.id);
    });
  });

  describe('GET /v1/affiliates/me', () => {
    beforeEach(async () => {
      // Delete any existing affiliate for this user
      await prisma.affiliate.deleteMany({ where: { userId } });
      
      // Create affiliate
      const affiliate = await prisma.affiliate.create({
        data: {
          userId,
          referralCode: `TEST-${Date.now()}-${Math.random()}`,
          status: 'active',
          commissionRate: 0.5,
        },
      });
      affiliateId = affiliate.id;
    });

    it('should get affiliate account', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/affiliates/me')
        .set('Authorization', authToken)
        .expect(200);

      expect(response.body.id).toBe(affiliateId);
      expect(response.body.referralCode).toContain('TEST-');
      expect(response.body.referralUrl).toContain(response.body.referralCode);
    });
  });

  describe('GET /v1/affiliates/me/stats', () => {
    beforeEach(async () => {
      // Delete any existing affiliate for this user
      await prisma.affiliate.deleteMany({ where: { userId } });
      
      const affiliate = await prisma.affiliate.create({
        data: {
          userId,
          referralCode: `STATS-${Date.now()}-${Math.random()}`,
          status: 'active',
          commissionRate: 0.5,
        },
      });
      affiliateId = affiliate.id;
    });

    it('should get affiliate stats', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/affiliates/me/stats')
        .set('Authorization', authToken)
        .expect(200);

      expect(response.body).toHaveProperty('totalReferrals');
      expect(response.body).toHaveProperty('totalCommissions');
      expect(response.body).toHaveProperty('pendingCommissions');
      expect(response.body).toHaveProperty('paidCommissions');
    });
  });

  describe('Affiliate Commission Flow', () => {
    let referredUserId: string;
    let referralId: string;

    beforeEach(async () => {
      // Delete any existing affiliate for this user
      await prisma.affiliate.deleteMany({ where: { userId } });
      
      // Create affiliate
      const affiliate = await prisma.affiliate.create({
        data: {
          userId,
          referralCode: `COMM-${Date.now()}-${Math.random()}`,
          status: 'active',
          commissionRate: 0.5,
        },
      });
      affiliateId = affiliate.id;
      referralCode = affiliate.referralCode;

      // Create referred user
      referredUserId = '00000000-0000-0000-0000-000000000002';

      // Create referral
      const referral = await prisma.referral.create({
        data: {
          affiliateId,
          referredUserId,
          referralCode,
          firstOrderPaid: false,
        },
      });
      referralId = referral.id;
    });

    it('should create commission on first payment', async () => {
      // Create order for referred user with referralCode in metadata
      const order = await prisma.order.create({
        data: {
          userId: referredUserId,
          priceId,
          mode: 'PAYMENT',
          status: 'created',
          amount: 100.0,
          currency: 'USD',
          externalId: `order_${Date.now()}`,
          metadata: { referralCode },
        },
      });

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
          amount: 100.0,
          currency: 'USD',
        },
      });

      // Transition to opened then paid
      mockOneAdapter.setIntentStatus(intentResult.providerIntentId, 'OPENED');
      await orchestrator.applyStateTransition(intent.id, 'opened');
      
      mockOneAdapter.setIntentStatus(intentResult.providerIntentId, 'CLOSED');
      await orchestrator.applyStateTransition(intent.id, 'paid');

      // Verify commission created
      const commission = await prisma.affiliateCommission.findFirst({
        where: {
          affiliateId,
          orderId: order.id,
        },
      });

      expect(commission).toBeDefined();
      expect(Number(commission?.amount)).toBe(50.0); // 50% of 100
      expect(commission?.status).toBe('earned');

      // Verify referral updated
      const referral = await prisma.referral.findUnique({
        where: { id: referralId },
      });
      expect(referral?.firstOrderPaid).toBe(true);
      expect(referral?.firstOrderId).toBe(order.id);

      // Verify affiliate totals updated
      const affiliate = await prisma.affiliate.findUnique({
        where: { id: affiliateId },
      });
      expect(Number(affiliate?.totalEarned)).toBe(50.0);
    });

    it('should NOT create commission on second payment', async () => {
      // First payment
      const order1 = await prisma.order.create({
        data: {
          userId: referredUserId,
          priceId,
          mode: 'PAYMENT',
          status: 'created',
          amount: 100.0,
          currency: 'USD',
          externalId: `order_1_${Date.now()}`,
          metadata: { referralCode },
        },
      });

      const intent1Result = await mockOneAdapter.createPaymentIntent({
        orderId: order1.externalId!,
        amount: 100,
        currency: 'USD',
        mode: 'PAYMENT',
      });

      const intent1 = await prisma.paymentIntent.create({
        data: {
          orderId: order1.id,
          rail: 'ONE',
          status: 'created',
          providerIntentId: intent1Result.providerIntentId,
          amount: 100.0,
          currency: 'USD',
        },
      });

      mockOneAdapter.setIntentStatus(intent1Result.providerIntentId, 'OPENED');
      await orchestrator.applyStateTransition(intent1.id, 'opened');
      
      mockOneAdapter.setIntentStatus(intent1Result.providerIntentId, 'CLOSED');
      await orchestrator.applyStateTransition(intent1.id, 'paid');

      // Second payment
      const order2 = await prisma.order.create({
        data: {
          userId: referredUserId,
          priceId,
          mode: 'PAYMENT',
          status: 'created',
          amount: 200.0,
          currency: 'USD',
          externalId: `order_2_${Date.now()}`,
          metadata: { referralCode },
        },
      });

      const intent2Result = await mockOneAdapter.createPaymentIntent({
        orderId: order2.externalId!,
        amount: 200,
        currency: 'USD',
        mode: 'PAYMENT',
      });

      const intent2 = await prisma.paymentIntent.create({
        data: {
          orderId: order2.id,
          rail: 'ONE',
          status: 'created',
          providerIntentId: intent2Result.providerIntentId,
          amount: 200.0,
          currency: 'USD',
        },
      });

      mockOneAdapter.setIntentStatus(intent2Result.providerIntentId, 'OPENED');
      await orchestrator.applyStateTransition(intent2.id, 'opened');
      
      mockOneAdapter.setIntentStatus(intent2Result.providerIntentId, 'CLOSED');
      await orchestrator.applyStateTransition(intent2.id, 'paid');

      // Verify only one commission exists
      const commissions = await prisma.affiliateCommission.findMany({
        where: { affiliateId },
      });

      expect(commissions.length).toBe(1);
      expect(commissions[0].orderId).toBe(order1.id); // Only first order
    });
  });
});
