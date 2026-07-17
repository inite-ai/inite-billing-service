import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { TestAppModule } from './test-app.module';
import { PrismaService } from '../src/common/services/prisma.service';
import { AffiliatesService } from '../src/affiliates/affiliates.service';
import { CommissionSettlementScheduler } from '../src/affiliates/commission-settlement.scheduler';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/auth/guards/roles.guard';
import { MockJwtAuthGuard } from './mocks/auth.mock';
import { cleanupTestData } from './helpers/cleanup.helper';

describe('Settlement & Withdrawal', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let affiliatesService: AffiliatesService;
  let settlementScheduler: CommissionSettlementScheduler;
  let serviceId: string;
  let affiliateId: string;
  let productId: string;
  let priceId: string;

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
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    affiliatesService = app.get<AffiliatesService>(AffiliatesService);
    settlementScheduler = app.get<CommissionSettlementScheduler>(CommissionSettlementScheduler);

    // Create test service with 0 settlement days for fast testing
    const svc = await prisma.service.create({
      data: {
        code: `sw-test-${Date.now()}`,
        name: 'Settlement Test Service',
        apiKey: `sk_test_${Date.now()}`,
        metadata: { settlementDays: 0, minWithdrawalAmount: 5 },
      },
    });
    serviceId = svc.id;

    // Create product + price
    const product = await prisma.product.create({
      data: {
        code: `prod-sw-${Date.now()}`,
        name: 'Test Product',
        type: 'one_time',
        moduleScope: 'test',
        serviceId,
      },
    });
    productId = product.id;

    const price = await prisma.price.create({
      data: {
        code: `price-sw-${Date.now()}`,
        productId,
        amount: 100,
        currency: 'USD',
        isActive: true,
      },
    });
    priceId = price.id;

    // Create referral level
    await prisma.referralLevel.create({
      data: {
        serviceId,
        level: 1,
        commissionRate: 0.15,
        name: 'Level 1',
      },
    });

    // Create affiliate (the referrer)
    const affiliate = await prisma.affiliate.create({
      data: {
        userId: 'test-referrer-user',
        serviceId,
        referralCode: `ref-sw-${Date.now()}`,
        status: 'active',
      },
    });
    affiliateId = affiliate.id;
  });

  afterAll(async () => {
    await cleanupTestData(prisma);
    await app.close();
    await prisma.$disconnect();
    await new Promise((r) => setTimeout(r, 200));
  });

  it('should create commission as pending', async () => {
    // Create a referral
    await prisma.referral.create({
      data: {
        affiliateId,
        referredUserId: 'test-buyer-user',
        serviceId,
        referralCode: `ref-sw-${Date.now()}`,
      },
    });

    // Create an order
    const order = await prisma.order.create({
      data: {
        userId: 'test-buyer-user',
        priceId,
        amount: 100,
        currency: 'USD',
        mode: 'PAYMENT',
        status: 'paid',
      },
    });

    // Process commissions
    await affiliatesService.processMultiLevelCommissions(
      order.id,
      'test-buyer-user',
      100,
      'USD',
      serviceId,
    );

    // Commission should be pending
    const commissions = await prisma.affiliateCommission.findMany({
      where: { affiliateId },
    });
    expect(commissions).toHaveLength(1);
    expect(commissions[0].status).toBe('pending');
    expect(Number(commissions[0].amount)).toBeCloseTo(15, 1); // 15% of 100

    // totalEarned should NOT be incremented yet
    const affiliate = await prisma.affiliate.findUnique({ where: { id: affiliateId } });
    expect(Number(affiliate!.totalEarned)).toBe(0);
  });

  it('should settle commission after settlement period', async () => {
    // Run settlement (settlementDays=0 so all pending commissions qualify)
    await settlementScheduler.settleCommissions();

    // Commission should now be earned
    const commissions = await prisma.affiliateCommission.findMany({
      where: { affiliateId },
    });
    expect(commissions[0].status).toBe('earned');
    expect(commissions[0].earnedAt).toBeTruthy();

    // totalEarned should be incremented
    const affiliate = await prisma.affiliate.findUnique({ where: { id: affiliateId } });
    expect(Number(affiliate!.totalEarned)).toBeCloseTo(15, 1);
  });

  it('should return correct balance', async () => {
    const balance = await affiliatesService.getBalance(affiliateId);
    expect(Number(balance.available)).toBeCloseTo(15, 1);
    expect(balance.canWithdraw).toBe(true);
    expect(Number(balance.minWithdrawalAmount)).toBe(5);
  });

  it('should reject withdrawal below minimum', async () => {
    await expect(affiliatesService.requestWithdrawal(affiliateId, 2, 'USD')).rejects.toThrow(
      'Minimum withdrawal amount',
    );
  });

  it('should reject withdrawal exceeding balance', async () => {
    await expect(affiliatesService.requestWithdrawal(affiliateId, 1000, 'USD')).rejects.toThrow(
      'Insufficient balance',
    );
  });

  it('should process withdrawal request', async () => {
    const payout = await affiliatesService.requestWithdrawal(affiliateId, 10, 'USD');
    expect(payout).toBeDefined();
    expect(payout.status).toBe('pending');
    expect(Number(payout.totalAmount)).toBe(10);

    // Balance should decrease
    const balance = await affiliatesService.getBalance(affiliateId);
    expect(Number(balance.available)).toBeCloseTo(5, 1); // 15 - 10
  });

  it('should reject duplicate pending withdrawal', async () => {
    await expect(affiliatesService.requestWithdrawal(affiliateId, 5, 'USD')).rejects.toThrow(
      'already have a pending withdrawal',
    );
  });

  it('should not settle already earned commissions', async () => {
    // Run settlement again — nothing should change
    await settlementScheduler.settleCommissions();

    const commissions = await prisma.affiliateCommission.findMany({
      where: { affiliateId },
    });
    expect(commissions).toHaveLength(1);
    expect(commissions[0].status).toBe('earned');

    const affiliate = await prisma.affiliate.findUnique({ where: { id: affiliateId } });
    expect(Number(affiliate!.totalEarned)).toBeCloseTo(15, 1); // unchanged
  });
});
