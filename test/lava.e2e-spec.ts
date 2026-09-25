import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { TestAppModule } from './test-app.module';
import { PrismaService } from '../src/common/services/prisma.service';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { JwtOrServiceGuard } from '../src/auth/guards/jwt-or-service.guard';
import { MockJwtAuthGuard, MockJwtOrServiceGuard } from './mocks/auth.mock';
import { cleanupTestData } from './helpers/cleanup.helper';
import { ProviderStatusScheduler } from '../src/workers/provider-status.scheduler';

/**
 * A lava.top sale with no webhook at all, against a real database: checkout
 * opens the invoice, the customer comes back, and the order is settled by
 * asking lava.top. Only lava.top's API is faked, in the shapes its published
 * spec gives.
 */
describe('lava.top without a webhook (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const realFetch = global.fetch;
  const lava = { status: 'NEW', created: [] as any[] };

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    (global as any).fetch = jest.fn(async (url: string, init: any = {}) => {
      const reply = (body: unknown, status = 200) => ({
        ok: status < 400,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
      });
      if (url.endsWith('/api/v3/invoice') && init.method === 'POST') {
        lava.created.push(JSON.parse(init.body));
        return reply(
          {
            id: `7ea82675-4ded-4133-95a7-${String(lava.created.length).padStart(12, '0')}`,
            status: 'new',
            paymentUrl: 'https://app.lava.top/pay/x',
          },
          201,
        );
      }
      if (url.includes('/api/v2/invoices/')) {
        return reply({
          id: url.split('/').pop(),
          type: 'INVOICE',
          status: lava.status,
          receipt: { amount: 1490, currency: 'RUB', fee: 74.5 },
        });
      }
      return reply({}, 404);
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(MockJwtAuthGuard)
      .overrideGuard(JwtOrServiceGuard)
      .useClass(MockJwtOrServiceGuard)
      .compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.paymentProvider.deleteMany({});
    await prisma.paymentProvider.create({
      data: {
        code: 'LAVA',
        name: 'Lava.top',
        isActive: true,
        supportedModes: ['PAYMENT', 'SUBSCRIPTION'],
        currencies: ['RUB', 'USD', 'EUR'],
        config: { apiKey: 'lava-key', defaultOfferId: '836b9fc5-7ae9-4a27-9642-592bc44072b7' },
      },
    });
    const product = await prisma.product.create({
      data: {
        code: 'lava-e2e',
        name: 'Lava E2E',
        moduleScope: 'test',
        type: 'one_time',
        isActive: true,
      },
    });
    await prisma.price.create({
      data: {
        productId: product.id,
        code: 'lava-e2e-rub',
        currency: 'RUB',
        amount: 1490,
        isActive: true,
      },
    });
  });

  afterAll(async () => {
    (global as any).fetch = realFetch;
    await cleanupTestData(prisma);
    await app.close();
    await prisma.$disconnect();
    await new Promise((r) => setTimeout(r, 200));
  });

  const openSession = async () => {
    const res = await http()
      .post('/v1/checkout/sessions')
      .send({ priceCode: 'lava-e2e-rub', mode: 'PAYMENT' })
      .expect(201);
    return res.body.sessionId as string;
  };

  it('offers card and СБП, and opens the invoice with the buyer’s email and a way back', async () => {
    lava.status = 'NEW';
    const session = await openSession();
    const offered = (
      await http().get(`/v1/checkout/sessions/${session}`).expect(200)
    ).body.paymentMethods.find((m: any) => m.code === 'LAVA');
    expect(offered.options.map((o: any) => o.id)).toEqual(['CARD', 'SBP']);

    const paid = await http()
      .post(`/v1/checkout/sessions/${session}/pay`)
      .send({ rail: 'LAVA', method: 'SBP' })
      .expect(200);
    expect(paid.body.checkoutUrl).toBe('https://app.lava.top/pay/x');

    const sent = lava.created.at(-1);
    expect(sent).toMatchObject({
      email: 'test@example.com',
      offerId: '836b9fc5-7ae9-4a27-9642-592bc44072b7',
      amount: 1490,
      currency: 'RUB',
      paymentProvider: 'PAY2ME',
      paymentMethod: 'SBP',
    });
    expect(sent.successful_return_url).toMatch(new RegExp(`/checkout/${session}\\?returned=1$`));

    // Until it is paid, the session says so rather than "expired".
    const waiting = (await http().post(`/v1/checkout/sessions/${session}/refresh`).expect(200))
      .body;
    expect(waiting.status).toBe('created');
    expect(waiting.pending).toMatchObject({
      rail: 'LAVA',
      checkoutUrl: 'https://app.lava.top/pay/x',
    });

    // lava.top completes it; the customer comes back and the page asks.
    lava.status = 'COMPLETED';
    const done = (await http().post(`/v1/checkout/sessions/${session}/refresh`).expect(200)).body;
    expect(done.status).toBe('paid');
    expect(await prisma.invoice.count({ where: { orderId: session } })).toBe(1);
  });

  it('settles it in the background too, for a customer who never came back', async () => {
    lava.status = 'NEW';
    const session = await openSession();
    await http()
      .post(`/v1/checkout/sessions/${session}/pay`)
      .send({ rail: 'LAVA', method: 'CARD' })
      .expect(200);

    lava.status = 'COMPLETED';
    const report = await app.get(ProviderStatusScheduler).poll();
    expect(report.settled).toBeGreaterThanOrEqual(1);
    expect((await prisma.order.findUnique({ where: { id: session } }))?.status).toBe('paid');
  });
});
