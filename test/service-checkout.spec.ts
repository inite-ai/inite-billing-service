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
 * The service API's checkout, against Postgres: a service (Break3) acting
 * with an INITE Auth client_credentials token, selling one price or a cart
 * of its own prices. The provider's confirmation is the only simulated step.
 */
describe('Service checkout (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orchestrator: PaymentOrchestratorService;
  let audience: string;
  const SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
  const USER = 'did:key:z6MkCartBuyer1';
  const CLIENT = 'break3-backend';
  let serviceId: string;
  let n = 0;

  const token = (claims: Record<string, unknown> = {}, opts: jwt.SignOptions = {}) =>
    jwt.sign({ sub: CLIENT, client_id: CLIENT, scope: 'billing:checkout', ...claims }, SECRET, {
      algorithm: 'HS256',
      expiresIn: '5m',
      audience,
      ...opts,
    });
  const api = () => request(app.getHttpServer());
  const auth = (r: request.Test, t = token()) =>
    r.set('Authorization', `Bearer ${t}`).set('idempotency-key', `k-${++n}`);
  const urls = { successUrl: 'http://localhost:3000/ok', errorUrl: 'http://localhost:3000/err' };
  const cart = (lines: unknown, extra: Record<string, unknown> = {}) =>
    auth(api().post('/v1/service-checkout/sessions')).send({
      userId: USER,
      lines,
      ...urls,
      ...extra,
    });

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

  const product = async (code: string, amount: number, extra: Record<string, unknown> = {}) => {
    const p = await prisma.product.create({
      data: {
        code,
        name: code,
        moduleScope: 'break3',
        type: 'one_time',
        serviceId,
        ...extra,
      },
    });
    await prisma.price.create({
      data: { productId: p.id, code: `${code}-usd`, currency: 'USD', amount },
    });
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
          code: 'break3',
          name: 'Break3',
          apiKey: 'b3-cart-test-key-not-a-secret',
          authClientId: CLIENT,
        },
      })
    ).id;
    const other = await prisma.service.create({
      data: { code: 'other', name: 'Other', apiKey: 'other-cart-key-not-a-secret' },
    });
    await product('b3-omega', 19);
    await product('b3-magnesium', 12.5);
    await product('b3-pass', 9, { metadata: { entitlements: ['break3:pass'] } });
    const foreign = await prisma.product.create({
      data: {
        code: 'other-thing',
        name: 'Other',
        moduleScope: 'x',
        type: 'one_time',
        serviceId: other.id,
      },
    });
    await prisma.price.create({
      data: { productId: foreign.id, code: 'other-thing-usd', currency: 'USD', amount: 5 },
    });
  });

  afterAll(async () => {
    await cleanupTestData(prisma);
    await app.close();
  });

  it('takes only a checkout-scoped service token', async () => {
    const lines = [{ priceCode: 'b3-omega-usd', quantity: 1 }];
    await api()
      .post('/v1/service-checkout/sessions')
      .send({ userId: USER, lines, ...urls })
      .expect(401);
    await auth(api().post('/v1/service-checkout/sessions'), token({ scope: 'billing:commitments' }))
      .send({ userId: USER, lines, ...urls })
      .expect(403);
    await auth(api().post('/v1/service-checkout/sessions'), token({ sub: 'did:key:z6Mkperson' }))
      .send({ userId: USER, lines, ...urls })
      .expect(401);
    await auth(
      api().post('/v1/service-checkout/sessions'),
      token({}, { audience: 'https://billing.inite.ai/mcp' }),
    )
      .send({ userId: USER, lines, ...urls })
      .expect(401);
    await auth(api().post('/v1/service-checkout/sessions'), token({ client_id: 'ghost' }))
      .send({ userId: USER, lines, ...urls })
      .expect(401);
    // A static API key is not accepted on the service API.
    await api()
      .post('/v1/service-checkout/sessions')
      .set('x-api-key', 'b3-cart-test-key-not-a-secret')
      .set('idempotency-key', 'k-static')
      .send({ userId: USER, lines, ...urls })
      .expect(401);
  });

  it('prices a cart from the catalogue and pays it as one order', async () => {
    const res = await cart(
      [
        { priceCode: 'b3-omega-usd', quantity: 2 },
        { priceCode: 'b3-magnesium-usd', quantity: 3 },
      ],
      { metadata: { clientReference: 'break3:order:abc' } },
    ).expect(201);
    expect(res.body).toMatchObject({ amount: '75.50', currency: 'USD' });
    expect(res.body.checkoutUrl).toContain(res.body.sessionId);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: res.body.sessionId } });
    expect(order.amount.toFixed(2)).toBe('75.50');
    expect((order.metadata as any).clientReference).toBe('break3:order:abc');
    expect((order.snapshot as any).cart).toHaveLength(2);

    // The hosted page lists the lines.
    const session = await app.get(CheckoutService).getSession(order.id, USER);
    expect(session.items).toEqual([
      { productName: 'b3-omega', quantity: 2, lineAmount: '38.00' },
      { productName: 'b3-magnesium', quantity: 3, lineAmount: '37.50' },
    ]);

    await pay(order.id);
    const got = await auth(api().get(`/v1/service-checkout/sessions/${order.id}`)).expect(200);
    expect(got.body).toMatchObject({ status: 'paid', amount: '75.50' });
    const event = await prisma.outboxEvent.findFirst({
      where: { eventType: 'billing.payment.succeeded', serviceId },
      orderBy: { createdAt: 'desc' },
    });
    expect(event?.payload).toMatchObject({ order_id: order.id, amount: '75.5', currency: 'USD' });
  });

  it('answers the same idempotency key with the same session', async () => {
    const body = { userId: USER, lines: [{ priceCode: 'b3-omega-usd', quantity: 1 }], ...urls };
    const a = await api()
      .post('/v1/service-checkout/sessions')
      .set('Authorization', `Bearer ${token()}`)
      .set('idempotency-key', 'same-key')
      .send(body)
      .expect(201);
    const b = await api()
      .post('/v1/service-checkout/sessions')
      .set('Authorization', `Bearer ${token()}`)
      .set('idempotency-key', 'same-key')
      .send(body)
      .expect(201);
    expect(b.body.sessionId).toBe(a.body.sessionId);
  });

  it('refuses what a cart cannot hold', async () => {
    await cart([{ priceCode: 'other-thing-usd', quantity: 1 }]).expect(404);
    await cart([{ priceCode: 'b3-pass-usd', quantity: 1 }]).expect(400);
    await cart([{ priceCode: 'b3-omega-usd', quantity: 0 }]).expect(400);
    await cart([{ priceCode: 'b3-omega-usd', quantity: 100 }]).expect(400);
    await cart([
      { priceCode: 'b3-omega-usd', quantity: 1 },
      { priceCode: 'b3-omega-usd', quantity: 1 },
    ]).expect(400);
    await cart([]).expect(400);
    // Either a price or a cart, not both.
    await cart([{ priceCode: 'b3-omega-usd', quantity: 1 }], { priceCode: 'b3-omega-usd' }).expect(
      400,
    );
    // An amount is never the caller's to name.
    await cart([{ priceCode: 'b3-omega-usd', quantity: 1 }], { amount: '0.01' }).expect(400);
  });

  it("takes the service's own guest ids, never another service's", async () => {
    const lines = [{ priceCode: 'b3-omega-usd', quantity: 1 }];
    await cart(lines, { userId: 'break3:0f3c2a9be1d84c55' }).expect(201);
    await cart(lines, { userId: 'mikefluff:0f3c2a9be1d84c55' }).expect(400);
  });

  it('refuses a promo code on a cart', async () => {
    const res = await cart([{ priceCode: 'b3-omega-usd', quantity: 2 }]).expect(201);
    await expect(
      app
        .get(CheckoutService)
        .paySession(res.body.sessionId, USER, { rail: 'ONE', promoCode: 'X' }),
    ).rejects.toThrow(/does not apply to a cart/);
  });

  it('still sells one price', async () => {
    const res = await auth(api().post('/v1/service-checkout/sessions'))
      .send({ userId: USER, priceCode: 'b3-magnesium-usd', ...urls })
      .expect(201);
    const got = await auth(api().get(`/v1/service-checkout/sessions/${res.body.sessionId}`)).expect(
      200,
    );
    expect(got.body).toMatchObject({ status: 'created', amount: '12.50' });
  });
});
