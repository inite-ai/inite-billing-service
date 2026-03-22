import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { TestAppModule } from './test-app.module';
import { PrismaService } from '../src/common/services/prisma.service';
import { ReferralLevelsService } from '../src/affiliates/referral-levels.service';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/auth/guards/roles.guard';
import { MockJwtAuthGuard } from './mocks/auth.mock';
import { cleanupTestData } from './helpers/cleanup.helper';

describe('ReferralLevelsService', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: ReferralLevelsService;
  let serviceId: string;

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
    service = app.get<ReferralLevelsService>(ReferralLevelsService);

    // Create test service
    const svc = await prisma.service.create({
      data: { code: `rl-test-${Date.now()}`, name: 'RL Test Service', apiKey: `sk_test_${Date.now()}` },
    });
    serviceId = svc.id;
  });

  afterAll(async () => {
    await cleanupTestData(prisma);
    await app.close();
    await prisma.$disconnect();
    await new Promise((r) => setTimeout(r, 200));
  });

  it('should create levels sequentially', async () => {
    const l1 = await service.createLevel({
      serviceId,
      level: 1,
      commissionRate: 0.15,
      name: 'Level 1',
    });
    expect(l1.level).toBe(1);
    expect(Number(l1.commissionRate)).toBeCloseTo(0.15, 4);

    const l2 = await service.createLevel({
      serviceId,
      level: 2,
      commissionRate: 0.01,
      name: 'Level 2',
    });
    expect(l2.level).toBe(2);
  });

  it('should reject non-sequential level creation', async () => {
    await expect(
      service.createLevel({
        serviceId,
        level: 5, // should be 3
        commissionRate: 0.02,
        name: 'Skip',
      }),
    ).rejects.toThrow('Level must be sequential');
  });

  it('should get all levels for a service', async () => {
    const levels = await service.getLevelsByService(serviceId);
    expect(levels).toHaveLength(2);
    expect(levels[0].level).toBe(1);
    expect(levels[1].level).toBe(2);
  });

  it('should update commission rate', async () => {
    const levels = await service.getLevelsByService(serviceId);
    const updated = await service.updateLevel(levels[0].id, {
      commissionRate: 0.20,
    });
    expect(Number(updated.commissionRate)).toBeCloseTo(0.20, 4);

    // Restore
    await service.updateLevel(levels[0].id, { commissionRate: 0.15 });
  });

  it('should only delete highest level', async () => {
    const levels = await service.getLevelsByService(serviceId);
    const l1 = levels.find((l) => l.level === 1)!;
    const l2 = levels.find((l) => l.level === 2)!;

    // Cannot delete level 1 when level 2 exists
    await expect(service.deleteLevel(l1.id)).rejects.toThrow(
      'Can only delete the highest level',
    );

    // Can delete level 2 (highest)
    await service.deleteLevel(l2.id);

    const remaining = await service.getLevelsByService(serviceId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].level).toBe(1);
  });

  it('should get commission rate for specific level', async () => {
    const rate = await service.getCommissionRateForLevel(serviceId, 1);
    expect(rate).toBeCloseTo(0.15, 4);

    const noRate = await service.getCommissionRateForLevel(serviceId, 99);
    expect(noRate).toBeNull();
  });

  it('should return null for inactive level', async () => {
    const levels = await service.getLevelsByService(serviceId);
    await service.updateLevel(levels[0].id, { isActive: false });

    const rate = await service.getCommissionRateForLevel(serviceId, 1);
    expect(rate).toBeNull();

    // Restore
    await service.updateLevel(levels[0].id, { isActive: true });
  });
});
