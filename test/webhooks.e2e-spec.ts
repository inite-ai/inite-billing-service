import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { createHmac } from 'crypto';
import { TestAppModule } from './test-app.module';
import { PrismaService } from '../src/common/services/prisma.service';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { MockJwtAuthGuard } from './mocks/auth.mock';
import { MockOneAdapter } from './mocks/one-adapter.mock';
import { cleanupTestData } from './helpers/cleanup.helper';

describe('Webhooks E2E Tests', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mockOneAdapter: MockOneAdapter;
  let userId: string;
  let _orderId: string;
  let _paymentIntentId: string;
  let providerIntentId: string;

  const ONE_API_SECRET = 'one-test-api-secret';
  const CRYPTO_WEBHOOK_SECRET = 'crypto-test-webhook-secret';

  /** Sign a payload the way the ONE rail expects (HMAC over the exact bytes sent). */
  const signOne = (payload: unknown) =>
    createHmac('sha256', ONE_API_SECRET).update(JSON.stringify(payload)).digest('hex');

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(MockJwtAuthGuard)
      .compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
    prisma = app.get<PrismaService>(PrismaService);
    mockOneAdapter = app.get<MockOneAdapter>(MockOneAdapter);

    userId = MockJwtAuthGuard.testUserId;

    // Webhook verification is fail-closed and keyed on the provider's stored
    // config, so both rails need an active provider row to accept anything.
    await prisma.paymentProvider.upsert({
      where: { code: 'ONE' },
      update: { isActive: true, config: { apiSecret: ONE_API_SECRET } },
      create: {
        code: 'ONE',
        name: 'ONE (test)',
        isActive: true,
        supportedModes: ['PAYMENT'],
        config: { apiSecret: ONE_API_SECRET },
      },
    });

    await prisma.paymentProvider.upsert({
      where: { code: 'CRYPTO' },
      update: { isActive: true, config: { webhookSecret: CRYPTO_WEBHOOK_SECRET } },
      create: {
        code: 'CRYPTO',
        name: 'Crypto (test)',
        isActive: true,
        supportedModes: ['PAYMENT'],
        config: { webhookSecret: CRYPTO_WEBHOOK_SECRET },
      },
    });
  });

  afterAll(async () => {
    await cleanupTestData(prisma);
    await app.close();
    await prisma.$disconnect();
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  beforeEach(async () => {
    mockOneAdapter.clearMocks();

    // Create test order and payment intent
    const product = await prisma.product.create({
      data: {
        code: `test-product-webhook-${Date.now()}-${Math.random()}`,
        name: 'Test Product',
        moduleScope: 'test',
        type: 'one_time',
        isActive: true,
      },
    });

    const price = await prisma.price.create({
      data: {
        productId: product.id,
        code: `test-price-webhook-${Date.now()}-${Math.random()}`,
        currency: 'USD',
        amount: 100.0,
        isActive: true,
      },
    });

    const order = await prisma.order.create({
      data: {
        userId,
        priceId: price.id,
        mode: 'PAYMENT',
        status: 'created',
        amount: 100.0,
        currency: 'USD',
        externalId: `order_${Date.now()}`,
      },
    });
    _orderId = order.id;

    const intentResult = await mockOneAdapter.createPaymentIntent({
      orderId: order.externalId!,
      amount: 100,
      currency: 'USD',
      mode: 'PAYMENT',
    });
    providerIntentId = intentResult.providerIntentId;

    const intent = await prisma.paymentIntent.create({
      data: {
        orderId: order.id,
        rail: 'ONE',
        status: 'created',
        providerIntentId: intentResult.providerIntentId,
        amount: 100.0,
        currency: 'USD',
      },
    });
    _paymentIntentId = intent.id;
  });

  afterEach(async () => {});

  describe('POST /webhooks/one', () => {
    it('should store webhook event idempotently', async () => {
      const webhookPayload = {
        id: 'webhook-123',
        event_type: 'payment.order.updated',
        entity_id: providerIntentId,
        status: 'CLOSED',
      };

      // First webhook
      const response1 = await request(app.getHttpServer())
        .post('/webhooks/one')
        .set('x-signature', signOne(webhookPayload))
        .send(webhookPayload)
        .expect(200);

      expect(response1.body.received).toBe(true);

      // Duplicate webhook (same webhook_id)
      const response2 = await request(app.getHttpServer())
        .post('/webhooks/one')
        .set('x-signature', signOne(webhookPayload))
        .send(webhookPayload)
        .expect(200);

      expect(response2.body.received).toBe(true);

      // Verify only one webhook event stored
      const events = await prisma.webhookEvent.findMany({
        where: {
          rail: 'ONE',
          webhookId: 'webhook-123',
        },
      });

      expect(events.length).toBe(1);
    });

    it('should parse webhook and store correctly', async () => {
      const webhookPayload = {
        id: 'webhook-456',
        event_type: 'payment.order.updated',
        entity_id: providerIntentId,
        status: 'OPENED',
      };

      await request(app.getHttpServer())
        .post('/webhooks/one')
        .set('x-signature', signOne(webhookPayload))
        .send(webhookPayload)
        .expect(200);

      const event = await prisma.webhookEvent.findUnique({
        where: {
          rail_webhookId: {
            rail: 'ONE',
            webhookId: 'webhook-456',
          },
        },
      });

      expect(event).toBeDefined();
      expect(event?.eventType).toBe('payment.order.updated');
      expect(event?.entityId).toBe(providerIntentId);
      expect(event?.status).toBe('received');
    });
  });

  describe('POST /webhooks/crypto', () => {
    it('records a transfer that matches no invoice as unmatched, not as a payment', async () => {
      // Shape reported by the chain indexer. No open invoice asks for this
      // amount, so it is kept for an admin rather than settling anything.
      const webhookPayload = {
        chain: 'SOL',
        txHash: 'tx-confirmed-1234567890abcdef',
        from: 'SenderWallet111111111111111111111111111111',
        to: '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1',
        token: 'USDC',
        // A decimal is token units; a bare integer would be smallest units.
        amount: '100.0',
        confirmations: 3,
        memo: 'crypto-invoice-123',
      };

      const response = await request(app.getHttpServer())
        .post('/webhooks/crypto')
        .set('x-webhook-secret', CRYPTO_WEBHOOK_SECRET)
        .send(webhookPayload)
        .expect(200);

      expect(response.body.received).toBe(true);

      const event = await prisma.webhookEvent.findUnique({
        where: {
          rail_webhookId: {
            rail: 'CRYPTO',
            webhookId: `crypto_SOL_${webhookPayload.txHash}_unmatched`,
          },
        },
      });
      expect(event?.eventType).toBe('crypto.transfer.unmatched');

      const transfer = await prisma.cryptoTransfer.findFirst({
        where: { txHash: webhookPayload.txHash },
      });
      expect(transfer).toMatchObject({
        status: 'unmatched',
        amountRaw: '100000000',
        isFinal: true,
      });
    });

    it('should reject an unsigned crypto webhook', async () => {
      await request(app.getHttpServer())
        .post('/webhooks/crypto')
        .send({ chain: 'SOL', txHash: 'tx-unsigned-1', confirmations: 3 })
        .expect(403);
    });

    it('reports a matched transfer as confirming, then as paid once it is final', async () => {
      // ETH needs 12 confirmations. An open invoice asks for exactly 100.000137.
      const receiver = '0x2222222222222222222222222222222222222222';
      await prisma.cryptoInvoice.create({
        data: {
          invoiceId: 'crypto_ETH_webhook_e2e',
          chain: 'ETH',
          token: 'USDC',
          receiverAddress: receiver,
          receiverKey: receiver,
          baseAmountRaw: '100000000',
          amountRaw: '100000137',
          decimals: 6,
          expiresAt: new Date(Date.now() + 3600_000),
        },
      });
      const report = (confirmations: number) =>
        request(app.getHttpServer())
          .post('/webhooks/crypto')
          .set('x-webhook-secret', CRYPTO_WEBHOOK_SECRET)
          .send({
            chain: 'ETH',
            txHash: '0xnot-yet-final',
            to: receiver,
            token: 'USDC',
            amount: '100.000137',
            confirmations,
          })
          .expect(200);
      const eventFor = (phase: string) =>
        prisma.webhookEvent.findUnique({
          where: {
            rail_webhookId: { rail: 'CRYPTO', webhookId: `crypto_ETH_0xnot-yet-final_${phase}` },
          },
        });

      await report(2);
      expect((await eventFor('seen'))?.eventType).toBe('payment.confirming');
      expect((await eventFor('seen'))?.entityId).toBe('crypto_ETH_webhook_e2e');

      // The same transaction, now final, is a new event — not a duplicate of
      // the first sighting to be dropped, which is how orders used to stay
      // open forever.
      await report(12);
      expect((await eventFor('final'))?.eventType).toBe('payment.paid');
      const invoice = await prisma.cryptoInvoice.findUnique({
        where: { invoiceId: 'crypto_ETH_webhook_e2e' },
      });
      expect(invoice).toMatchObject({ status: 'paid', confirmations: 12 });
    });
  });
});
