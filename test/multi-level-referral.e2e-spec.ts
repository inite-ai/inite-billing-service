import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { TestAppModule } from '../src/test-app.module';
import { PrismaService } from '../src/common/services/prisma.service';
import { PaymentOrchestratorService } from '../src/payment-orchestrator/payment-orchestrator.service';
import { AffiliatesService } from '../src/affiliates/affiliates.service';
import { ReferralLevelsService } from '../src/affiliates/referral-levels.service';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/auth/guards/roles.guard';
import { MockJwtAuthGuard } from './mocks/auth.mock';
import { MockOneAdapter } from './mocks/one-adapter.mock';
import { cleanupTestData } from './helpers/cleanup.helper';

/**
 * Multi-Level Referral Commission Test
 *
 * Template (7 levels, total 30%):
 *   Level 1: 15%
 *   Level 2:  1%
 *   Level 3:  1.5%
 *   Level 4:  2%
 *   Level 5:  3%
 *   Level 6:  3.5%
 *   Level 7:  4%
 *
 * Chain: User8 (buyer) -> Aff7 -> Aff6 -> Aff5 -> Aff4 -> Aff3 -> Aff2 -> Aff1 (root)
 * When User8 pays $1000, commissions distribute:
 *   Aff7 (L1, direct referrer) -> $150  (15%)
 *   Aff6 (L2)                  -> $10   (1%)
 *   Aff5 (L3)                  -> $15   (1.5%)
 *   Aff4 (L4)                  -> $20   (2%)
 *   Aff3 (L5)                  -> $30   (3%)
 *   Aff2 (L6)                  -> $35   (3.5%)
 *   Aff1 (L7)                  -> $40   (4%)
 *   Total                      -> $300  (30%)
 */
describe('Multi-Level Referral System (7 levels, 30% total)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orchestrator: PaymentOrchestratorService;
  let affiliatesService: AffiliatesService;
  let referralLevelsService: ReferralLevelsService;
  let mockOneAdapter: MockOneAdapter;

  let serviceId: string;
  let productId: string;
  let priceId: string;

  // 8 users: user1..user7 are affiliates, user8 is the buyer
  const userIds = Array.from({ length: 8 }, (_, i) =>
    `00000000-0000-0000-0000-00000000000${i + 1}`,
  );
  const affiliateIds: string[] = [];

  // Commission rates per level (from the template image)
  const LEVELS = [
    { level: 1, rate: 0.15, name: 'Direct Referral' },
    { level: 2, rate: 0.01, name: 'Level 2' },
    { level: 3, rate: 0.015, name: 'Level 3' },
    { level: 4, rate: 0.02, name: 'Level 4' },
    { level: 5, rate: 0.03, name: 'Level 5' },
    { level: 6, rate: 0.035, name: 'Level 6' },
    { level: 7, rate: 0.04, name: 'Level 7' },
  ];

  const ORDER_AMOUNT = 1000;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(MockJwtAuthGuard)
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
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
    affiliatesService = app.get<AffiliatesService>(AffiliatesService);
    referralLevelsService = app.get<ReferralLevelsService>(ReferralLevelsService);
    mockOneAdapter = app.get<MockOneAdapter>(MockOneAdapter);
  });

  afterAll(async () => {
    await cleanupTestData(prisma);
    await app.close();
    await prisma.$disconnect();
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  afterEach(() => {
    mockOneAdapter.clearMocks();
  });

  describe('Setup: Service + 7 Referral Levels', () => {
    it('should create a service', async () => {
      const service = await prisma.service.create({
        data: {
          code: 'test-mlm-service',
          name: 'Test MLM Service',
        },
      });
      serviceId = service.id;
      expect(service.code).toBe('test-mlm-service');
    });

    it('should create 7 referral levels with correct rates', async () => {
      for (const lvl of LEVELS) {
        const created = await referralLevelsService.createLevel({
          serviceId,
          level: lvl.level,
          commissionRate: lvl.rate,
          name: lvl.name,
        });
        expect(created.level).toBe(lvl.level);
        expect(Number(created.commissionRate)).toBeCloseTo(lvl.rate, 4);
      }

      const allLevels = await referralLevelsService.getLevelsByService(serviceId);
      expect(allLevels).toHaveLength(7);

      // Verify total = 30%
      const totalRate = allLevels.reduce(
        (sum, l) => sum + Number(l.commissionRate),
        0,
      );
      expect(totalRate).toBeCloseTo(0.3, 4);
    });

    it('should reject non-sequential levels', async () => {
      await expect(
        referralLevelsService.createLevel({
          serviceId,
          level: 10, // should be 8
          commissionRate: 0.01,
          name: 'Invalid',
        }),
      ).rejects.toThrow('Level must be sequential');
    });

    it('should create product + price for this service', async () => {
      const product = await prisma.product.create({
        data: {
          code: `mlm-product-${Date.now()}`,
          name: 'MLM Test Product',
          moduleScope: 'test-mlm-service',
          serviceId,
          type: 'one_time',
          isActive: true,
        },
      });
      productId = product.id;

      const price = await prisma.price.create({
        data: {
          productId,
          code: `mlm-price-${Date.now()}`,
          currency: 'USD',
          amount: ORDER_AMOUNT,
          isActive: true,
        },
      });
      priceId = price.id;
    });
  });

  describe('Setup: 7-deep affiliate chain', () => {
    it('should create affiliate chain: Aff1 (root) -> Aff2 -> ... -> Aff7', async () => {
      // Aff1 is root (no parent)
      const aff1 = await prisma.affiliate.create({
        data: {
          userId: userIds[0],
          serviceId,
          referralCode: 'MLM-ROOT-001',
          status: 'active',
          commissionRate: 0.15,
        },
      });
      affiliateIds.push(aff1.id);

      // Aff2..Aff7 each has parent
      for (let i = 1; i < 7; i++) {
        const aff = await prisma.affiliate.create({
          data: {
            userId: userIds[i],
            serviceId,
            parentAffiliateId: affiliateIds[i - 1],
            referralCode: `MLM-AFF-00${i + 1}`,
            status: 'active',
            commissionRate: 0.15,
          },
        });
        affiliateIds.push(aff.id);
      }

      expect(affiliateIds).toHaveLength(7);

      // Verify chain
      const aff7 = await prisma.affiliate.findUnique({
        where: { id: affiliateIds[6] },
      });
      expect(aff7?.parentAffiliateId).toBe(affiliateIds[5]); // parent = Aff6
    });

    it('should create referral: User8 referred by Aff7', async () => {
      const buyerUserId = userIds[7]; // user8

      const referral = await prisma.referral.create({
        data: {
          affiliateId: affiliateIds[6], // Aff7 referred user8
          referredUserId: buyerUserId,
          serviceId,
          referralCode: 'MLM-AFF-007',
          firstOrderPaid: false,
        },
      });

      expect(referral.affiliateId).toBe(affiliateIds[6]);
      expect(referral.referredUserId).toBe(buyerUserId);
    });
  });

  describe('Multi-level commission distribution on payment', () => {
    it('should distribute commissions across all 7 levels when User8 pays $1000', async () => {
      const buyerUserId = userIds[7];

      // Create order
      const order = await prisma.order.create({
        data: {
          userId: buyerUserId,
          priceId,
          mode: 'PAYMENT',
          status: 'created',
          amount: ORDER_AMOUNT,
          currency: 'USD',
          externalId: `mlm-order-${Date.now()}`,
        },
      });

      // Create payment intent
      const intentResult = await mockOneAdapter.createPaymentIntent({
        orderId: order.externalId!,
        amount: ORDER_AMOUNT,
        currency: 'USD',
        mode: 'PAYMENT',
      });

      const intent = await prisma.paymentIntent.create({
        data: {
          orderId: order.id,
          rail: 'ONE',
          status: 'created',
          providerIntentId: intentResult.providerIntentId,
          amount: ORDER_AMOUNT,
          currency: 'USD',
        },
      });

      // Transition: created -> opened -> paid
      mockOneAdapter.setIntentStatus(intentResult.providerIntentId, 'OPENED');
      await orchestrator.applyStateTransition(intent.id, 'opened');

      mockOneAdapter.setIntentStatus(intentResult.providerIntentId, 'CLOSED');
      await orchestrator.applyStateTransition(intent.id, 'paid');

      // Verify commissions
      const commissions = await prisma.affiliateCommission.findMany({
        where: { orderId: order.id },
        orderBy: { level: 'asc' },
      });

      expect(commissions).toHaveLength(7);

      // Expected amounts: $1000 * rate
      const expected = [
        { level: 1, affiliateId: affiliateIds[6], amount: 150 },  // Aff7 (direct) = 15%
        { level: 2, affiliateId: affiliateIds[5], amount: 10 },   // Aff6 = 1%
        { level: 3, affiliateId: affiliateIds[4], amount: 15 },   // Aff5 = 1.5%
        { level: 4, affiliateId: affiliateIds[3], amount: 20 },   // Aff4 = 2%
        { level: 5, affiliateId: affiliateIds[2], amount: 30 },   // Aff3 = 3%
        { level: 6, affiliateId: affiliateIds[1], amount: 35 },   // Aff2 = 3.5%
        { level: 7, affiliateId: affiliateIds[0], amount: 40 },   // Aff1 (root) = 4%
      ];

      for (let i = 0; i < expected.length; i++) {
        expect(commissions[i].level).toBe(expected[i].level);
        expect(commissions[i].affiliateId).toBe(expected[i].affiliateId);
        expect(Number(commissions[i].amount)).toBeCloseTo(expected[i].amount, 2);
        expect(commissions[i].status).toBe('earned');
        expect(commissions[i].currency).toBe('USD');
      }

      // Verify total commission = 30% of $1000 = $300
      const totalCommission = commissions.reduce(
        (sum, c) => sum + Number(c.amount),
        0,
      );
      expect(totalCommission).toBeCloseTo(300, 2);
    });

    it('should update referral.firstOrderPaid after payment', async () => {
      const buyerUserId = userIds[7];

      const referral = await prisma.referral.findFirst({
        where: { referredUserId: buyerUserId, serviceId },
      });

      expect(referral).toBeDefined();
      expect(referral?.firstOrderPaid).toBe(true);
    });

    it('should update totalEarned for each affiliate', async () => {
      const expectedEarnings = [40, 35, 30, 20, 15, 10, 150]; // Aff1..Aff7

      for (let i = 0; i < 7; i++) {
        const aff = await prisma.affiliate.findUnique({
          where: { id: affiliateIds[i] },
        });
        expect(Number(aff?.totalEarned)).toBeCloseTo(expectedEarnings[i], 2);
      }
    });

    it('should NOT create commissions on second payment (first order only)', async () => {
      const buyerUserId = userIds[7];

      // Second order
      const order2 = await prisma.order.create({
        data: {
          userId: buyerUserId,
          priceId,
          mode: 'PAYMENT',
          status: 'created',
          amount: 500,
          currency: 'USD',
          externalId: `mlm-order-2-${Date.now()}`,
        },
      });

      const intentResult2 = await mockOneAdapter.createPaymentIntent({
        orderId: order2.externalId!,
        amount: 500,
        currency: 'USD',
        mode: 'PAYMENT',
      });

      const intent2 = await prisma.paymentIntent.create({
        data: {
          orderId: order2.id,
          rail: 'ONE',
          status: 'created',
          providerIntentId: intentResult2.providerIntentId,
          amount: 500,
          currency: 'USD',
        },
      });

      mockOneAdapter.setIntentStatus(intentResult2.providerIntentId, 'OPENED');
      await orchestrator.applyStateTransition(intent2.id, 'opened');

      mockOneAdapter.setIntentStatus(intentResult2.providerIntentId, 'CLOSED');
      await orchestrator.applyStateTransition(intent2.id, 'paid');

      // No new commissions for this order
      const commissions = await prisma.affiliateCommission.findMany({
        where: { orderId: order2.id },
      });

      expect(commissions).toHaveLength(0);
    });
  });

  describe('Partial chain (fewer levels than configured)', () => {
    it('should distribute commissions only up to available parent depth', async () => {
      // Create a short chain: NewAff1 -> NewAff2 (only 2 deep)
      const newAff1 = await prisma.affiliate.create({
        data: {
          userId: `10000000-0000-0000-0000-000000000001`,
          serviceId,
          referralCode: `SHORT-ROOT-${Date.now()}`,
          status: 'active',
          commissionRate: 0.15,
        },
      });

      const newAff2 = await prisma.affiliate.create({
        data: {
          userId: `10000000-0000-0000-0000-000000000002`,
          serviceId,
          parentAffiliateId: newAff1.id,
          referralCode: `SHORT-L2-${Date.now()}`,
          status: 'active',
          commissionRate: 0.15,
        },
      });

      const shortBuyerId = `10000000-0000-0000-0000-000000000003`;

      // Referral: buyer referred by newAff2
      await prisma.referral.create({
        data: {
          affiliateId: newAff2.id,
          referredUserId: shortBuyerId,
          serviceId,
          referralCode: newAff2.referralCode,
          firstOrderPaid: false,
        },
      });

      const order = await prisma.order.create({
        data: {
          userId: shortBuyerId,
          priceId,
          mode: 'PAYMENT',
          status: 'created',
          amount: 1000,
          currency: 'USD',
          externalId: `short-order-${Date.now()}`,
        },
      });

      const intentResult = await mockOneAdapter.createPaymentIntent({
        orderId: order.externalId!,
        amount: 1000,
        currency: 'USD',
        mode: 'PAYMENT',
      });

      const intent = await prisma.paymentIntent.create({
        data: {
          orderId: order.id,
          rail: 'ONE',
          status: 'created',
          providerIntentId: intentResult.providerIntentId,
          amount: 1000,
          currency: 'USD',
        },
      });

      mockOneAdapter.setIntentStatus(intentResult.providerIntentId, 'OPENED');
      await orchestrator.applyStateTransition(intent.id, 'opened');

      mockOneAdapter.setIntentStatus(intentResult.providerIntentId, 'CLOSED');
      await orchestrator.applyStateTransition(intent.id, 'paid');

      // Only 2 commissions (chain is only 2 deep)
      const commissions = await prisma.affiliateCommission.findMany({
        where: { orderId: order.id },
        orderBy: { level: 'asc' },
      });

      expect(commissions).toHaveLength(2);
      expect(commissions[0].level).toBe(1);
      expect(Number(commissions[0].amount)).toBeCloseTo(150, 2); // 15%
      expect(commissions[0].affiliateId).toBe(newAff2.id);

      expect(commissions[1].level).toBe(2);
      expect(Number(commissions[1].amount)).toBeCloseTo(10, 2); // 1%
      expect(commissions[1].affiliateId).toBe(newAff1.id);
    });
  });

  describe('Inactive affiliate in chain', () => {
    it('should skip inactive affiliate and continue up the chain', async () => {
      // Create chain: ActiveRoot -> InactiveMiddle -> ActiveDirect
      const activeRoot = await prisma.affiliate.create({
        data: {
          userId: `20000000-0000-0000-0000-000000000001`,
          serviceId,
          referralCode: `SKIP-ROOT-${Date.now()}`,
          status: 'active',
          commissionRate: 0.15,
        },
      });

      const inactiveMiddle = await prisma.affiliate.create({
        data: {
          userId: `20000000-0000-0000-0000-000000000002`,
          serviceId,
          parentAffiliateId: activeRoot.id,
          referralCode: `SKIP-INACTIVE-${Date.now()}`,
          status: 'inactive', // <-- inactive
          commissionRate: 0.15,
        },
      });

      const activeDirect = await prisma.affiliate.create({
        data: {
          userId: `20000000-0000-0000-0000-000000000003`,
          serviceId,
          parentAffiliateId: inactiveMiddle.id,
          referralCode: `SKIP-DIRECT-${Date.now()}`,
          status: 'active',
          commissionRate: 0.15,
        },
      });

      const skipBuyerId = `20000000-0000-0000-0000-000000000004`;

      await prisma.referral.create({
        data: {
          affiliateId: activeDirect.id,
          referredUserId: skipBuyerId,
          serviceId,
          referralCode: activeDirect.referralCode,
          firstOrderPaid: false,
        },
      });

      const order = await prisma.order.create({
        data: {
          userId: skipBuyerId,
          priceId,
          mode: 'PAYMENT',
          status: 'created',
          amount: 1000,
          currency: 'USD',
          externalId: `skip-order-${Date.now()}`,
        },
      });

      const intentResult = await mockOneAdapter.createPaymentIntent({
        orderId: order.externalId!,
        amount: 1000,
        currency: 'USD',
        mode: 'PAYMENT',
      });

      const intent = await prisma.paymentIntent.create({
        data: {
          orderId: order.id,
          rail: 'ONE',
          status: 'created',
          providerIntentId: intentResult.providerIntentId,
          amount: 1000,
          currency: 'USD',
        },
      });

      mockOneAdapter.setIntentStatus(intentResult.providerIntentId, 'OPENED');
      await orchestrator.applyStateTransition(intent.id, 'opened');

      mockOneAdapter.setIntentStatus(intentResult.providerIntentId, 'CLOSED');
      await orchestrator.applyStateTransition(intent.id, 'paid');

      const commissions = await prisma.affiliateCommission.findMany({
        where: { orderId: order.id },
        orderBy: { level: 'asc' },
      });

      // L1 (activeDirect) = $150, L2 skipped (inactive), L3 (activeRoot) = $15
      // The inactive affiliate is skipped but the level counter still increments
      expect(commissions.length).toBeGreaterThanOrEqual(2);

      // Direct referrer should get L1 commission
      const l1 = commissions.find((c) => c.affiliateId === activeDirect.id);
      expect(l1).toBeDefined();
      expect(l1?.level).toBe(1);
      expect(Number(l1?.amount)).toBeCloseTo(150, 2);

      // Root should get L3 commission (L2 was inactive, skipped)
      const rootComm = commissions.find((c) => c.affiliateId === activeRoot.id);
      expect(rootComm).toBeDefined();
      expect(rootComm?.level).toBe(3);
      expect(Number(rootComm?.amount)).toBeCloseTo(15, 2); // 1.5%
    });
  });

  describe('Admin API: Referral Level Management', () => {
    it('GET /v1/admin/referral-levels should return levels for service', async () => {
      MockJwtAuthGuard.testUserRoles = ['admin'];

      const response = await request(app.getHttpServer())
        .get('/v1/admin/referral-levels')
        .query({ serviceId })
        .set('Authorization', `Bearer mock-token`)
        .expect(200);

      expect(response.body.length).toBeGreaterThanOrEqual(7);

      // Restore
      MockJwtAuthGuard.testUserRoles = ['user'];
    });

    it('GET /v1/admin/stats should return overall statistics', async () => {
      MockJwtAuthGuard.testUserRoles = ['admin'];

      const response = await request(app.getHttpServer())
        .get('/v1/admin/stats')
        .set('Authorization', `Bearer mock-token`)
        .expect(200);

      expect(response.body).toHaveProperty('totalOrders');
      expect(response.body).toHaveProperty('totalRevenue');
      expect(response.body).toHaveProperty('totalAffiliates');
      expect(response.body).toHaveProperty('totalCommissions');

      MockJwtAuthGuard.testUserRoles = ['user'];
    });
  });

  describe('Affiliate Tree API', () => {
    it('GET /v1/affiliates/me/tree should return tree structure', async () => {
      // Set userId to Aff1 (root)
      MockJwtAuthGuard.testUserId = userIds[0];

      const response = await request(app.getHttpServer())
        .get('/v1/affiliates/me/tree')
        .query({ serviceId })
        .set('Authorization', `Bearer mock-token`)
        .expect(200);

      expect(response.body).toHaveProperty('children');
      expect(response.body).toHaveProperty('referralCode', 'MLM-ROOT-001');

      // Restore
      MockJwtAuthGuard.testUserId = '00000000-0000-0000-0000-000000000001';
    });
  });
});
