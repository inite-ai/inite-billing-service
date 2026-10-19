import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TestAppModule } from './test-app.module';
import { PrismaService } from '../src/common/services/prisma.service';
import { sealLegacyConfigs } from '../src/common/key-seal';
import {
  isSealedConfig,
  openConfig,
  sealConfig,
} from '../src/common/services/provider-config-seal';

/**
 * Rail credentials at rest: what is on disk is sealed, what every caller
 * reads is the plain config, and a config stored before sealing is sealed
 * once at boot and reads the same.
 */
describe('Provider configs at rest', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const CODE = 'SEAL_TEST';
  const PAYOUT = 'SEAL_PAYOUT_TEST';
  const config = {
    secretKey: 'sk_live_abcdef123456',
    webhookSecret: 'whsec_xyz',
    nested: { a: 1 },
  };

  const raw = async (table: string, code: string) =>
    (
      await prisma.$queryRawUnsafe<{ config: any }[]>(
        `SELECT config FROM "billing"."${table}" WHERE code = '${code}'`,
      )
    )[0]?.config;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
    app = module.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.paymentProvider.deleteMany({ where: { code: CODE } });
    await prisma.payoutProvider.deleteMany({ where: { code: PAYOUT } });
    await app.close();
  });

  it('seals a config bound to its table, and leaves sentinels alone', () => {
    const sealed = sealConfig(config, 'PaymentProvider');
    expect(isSealedConfig(sealed)).toBe(true);
    expect(JSON.stringify(sealed)).not.toContain('sk_live');
    expect(openConfig(sealed, 'PaymentProvider')).toEqual(config);
    expect(() => openConfig(sealed, 'PayoutProvider')).toThrow();
    expect(sealConfig(sealed, 'PaymentProvider')).toBe(sealed);
    expect(sealConfig(Prisma.JsonNull, 'PaymentProvider')).toBe(Prisma.JsonNull);
    expect(openConfig({ apiKey: 'plain' }, 'PaymentProvider')).toEqual({ apiKey: 'plain' });
  });

  it('keeps credentials sealed on disk and plain for every reader', async () => {
    await prisma.paymentProvider.deleteMany({ where: { code: CODE } });
    const created = await prisma.paymentProvider.create({
      data: { code: CODE, name: 'Seal test', supportedModes: ['PAYMENT'], config },
    });
    expect(created.config).toEqual(config);

    const onDisk = await raw('payment_providers', CODE);
    expect(isSealedConfig(onDisk)).toBe(true);
    expect(JSON.stringify(onDisk)).not.toContain('sk_live');

    expect((await prisma.paymentProvider.findUnique({ where: { code: CODE } }))?.config).toEqual(
      config,
    );
    expect(
      (await prisma.paymentProvider.findMany({ where: { code: CODE } })).map((p) => p.config),
    ).toEqual([config]);

    const next = { ...config, secretKey: 'sk_live_rotated9999' };
    await prisma.paymentProvider.update({ where: { code: CODE }, data: { config: next } });
    expect(JSON.stringify(await raw('payment_providers', CODE))).not.toContain('rotated');
    expect(
      (await prisma.$transaction((tx) => tx.paymentProvider.findUnique({ where: { code: CODE } })))
        ?.config,
    ).toEqual(next);
  });

  it('seals configs stored bare before sealing, once', async () => {
    await prisma.paymentProvider.deleteMany({ where: { code: CODE } });
    await prisma.payoutProvider.deleteMany({ where: { code: PAYOUT } });
    await prisma.$executeRawUnsafe(
      `INSERT INTO "billing"."payment_providers" (id, code, name, supported_modes, config, updated_at)
       VALUES (gen_random_uuid(), '${CODE}', 'Legacy', '{PAYMENT}', '${JSON.stringify(config)}'::jsonb, now())`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "billing"."payout_providers" (id, code, name, config, updated_at)
       VALUES (gen_random_uuid(), '${PAYOUT}', 'Legacy payout', '${JSON.stringify(config)}'::jsonb, now())`,
    );
    // Bare, it still reads.
    expect((await prisma.paymentProvider.findUnique({ where: { code: CODE } }))?.config).toEqual(
      config,
    );

    expect(await sealLegacyConfigs(prisma)).toBeGreaterThanOrEqual(2);
    expect(await sealLegacyConfigs(prisma)).toBe(0);

    expect(isSealedConfig(await raw('payment_providers', CODE))).toBe(true);
    expect(isSealedConfig(await raw('payout_providers', PAYOUT))).toBe(true);
    expect((await prisma.payoutProvider.findUnique({ where: { code: PAYOUT } }))?.config).toEqual(
      config,
    );
  });
});
