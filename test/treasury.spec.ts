import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { getAddress } from 'viem';
import { TestAppModule } from './test-app.module';
import { PrismaService } from '../src/common/services/prisma.service';
import { cleanupTestData } from './helpers/cleanup.helper';
import { TreasuryService } from '../src/wallet/treasury.service';

/**
 * Card top-ups: an order for $N on billing's checkout; once paid, N USDC from
 * INITE's treasury. The treasury's root key is used for setup and never
 * stored; the stored signer may sign only USDC transfers up to the cap.
 */
describe('Treasury and card top-ups', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let treasury: TreasuryService;
  const realFetch = global.fetch;
  const calls: { path: string; body: any; stamp: any }[] = [];
  const WALLET = getAddress('0x1111111111111111111111111111111111111111');
  const TREASURY = getAddress('0x2222222222222222222222222222222222222222');

  beforeAll(async () => {
    (global as any).fetch = jest.fn(async (input: string | URL, init?: any) => {
      const url = new URL(String(input));
      const body = JSON.parse(init.body);
      const stamp = JSON.parse(
        Buffer.from(init.headers['X-Stamp'] ?? '', 'base64url').toString() || '{}',
      );
      calls.push({ path: url.pathname, body, stamp });
      const done = (result: unknown) =>
        new Response(
          JSON.stringify({ activity: { status: 'ACTIVITY_STATUS_COMPLETED', result } }),
          { status: 200 },
        );
      if (url.pathname.endsWith('/create_sub_organization'))
        return done({
          createSubOrganizationResultV8: {
            subOrganizationId: 'treasury-sub',
            wallet: { walletId: 'w', addresses: [TREASURY] },
          },
        });
      if (url.pathname.endsWith('/create_users'))
        return done({ createUsersResult: { userIds: ['signer-1'] } });
      return done({ createPolicyResult: { policyId: 'p' } });
    });
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    treasury = app.get(TreasuryService);
    await cleanupTestData(prisma);
    await prisma.treasuryPayout.deleteMany({});
    await prisma.treasury.deleteMany({});
    await prisma.paymentProvider.deleteMany({});
    await prisma.paymentProvider.create({
      data: {
        code: 'CRYPTO',
        name: 'Crypto',
        isActive: true,
        config: { x402: { organizationId: 'org' } },
      } as any,
    });
    const keys = await import('../src/adapters/crypto/x402/relayer-key');
    await new keys.RelayerKeys(prisma).rotate();
    await prisma.wallet.create({
      data: {
        ownerDid: 'did:web:auth-api.inite.ai:agents:dcr_aa',
        subOrganizationId: 's',
        turnkeyWalletId: 'w',
        address: WALLET,
        ownerKey: '02ab',
      },
    });
  });

  afterAll(async () => {
    (global as any).fetch = realFetch;
    await prisma.treasuryPayout.deleteMany({});
    await prisma.treasury.deleteMany({});
    await cleanupTestData(prisma);
    await prisma.paymentProvider.deleteMany({});
    await app.close();
    await prisma.$disconnect();
  });

  it('offers no card top-up before the treasury exists', async () => {
    const shown = await request(app.getHttpServer()).get(`/v1/public/fund/${WALLET}`).expect(200);
    expect(shown.body.card).toEqual([]);
    await request(app.getHttpServer())
      .post(`/v1/public/fund/${WALLET}/card`)
      .send({ amount: '25' })
      .expect(503);
  });

  it('sets up the treasury: root key used once and not kept, signer capped by policy', async () => {
    const status = await treasury.setUp();
    expect(status.treasury).toMatchObject({
      address: TREASURY,
      perTransfer: '500',
      dailyLimit: '500',
    });
    const root = calls.find((c) => c.path.endsWith('/create_sub_organization'))!.body.parameters
      .rootUsers[0].apiKeys[0].publicKey;
    const row = await prisma.treasury.findFirstOrThrow();
    expect(row.signerPublicKey).not.toBe(root);
    // Users and policy were made by the root key, in the treasury's sub-organization.
    for (const c of calls.filter((x) => /create_(users|policy)$/.test(x.path))) {
      expect(c.stamp.publicKey).toBe(root);
      expect(c.body.organizationId).toBe('treasury-sub');
    }
    const policy = calls.find((c) => c.path.endsWith('/create_policy'))!.body.parameters;
    expect(policy.consensus).toContain("user.id == 'signer-1'");
    expect(policy.condition).toContain("eth.eip_712.primary_type == 'TransferWithAuthorization'");
    expect(policy.condition).toContain("eth.eip_712.message['value'] <= 500000000");
    // Nothing anywhere holds the root's private half.
    expect(JSON.stringify(row)).not.toContain(root);
  });

  it('opens a card order for $N for the wallet', async () => {
    const shown = await request(app.getHttpServer()).get(`/v1/public/fund/${WALLET}`).expect(200);
    expect(shown.body.card).toEqual(['10', '25', '50', '100']);
    await request(app.getHttpServer())
      .post(`/v1/public/fund/${WALLET}/card`)
      .send({ amount: '7' })
      .expect(400);
    const res = await request(app.getHttpServer())
      .post(`/v1/public/fund/${WALLET}/card`)
      .send({ amount: '25' })
      .expect(201);
    expect(res.body.checkoutUrl).toContain('/checkout/');
    const order = await prisma.order.findUniqueOrThrow({ where: { id: res.body.sessionId } });
    expect(Number(order.amount)).toBe(25);
    expect((order.metadata as any).walletTopup).toEqual({ address: WALLET });
  });

  it('holds a payout that would pass the daily limit', async () => {
    const t = await prisma.treasury.findFirstOrThrow();
    await prisma.treasury.update({ where: { id: t.id }, data: { dailyLimit: '20' } });
    const res = await request(app.getHttpServer())
      .post(`/v1/public/fund/${WALLET}/card`)
      .send({ amount: '25' })
      .expect(201);
    await prisma.order.update({ where: { id: res.body.sessionId }, data: { status: 'paid' } });
    await treasury.payOut();
    const payout = await prisma.treasuryPayout.findUniqueOrThrow({
      where: { orderId: res.body.sessionId },
    });
    expect(payout.status).toBe('held');
    expect(calls.some((c) => c.path.endsWith('/sign_raw_payload'))).toBe(false);
  });
});
