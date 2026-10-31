import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as request from 'supertest';
import * as jwt from 'jsonwebtoken';
import { TestAppModule } from './test-app.module';
import { PrismaService } from '../src/common/services/prisma.service';
import { cleanupTestData } from './helpers/cleanup.helper';
import { PaymentOrchestratorService } from '../src/payment-orchestrator/payment-orchestrator.service';
import { serviceApiAudience } from '../src/service-api/service-token.guard';

/**
 * Subscriptions on the service-token lane, against Postgres: a service signed
 * in with an INITE Auth token sells a plan, starts a no-card trial, and moves
 * a subscriber between plans (upgrade paid now, downgrade at period end).
 * The provider's confirmation is the only simulated step.
 */
describe('Service subscriptions (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orchestrator: PaymentOrchestratorService;
  let audience: string;
  const SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
  const USER = 'did:key:z6MkPlanBuyer1';
  const CLIENT = 'studio-backend';
  let serviceId: string;
  let n = 0;

  const token = () =>
    jwt.sign({ sub: CLIENT, client_id: CLIENT, scope: 'billing:checkout' }, SECRET, {
      algorithm: 'HS256',
      expiresIn: '5m',
      audience,
    });
  const api = () => request(app.getHttpServer());
  const auth = (r: request.Test) =>
    r.set('Authorization', `Bearer ${token()}`).set('idempotency-key', `sub-k-${++n}`);
  const urls = { successUrl: 'http://localhost:3000/ok', errorUrl: 'http://localhost:3000/err' };

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

  const plan = async (tier: string, monthly: number, trialDays = 0) => {
    const product = await prisma.product.create({
      data: {
        code: `studio-it-${tier}`,
        name: `Studio ${tier}`,
        moduleScope: 'studio',
        type: 'subscription',
        serviceId,
        metadata: { entitlements: [`studio:plan:${tier}`] },
      },
    });
    await prisma.price.create({
      data: {
        productId: product.id,
        code: `studio-it-${tier}-monthly`,
        currency: 'USD',
        amount: monthly,
        interval: 'month',
        trialDays,
        graceDays: 3,
      },
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
          code: 'studio-it',
          name: 'Studio',
          apiKey: 'studio-it-test-key-not-a-secret',
          authClientId: CLIENT,
        },
      })
    ).id;
    await plan('starter', 15);
    await plan('pro', 39);
    await plan('team', 99, 14);
  });

  afterAll(async () => {
    await cleanupTestData(prisma);
    await app.close();
  });

  it('sells a plan as a subscription and says so to the service', async () => {
    const res = await auth(api().post('/v1/service-checkout/sessions'))
      .send({ userId: USER, priceCode: 'studio-it-starter-monthly', mode: 'SUBSCRIPTION', ...urls })
      .expect(201);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: res.body.sessionId } });
    expect(order.mode).toBe('SUBSCRIPTION');
    await pay(order.id);

    const sub = await prisma.subscription.findFirstOrThrow({ where: { userId: USER } });
    expect(sub.status).toBe('active');
    const created = await prisma.outboxEvent.findFirst({
      where: { eventType: 'billing.subscription.created', serviceId },
    });
    expect(created?.payload).toMatchObject({ subscription_id: sub.id });

    const list = await api()
      .get(`/v1/service-subscriptions?userId=${encodeURIComponent(USER)}`)
      .set('Authorization', `Bearer ${token()}`)
      .expect(200);
    expect(list.body.map((s: any) => s.id)).toContain(sub.id);
  });

  it('refuses a cart as a subscription', async () => {
    await auth(api().post('/v1/service-checkout/sessions'))
      .send({
        userId: USER,
        lines: [{ priceCode: 'studio-it-starter-monthly', quantity: 1 }],
        mode: 'SUBSCRIPTION',
        ...urls,
      })
      .expect(400);
  });

  it('charges an upgrade’s prorated difference, then moves the plan', async () => {
    const sub = await prisma.subscription.findFirstOrThrow({ where: { userId: USER } });
    const res = await api()
      .post(`/v1/service-subscriptions/${sub.id}/change`)
      .set('Authorization', `Bearer ${token()}`)
      .send({ priceCode: 'studio-it-pro-monthly' })
      .expect(200);
    expect(res.body.status).toBe('payment_required');
    // Bought moments ago: nearly the whole difference.
    expect(Number(res.body.amount)).toBeGreaterThan(23.9);
    expect(Number(res.body.amount)).toBeLessThanOrEqual(24);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: res.body.sessionId } });
    expect(order.mode).toBe('PAYMENT');
    await pay(order.id);

    const moved = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(moved.currentPeriodEnd.getTime()).toBe(sub.currentPeriodEnd.getTime());
    const proPrice = await prisma.price.findUniqueOrThrow({
      where: { code: 'studio-it-pro-monthly' },
    });
    expect(moved.priceId).toBe(proPrice.id);
    const keys = await prisma.entitlement.findMany({
      where: { userId: USER, status: 'active', source: 'subscription' },
    });
    expect(keys.map((k) => k.key)).toEqual(['studio:plan:pro']);
  });

  it('schedules a downgrade for the period end', async () => {
    const sub = await prisma.subscription.findFirstOrThrow({ where: { userId: USER } });
    const res = await api()
      .post(`/v1/service-subscriptions/${sub.id}/change`)
      .set('Authorization', `Bearer ${token()}`)
      .send({ priceCode: 'studio-it-starter-monthly' })
      .expect(200);
    expect(res.body).toMatchObject({ status: 'scheduled' });
    const after = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(after.pendingPriceId).not.toBeNull();
    expect(after.priceId).toBe(sub.priceId);
  });

  it('starts a no-card trial for the service’s own plan', async () => {
    const res = await api()
      .post('/v1/service-subscriptions/trial')
      .set('Authorization', `Bearer ${token()}`)
      .send({ userId: 'did:key:z6MkTrialist1', priceCode: 'studio-it-team-monthly' })
      .expect(201);
    expect(res.body.status).toBe('trialing');
  });
});
