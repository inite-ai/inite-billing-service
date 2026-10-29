import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as request from 'supertest';
import * as jwt from 'jsonwebtoken';
import { Decimal } from '@prisma/client/runtime/library';
import { TestAppModule } from './test-app.module';
import { PrismaService } from '../src/common/services/prisma.service';
import { cleanupTestData } from './helpers/cleanup.helper';
import { PaymentOrchestratorService } from '../src/payment-orchestrator/payment-orchestrator.service';
import { serviceApiAudience } from '../src/service-api/service-token.guard';
import { CommitmentScheduler } from '../src/commitments/commitment-scheduler.service';
import { TreasuryService } from '../src/wallet/treasury.service';

/**
 * Commitments end to end against Postgres: a product with a stake policy, a
 * service that acts with an INITE Auth service token, a stake paid (the
 * provider's confirmation is simulated here, as the only place it may be),
 * held, and every way it can end. Each test checks the ledger balances.
 *
 * docs/commitments.md is the spec.
 */
describe('Commitments (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orchestrator: PaymentOrchestratorService;
  let scheduler: CommitmentScheduler;
  let audience: string;
  const SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
  const USER = 'did:key:z6MkStakeOwner1';
  const OTHER = 'did:key:z6MkStakeOwner2';
  const CLIENT = 'break3-backend';
  let serviceId: string;
  let n = 0;

  const token = (claims: Record<string, unknown> = {}, opts: jwt.SignOptions = {}) =>
    jwt.sign(
      { sub: CLIENT, client_id: CLIENT, scope: 'billing:commitments billing:checkout', ...claims },
      SECRET,
      { algorithm: 'HS256', expiresIn: '5m', audience, ...opts },
    );
  const api = () => request(app.getHttpServer());
  const auth = (r: request.Test, t = token()) =>
    r.set('Authorization', `Bearer ${t}`).set('idempotency-key', `k-${++n}`);
  const endsIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

  const create = (body: Record<string, unknown> = {}) =>
    auth(api().post('/v1/commitments')).send({
      userId: USER,
      externalRef: `break3:challenge:${++n}`,
      productCode: 'break3-stake',
      tier: '10',
      charityCode: 'givedirectly',
      endsAt: endsIn(14),
      verification: { referee: false, proof: false },
      successUrl: 'http://localhost:3000/ok',
      errorUrl: 'http://localhost:3000/err',
      ...body,
    });

  /** The provider says the order is paid: the only simulated step. */
  const pay = async (orderId: string, rail = 'ONE') => {
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const intent = await prisma.paymentIntent.create({
      data: {
        orderId,
        rail,
        status: 'opened',
        amount: order.amount,
        currency: order.currency,
        providerIntentId: `pi-${orderId}`,
      },
    });
    await orchestrator.applyStateTransition(intent.id, 'paid');
  };

  const balanceOf = async (account: string, commitmentId?: string) => {
    const rows = await prisma.commitmentLedgerEntry.findMany({
      where: { account, ...(commitmentId ? { commitmentId } : {}) },
    });
    return rows.reduce((s, r) => s.plus(r.credit).minus(r.debit), new Decimal(0)).toFixed(2);
  };

  const expectBalanced = async () => {
    const rows = await prisma.commitmentLedgerEntry.findMany();
    const d = rows.reduce((s, r) => s.plus(r.debit), new Decimal(0));
    const c = rows.reduce((s, r) => s.plus(r.credit), new Decimal(0));
    expect(d.toFixed(4)).toBe(c.toFixed(4));
    // `held` equals the stakes currently held or disputed.
    const holding = await prisma.commitment.findMany({
      where: { status: { in: ['held', 'disputed'] } },
    });
    const heldSum = holding.reduce((s, r) => s.plus(r.stakeAmount), new Decimal(0));
    expect(await balanceOf('held')).toBe(heldSum.toFixed(2));
  };

  const held = async (body: Record<string, unknown> = {}) => {
    const res = await create(body).expect(201);
    await pay(res.body.sessionId);
    return res.body.commitment.id as string;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    orchestrator = app.get(PaymentOrchestratorService);
    scheduler = app.get(CommitmentScheduler);
    audience = serviceApiAudience(app.get(ConfigService));
    await cleanupTestData(prisma);
    await prisma.treasuryPayout.deleteMany({});
    await prisma.treasury.deleteMany({});

    const service = await prisma.service.create({
      data: {
        code: 'break3',
        name: 'Break3',
        apiKey: 'b3-test-key-not-a-secret',
        authClientId: CLIENT,
      },
    });
    serviceId = service.id;
    await prisma.service.create({
      data: {
        code: 'other',
        name: 'Other',
        apiKey: 'other-test-key-not-a-secret',
        authClientId: 'other-client',
      },
    });
    await prisma.product.create({
      data: {
        code: 'break3-stake',
        name: 'Break3 stake',
        moduleScope: 'break3',
        type: 'one_time',
        serviceId,
        metadata: {
          commitment: {
            tiers: ['5', '10', '25', '50', '100'],
            feePct: '0',
            creditsBonusPct: '10',
            creditsPerUsd: 100,
            maxActivePerUser: '300',
            verificationAbove: '25',
            autoReleaseDays: 7,
            cancelWindowHours: 24,
          },
        },
      },
    });
    await prisma.charity.create({
      data: { code: 'givedirectly', name: 'GiveDirectly', url: 'https://www.givedirectly.org' },
    });
    // Admin route, exercised directly: the price sync from the policy.
    const { CommitmentCatalogService } =
      await import('../src/commitments/commitment-catalog.service');
    await app.get(CommitmentCatalogService).sync('break3-stake');
  });

  afterAll(async () => {
    await cleanupTestData(prisma);
    await prisma.treasuryPayout.deleteMany({});
    await prisma.treasury.deleteMany({});
    await app.close();
  });

  describe('the service token', () => {
    it('refuses no token, a person token, the wrong scope, audience or client', async () => {
      await api().get('/v1/commitments/policy').expect(401);
      await auth(api().get('/v1/commitments/policy'), token({ sub: 'did:key:z6Mkperson' })).expect(
        401,
      );
      await auth(api().get('/v1/commitments/policy'), token({ scope: 'billing:checkout' })).expect(
        403,
      );
      await auth(
        api().get('/v1/commitments/policy'),
        token({}, { audience: 'https://billing.inite.ai/mcp' }),
      ).expect(401);
      await auth(
        api().get('/v1/commitments/policy'),
        token({ sub: 'ghost', client_id: 'ghost' }),
      ).expect(401);
      await auth(
        api().get('/v1/commitments/policy'),
        jwt.sign({ client_id: CLIENT, scope: 'billing:commitments' }, 'wrong', { audience }),
      ).expect(401);
      // A static API key is not accepted here.
      await api()
        .get('/v1/commitments/policy')
        .set('x-api-key', 'b3-test-key-not-a-secret')
        .expect(401);
    });

    it("hides another service's offer and commitments", async () => {
      const other = token({ sub: 'other-client', client_id: 'other-client' });
      await auth(api().get('/v1/commitments/quote?product=break3-stake&tier=10'), other).expect(
        404,
      );
      const id = await held();
      await auth(api().get(`/v1/commitments/${id}`), other).expect(404);
      await auth(api().post(`/v1/commitments/${id}/release`), other)
        .send({ as: 'money' })
        .expect(404);
    });
  });

  it('quotes from the catalogue policy, before payment', async () => {
    const res = await auth(api().get('/v1/commitments/quote?product=break3-stake&tier=25')).expect(
      200,
    );
    expect(res.body).toMatchObject({ stake: '25.00', fee: '0.00', total: '25.00', credits: 2750 });
    await auth(api().get('/v1/commitments/quote?product=break3-stake&tier=7')).expect(400);
  });

  it('creates, holds on payment, and announces it', async () => {
    const res = await create().expect(201);
    expect(res.body.commitment.status).toBe('pending_payment');
    expect(res.body.checkoutUrl).toContain('/checkout/');
    await pay(res.body.sessionId);
    const got = await auth(api().get(`/v1/commitments/${res.body.commitment.id}`)).expect(200);
    expect(got.body.status).toBe('held');
    const ev = await prisma.outboxEvent.findFirst({
      where: { eventType: 'billing.commitment.held', serviceId },
      orderBy: { createdAt: 'desc' },
    });
    expect((ev?.payload as any).commitment_id).toBe(res.body.commitment.id);
    // No affiliate commission on a deposit.
    expect(await prisma.affiliateCommission.count({ where: { orderId: res.body.sessionId } })).toBe(
      0,
    );
    await expectBalanced();
  });

  it('refuses above $25 without a referee or proof, an unknown charity, a bad end', async () => {
    const r1 = await create({ tier: '50' }).expect(400);
    expect(r1.body.code).toBe('verification_required');
    await create({ tier: '50', verification: { referee: true, proof: false } }).expect(201);
    expect((await create({ charityCode: 'nope' }).expect(400)).body.code).toBe('unknown_charity');
    expect((await create({ endsAt: endsIn(0.5) }).expect(400)).body.code).toBe('invalid_ends_at');
  });

  it('caps what one person has at stake at $300', async () => {
    await prisma.commitment.updateMany({ where: { userId: OTHER }, data: { status: 'void' } });
    for (let i = 0; i < 3; i++) {
      await held({ userId: OTHER, tier: '100', verification: { referee: false, proof: true } });
    }
    const r = await create({ userId: OTHER, tier: '5' }).expect(409);
    expect(r.body.code).toBe('cap_exceeded');
    const ex = await auth(api().get(`/v1/commitments/exposure?userId=${OTHER}`)).expect(200);
    expect(ex.body).toMatchObject({ active: '300.00', max: '300.00' });
  });

  it('wins with money: owed to the wallet, paid once the wallet exists', async () => {
    const id = await held();
    const r = await auth(api().post(`/v1/commitments/${id}/release`))
      .send({ as: 'money' })
      .expect(200);
    expect(r.body).toMatchObject({ status: 'released_money', releaseAs: 'money' });
    expect(r.body.payout.status).toBe('awaiting_wallet');
    expect(await balanceOf('owed_to_user', id)).toBe('10.00');
    // The same key again changes nothing.
    await request(app.getHttpServer())
      .post(`/v1/commitments/${id}/release`)
      .set('Authorization', `Bearer ${token()}`)
      .set('idempotency-key', 'same')
      .send({ as: 'money' })
      .expect(200);
    // No INITE wallet yet: nothing is sent, the money waits.
    const payOrder = jest.spyOn(app.get(TreasuryService), 'payOrderToWallet');
    await scheduler.payOwed();
    expect(payOrder).not.toHaveBeenCalled();
    // The wallet exists: the treasury pays it (its chain path has its own
    // tests, treasury-payouts.spec.ts), and the ledger books it paid once.
    const WALLET = '0x2222222222222222222222222222222222222222';
    await prisma.wallet.create({
      data: {
        ownerDid: USER,
        subOrganizationId: 'sub-stake',
        turnkeyWalletId: 'tw',
        address: WALLET,
      },
    });
    const commitment = await prisma.commitment.findUniqueOrThrow({ where: { id } });
    payOrder.mockImplementation(async (orderId) => {
      const t = await prisma.treasury.create({
        data: {
          subOrganizationId: 'tsub-stake',
          address: '0x4444444444444444444444444444444444444444',
          turnkeyUserId: 'u',
          signerPublicKey: 'pk',
          signerPrivateKey: 'not-a-key',
          perTransfer: '500',
          dailyLimit: '500',
        },
      });
      return prisma.treasuryPayout.create({
        data: { treasuryId: t.id, orderId, to: WALLET, valueRaw: '10000000', status: 'mined' },
      });
    });
    await scheduler.payOwed();
    await scheduler.payOwed();
    expect(payOrder).toHaveBeenCalledTimes(1);
    expect(payOrder).toHaveBeenCalledWith(commitment.orderId, WALLET, '10.00');
    expect(await balanceOf('paid_to_user', id)).toBe('10.00');
    expect(await balanceOf('owed_to_user', id)).toBe('0.00');
    const after = await auth(api().get(`/v1/commitments/${id}`)).expect(200);
    expect(after.body.payout.status).toBe('mined');
    payOrder.mockRestore();
    await prisma.wallet.deleteMany({ where: { ownerDid: USER } });
    await expectBalanced();
  });

  it('wins with credits: the stake plus the bonus as credits', async () => {
    const id = await held();
    const r = await auth(api().post(`/v1/commitments/${id}/release`))
      .send({ as: 'credits' })
      .expect(200);
    expect(r.body).toMatchObject({ status: 'released_credits', credits: 1100 });
    const bal = await prisma.creditBalance.findFirst({ where: { userId: USER, serviceId: null } });
    expect(bal?.balance).toBeGreaterThanOrEqual(1100);
    expect(await balanceOf('credits_issued', id)).toBe('10.00');
    await expectBalanced();
  });

  it('loses: forfeited to the charity only after the end, then batched and published', async () => {
    const id = await held();
    const early = await auth(api().post(`/v1/commitments/${id}/forfeit`))
      .send({})
      .expect(409);
    expect(early.body.code).toBe('too_early');
    await prisma.commitment.update({
      where: { id },
      data: { endsAt: new Date(Date.now() - 1000) },
    });
    const r = await auth(api().post(`/v1/commitments/${id}/forfeit`))
      .send({ reason: 'missed' })
      .expect(200);
    expect(r.body.status).toBe('forfeited');
    expect(await balanceOf('charity_payable:givedirectly', id)).toBe('10.00');

    const pub = await api().get('/v1/commitments/charities').expect(200);
    const gd = pub.body.charities.find((c: any) => c.code === 'givedirectly');
    expect(gd.totals.forfeited).toBe('10.00');
    const { CharitiesService } = await import('../src/commitments/charities.service');
    const payout = await app
      .get(CharitiesService)
      .createPayout('givedirectly', new Date(), 'did:key:admin');
    expect(payout.amount.toFixed(2)).toBe('10.00');
    await app.get(CharitiesService).markPayoutSent(payout.id, 'bank-ref-001');
    const ledger = await api().get('/v1/commitments/charities/givedirectly/ledger').expect(200);
    expect(ledger.body.charity.totals).toMatchObject({ paidOut: '10.00', owed: '0.00' });
    expect(ledger.body.payouts[0]).toMatchObject({ reference: 'bank-ref-001', status: 'sent' });
    expect(JSON.stringify(ledger.body)).not.toContain(USER);
    expect(JSON.stringify(ledger.body)).not.toContain(id);
    await expectBalanced();
  });

  it('auto-releases with no verdict 7 days after the end', async () => {
    const id = await held();
    await prisma.commitment.update({
      where: { id },
      data: { autoReleaseAt: new Date(Date.now() - 1000) },
    });
    await scheduler.autoRelease();
    const row = await prisma.commitment.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('auto_released');
    expect(row.payoutState).toBe('awaiting_wallet');
    expect(
      await prisma.outboxEvent.count({ where: { eventType: 'billing.commitment.auto_released' } }),
    ).toBeGreaterThan(0);
    await expectBalanced();
  });

  it('disputes freeze the money; only an admin settles; the backstop releases', async () => {
    const id = await held();
    const d = await auth(api().post(`/v1/commitments/${id}/dispute`))
      .send({ by: 'referee', reason: 'the photos are old' })
      .expect(200);
    expect(d.body.status).toBe('disputed');
    // The product can no longer move it.
    await prisma.commitment.update({
      where: { id },
      data: { endsAt: new Date(Date.now() - 1000) },
    });
    expect(
      (
        await auth(api().post(`/v1/commitments/${id}/forfeit`))
          .send({})
          .expect(409)
      ).body.code,
    ).toBe('invalid_state');
    // Nor does the 7-day auto-release; the 30-day backstop does.
    await prisma.commitment.update({
      where: { id },
      data: { autoReleaseAt: new Date(Date.now() - 1000) },
    });
    await scheduler.autoRelease();
    expect((await prisma.commitment.findUniqueOrThrow({ where: { id } })).status).toBe('disputed');
    await prisma.commitment.update({
      where: { id },
      data: { endsAt: new Date(Date.now() - 31 * 86_400_000) },
    });
    await scheduler.autoRelease();
    expect((await prisma.commitment.findUniqueOrThrow({ where: { id } })).status).toBe(
      'auto_released',
    );

    const id2 = await held();
    await auth(api().post(`/v1/commitments/${id2}/dispute`))
      .send({ by: 'user', reason: 'I did it' })
      .expect(200);
    const { CommitmentsService } = await import('../src/commitments/commitments.service');
    const settled = await app
      .get(CommitmentsService)
      .override(id2, 'forfeited', 'did:key:admin', 'admin:x', 'proof checked');
    expect(settled.status).toBe('forfeited');
    await expectBalanced();
  });

  it('cancels within the window, back to the wallet when the rail cannot refund', async () => {
    const id = await held();
    const r = await auth(api().post(`/v1/commitments/${id}/cancel`))
      .send({})
      .expect(200);
    expect(r.body.status).toBe('refunded_on_cancel');
    expect(await balanceOf('owed_to_user', id)).toBe('10.00');
    const late = await held();
    await prisma.commitment.update({
      where: { id: late },
      data: { heldAt: new Date(Date.now() - 25 * 3_600_000) },
    });
    expect(
      (
        await auth(api().post(`/v1/commitments/${late}/cancel`))
          .send({})
          .expect(409)
      ).body.code,
    ).toBe('cancel_window_closed');
    await expectBalanced();
  });

  it('voids an unpaid stake when its order fails', async () => {
    const res = await create().expect(201);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: res.body.sessionId } });
    const intent = await prisma.paymentIntent.create({
      data: {
        orderId: order.id,
        rail: 'ONE',
        status: 'opened',
        amount: order.amount,
        currency: 'USD',
      },
    });
    await orchestrator.applyStateTransition(intent.id, 'failed');
    const got = await auth(api().get(`/v1/commitments/${res.body.commitment.id}`)).expect(200);
    expect(got.body.status).toBe('void');
  });

  it('refuses a promo code on a stake', async () => {
    const res = await create().expect(201);
    const { CheckoutService } = await import('../src/checkout/checkout.service');
    await expect(
      app
        .get(CheckoutService)
        .paySession(res.body.sessionId, USER, { rail: 'ONE', promoCode: 'X' }),
    ).rejects.toThrow(/Promo codes do not apply/);
  });

  it('opens ordinary purchases with a checkout-scoped token only', async () => {
    const product = await prisma.product.create({
      data: {
        code: 'break3-supp-omega',
        name: 'Omega-3',
        moduleScope: 'break3',
        type: 'one_time',
        serviceId,
      },
    });
    await prisma.price.create({
      data: { productId: product.id, code: 'break3-supp-omega-usd', currency: 'USD', amount: 19 },
    });
    const body = {
      userId: USER,
      priceCode: 'break3-supp-omega-usd',
      successUrl: 'http://localhost:3000/ok',
      errorUrl: 'http://localhost:3000/err',
    };
    await auth(api().post('/v1/service-checkout/sessions'), token({ scope: 'billing:commitments' }))
      .send(body)
      .expect(403);
    const s = await auth(api().post('/v1/service-checkout/sessions')).send(body).expect(201);
    expect(s.body.checkoutUrl).toContain(s.body.sessionId);
    const got = await auth(api().get(`/v1/service-checkout/sessions/${s.body.sessionId}`)).expect(
      200,
    );
    expect(got.body).toMatchObject({ status: 'created', amount: '19.00' });
    await pay(s.body.sessionId);
    const paid = await auth(api().get(`/v1/service-checkout/sessions/${s.body.sessionId}`)).expect(
      200,
    );
    expect(paid.body.status).toBe('paid');
  });
});
