import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as request from 'supertest';
import * as jwt from 'jsonwebtoken';
import { TestAppModule } from './test-app.module';
import { PrismaService } from '../src/common/services/prisma.service';
import { cleanupTestData } from './helpers/cleanup.helper';
import { PaymentOrchestratorService } from '../src/payment-orchestrator/payment-orchestrator.service';
import { CheckoutService } from '../src/checkout/checkout.service';
import { serviceApiAudience } from '../src/service-api/service-token.guard';

/**
 * The open product, against Postgres: inite.education sells every generated
 * course through one product, `education-open`, at the amount and title it
 * names per checkout, instead of a billing product per course. What could go
 * wrong is the service asking for more than the product allows: an amount out
 * of bounds, another service's product, an entitlement outside its own
 * namespace, more volume than its day, or an amount a rail cannot take.
 */
describe('Open product (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orchestrator: PaymentOrchestratorService;
  let audience: string;
  const SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
  const USER = 'did:key:z6MkOpenBuyer1';
  const CLIENT = 'inite-education-billing';
  let serviceId: string;
  let n = 0;

  const token = (claims: Record<string, unknown> = {}) =>
    jwt.sign({ sub: CLIENT, client_id: CLIENT, scope: 'billing:checkout', ...claims }, SECRET, {
      algorithm: 'HS256',
      expiresIn: '5m',
      audience,
    });
  const api = () => request(app.getHttpServer());
  const urls = { successUrl: 'http://localhost:3000/ok', errorUrl: 'http://localhost:3000/err' };
  const line = (o: Record<string, unknown> = {}) => ({
    productCode: 'education-open',
    amount: '2.00',
    currency: 'USD',
    title: 'AI for beginners',
    ref: 'ai-basics',
    quantity: 1,
    ...o,
  });
  const open = (l: Record<string, unknown> = line(), key = `k-${++n}`, extra = {}) =>
    api()
      .post('/v1/service-checkout/sessions')
      .set('Authorization', `Bearer ${token()}`)
      .set('idempotency-key', key)
      .send({ userId: USER, lines: [l], ...urls, ...extra });

  const pay = async (orderId: string) => {
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const intent = await prisma.paymentIntent.create({
      data: {
        orderId,
        rail: 'ONE',
        status: 'opened',
        amount: order.amount,
        currency: order.currency,
        providerIntentId: `pi-${orderId}`,
      },
    });
    await orchestrator.applyStateTransition(intent.id, 'paid');
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
    audience = serviceApiAudience(app.get(ConfigService));
    await cleanupTestData(prisma);

    serviceId = (
      await prisma.service.create({
        data: {
          code: 'education',
          name: 'inite.education',
          apiKey: 'edu-open-test-key-not-a-secret',
          authClientId: CLIENT,
          metadata: { openDailyCap: { USD: '30.00', BRL: '500' } },
        },
      })
    ).id;
    const other = await prisma.service.create({
      data: { code: 'shop', name: 'Shop', apiKey: 'shop-open-test-key-not-a-secret' },
    });
    await prisma.product.create({
      data: {
        code: 'education-open',
        name: 'Courses',
        moduleScope: 'education',
        type: 'open',
        serviceId,
        metadata: {
          open: {
            currencies: { USD: { min: '1.00', max: '25.00' }, BRL: { min: '0.50', max: '100' } },
          },
          entitlementTemplate: 'education:course:{ref}',
          itemParams: { ref: '^[a-z0-9][a-z0-9-]{0,79}$' },
        },
      },
    });
    await prisma.product.create({
      data: {
        code: 'education-bare',
        name: 'Bare',
        moduleScope: 'education',
        type: 'open',
        serviceId,
        metadata: {
          open: { currencies: { USD: { min: '1', max: '10' } } },
          entitlementTemplate: 'course:{ref}',
          itemParams: { ref: '.+' },
        },
      },
    });
    await prisma.product.create({
      data: {
        code: 'shop-open',
        name: 'Goods',
        moduleScope: 'shop',
        type: 'open',
        serviceId: other.id,
        metadata: { open: { currencies: { USD: { min: '1', max: '10' } } } },
      },
    });
    // Two rails: one with no minimum, PIX through Hodle with its R$1.00.
    await prisma.paymentProvider.createMany({
      data: [
        {
          code: 'ONE',
          name: 'ONE',
          isActive: true,
          currencies: ['USD', 'BRL'],
          supportedModes: ['PAYMENT'],
          config: {},
        },
        {
          code: 'HODLE',
          name: 'PIX',
          isActive: true,
          currencies: ['BRL'],
          supportedModes: ['PAYMENT'],
          config: {},
        },
      ] as any,
    });
  });

  afterAll(async () => {
    await cleanupTestData(prisma);
    await app.close();
  });

  it('sells within the bounds, keeps the line on the order, and grants in the namespace', async () => {
    const res = await open(line(), 'k-first', {
      metadata: { clientReference: 'edu-ord-1' },
    }).expect(201);
    expect(res.body).toMatchObject({
      amount: '2.00',
      currency: 'USD',
      entitlementKey: 'education:course:ai-basics',
    });
    expect(res.body.rails).toContain('ONE');

    const order = await prisma.order.findUniqueOrThrow({ where: { id: res.body.sessionId } });
    expect(order.amount.toFixed(2)).toBe('2.00');
    expect((order.metadata as any).open).toMatchObject({
      title: 'AI for beginners',
      ref: 'ai-basics',
      unitAmount: '2.00',
      quantity: 1,
    });
    expect((order.metadata as any).clientReference).toBe('edu-ord-1');
    expect((order.snapshot as any).productType).toBe('open');

    // The hosted page shows the title as the line.
    const session = await app.get(CheckoutService).getSession(order.id, USER);
    expect(session.items).toEqual([
      { productName: 'AI for beginners', quantity: 1, lineAmount: '2.00' },
    ]);

    await pay(order.id);
    const granted = await prisma.entitlement.findMany({ where: { userId: USER } });
    expect(granted.map((e) => e.key)).toEqual(['education:course:ai-basics']);

    const got = await api()
      .get(`/v1/service-checkout/sessions/${order.id}`)
      .set('Authorization', `Bearer ${token()}`)
      .expect(200);
    expect(got.body).toMatchObject({ status: 'paid', ref: 'ai-basics', title: 'AI for beginners' });

    const audit = await prisma.openSaleAudit.findFirstOrThrow({ where: { orderId: order.id } });
    expect(audit).toMatchObject({
      outcome: 'opened',
      ref: 'ai-basics',
      entitlementKey: 'education:course:ai-basics',
      clientId: CLIENT,
    });
  });

  it('refuses an amount out of bounds, and says so in the audit', async () => {
    await open(line({ amount: '0.99' })).expect(400);
    await open(line({ amount: '25.01' })).expect(400);
    await open(line({ currency: 'EUR' })).expect(400);
    await open(line({ amount: 2 })).expect(400);
    const refused = await prisma.openSaleAudit.findMany({ where: { outcome: 'refused' } });
    expect(refused.length).toBeGreaterThanOrEqual(3);
    expect(refused.some((r) => /between 1.00 and 25.00/.test(r.reason ?? ''))).toBe(true);
  });

  it("refuses another service's open product as unknown", async () => {
    await open(line({ productCode: 'shop-open' })).expect(404);
  });

  it('refuses an entitlement outside the service namespace, and a bad ref or title', async () => {
    await open(line({ productCode: 'education-bare' })).expect(400);
    await open(line({ ref: '../admin' })).expect(400);
    await open(line({ ref: 'Has:Colon' })).expect(400);
    await open(line({ title: '‮' })).expect(400);
    // Access is bought once.
    await open(line({ quantity: 2 })).expect(400);
  });

  it('leaves out a rail whose minimum the amount misses, and refuses when none is left', async () => {
    // R$0.80: above the product's R$0.50 floor, below PIX's R$1.00.
    const res = await open(line({ currency: 'BRL', amount: '0.80' })).expect(201);
    expect(res.body.rails).toEqual(['ONE']);
    const session = await app.get(CheckoutService).getSession(res.body.sessionId, USER);
    expect(session.paymentMethods.map((m: any) => m.code)).not.toContain('HODLE');
    await expect(
      app.get(CheckoutService).paySession(res.body.sessionId, USER, { rail: 'HODLE' }),
    ).rejects.toThrow(/does not take 0.80 BRL/);

    // With the only other rail off, nothing takes it: refused before an order exists.
    await prisma.paymentProvider.update({ where: { code: 'ONE' }, data: { isActive: false } });
    try {
      await open(line({ currency: 'BRL', amount: '0.80' })).expect(422);
      // At R$1.00 PIX takes it.
      const pix = await open(line({ currency: 'BRL', amount: '1.00' })).expect(201);
      expect(pix.body.rails).toEqual(['HODLE']);
    } finally {
      await prisma.paymentProvider.update({ where: { code: 'ONE' }, data: { isActive: true } });
    }
  });

  it('holds the service to its daily cap, and sells nothing in a currency with none', async () => {
    // 2.00 paid above; 30.00 a day: 25 + 2 fits, a further 5 does not once paying starts.
    const big = await open(line({ amount: '25.00', ref: 'big-course' })).expect(201);
    await pay(big.body.sessionId);
    await open(line({ amount: '5.00', ref: 'another' })).expect(400);
    await prisma.service.update({ where: { id: serviceId }, data: { metadata: {} } });
    try {
      await open(line({ ref: 'no-cap' })).expect(400);
    } finally {
      await prisma.service.update({
        where: { id: serviceId },
        data: { metadata: { openDailyCap: { USD: '30.00', BRL: '500' } } },
      });
    }
  });

  it('answers the same idempotency key with the same session', async () => {
    const a = await open(line({ ref: 'same-course' }), 'same-key').expect(201);
    const b = await open(line({ ref: 'same-course' }), 'same-key').expect(201);
    expect(b.body.sessionId).toBe(a.body.sessionId);
    const audits = await prisma.openSaleAudit.count({
      where: { ref: 'same-course', outcome: 'opened' },
    });
    expect(audits).toBe(1);
  });

  it('never sells the anchor price by its code, alone or in a cart', async () => {
    const code = 'education-open-open-usd';
    await api()
      .post('/v1/service-checkout/sessions')
      .set('Authorization', `Bearer ${token()}`)
      .set('idempotency-key', `k-${++n}`)
      .send({ userId: USER, priceCode: code, ...urls })
      .expect(404);
    await api()
      .post('/v1/service-checkout/sessions')
      .set('Authorization', `Bearer ${token()}`)
      .set('idempotency-key', `k-${++n}`)
      .send({ userId: USER, lines: [{ priceCode: code, quantity: 1 }], ...urls })
      .expect(404);
  });

  it('keeps an open line on its own and an amount off catalogue lines', async () => {
    await api()
      .post('/v1/service-checkout/sessions')
      .set('Authorization', `Bearer ${token()}`)
      .set('idempotency-key', `k-${++n}`)
      .send({ userId: USER, lines: [line(), line({ ref: 'second' })], ...urls })
      .expect(400);
    await api()
      .post('/v1/service-checkout/sessions')
      .set('Authorization', `Bearer ${token()}`)
      .set('idempotency-key', `k-${++n}`)
      .send({
        userId: USER,
        lines: [{ priceCode: 'education-open-open-usd', quantity: 1, amount: '0.01' }],
        ...urls,
      })
      .expect(400);
  });
});
