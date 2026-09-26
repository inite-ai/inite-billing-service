import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { TestAppModule } from './test-app.module';
import { PrismaService } from '../src/common/services/prisma.service';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { JwtOrServiceGuard } from '../src/auth/guards/jwt-or-service.guard';
import { MockJwtAuthGuard, MockJwtOrServiceGuard } from './mocks/auth.mock';
import { cleanupTestData } from './helpers/cleanup.helper';
import { WebhookProcessor } from '../src/workers/webhook.processor';
import { CryptoAdapter } from '../src/adapters/crypto/crypto.adapter';
import { CHAINS } from '../src/adapters/crypto/chains';

/**
 * A crypto payment end to end, against a real database: the admin sets the
 * wallets, a customer opens an invoice at checkout, the watcher sees the
 * transfer on the chain's API, and the ordinary webhook processor settles the
 * order. Only the chain APIs are faked — the partial unique index that keeps
 * invoice amounts apart, the ledger and the state machine are the real ones.
 */
describe('Crypto payments E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adapter: CryptoAdapter;
  const realFetch = global.fetch;

  const TRON_WALLET = 'TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G';
  const TON_WALLET = 'EQDwB8YlfqX_bYO4cGGSkIJYUcgqlij6fhuEwEAhLAppLbEV';
  const TON_WALLET_RAW = '0:F007C6257EA5FF6D83B870619290825851C82A9628FA7E1B84C040212C0A692D';
  const TON_USDT_RAW = '0:B113A994B5024A16719F69139328EB759596C38A25F59028B146FECDC3621DFE';

  /** What each fake chain API currently reports. */
  const chain = { tron: [] as any[], ton: [] as any[] };

  const asUser = () => {
    MockJwtAuthGuard.testUserRoles = ['user'];
  };
  const asAdmin = () => {
    MockJwtAuthGuard.testUserRoles = ['admin'];
  };
  const http = () => request(app.getHttpServer());

  const newSession = async (priceCode = 'crypto-e2e-usd') => {
    asUser();
    const res = await http()
      .post('/v1/checkout/sessions')
      .send({ priceCode, mode: 'PAYMENT' })
      .expect(201);
    return res.body.sessionId as string;
  };

  const pay = (sessionId: string, body: Record<string, unknown>) => {
    asUser();
    return http()
      .post(`/v1/checkout/sessions/${sessionId}/pay`)
      .send({ rail: 'CRYPTO', ...body });
  };

  const poll = async () => {
    asAdmin();
    const res = await http().post('/v1/admin/crypto/poll').expect(201);
    return res.body;
  };

  /** Run every stored crypto event through the processor, then wait for the order to settle. */
  const settle = async (orderId: string, status: string) => {
    const processor = app.get(WebhookProcessor);
    const events = await prisma.webhookEvent.findMany({ where: { rail: 'CRYPTO' } });
    for (const event of events) {
      await processor.process({ data: { rail: 'CRYPTO', webhookId: event.webhookId } } as any);
    }
    for (let i = 0; i < 50; i++) {
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      if (order?.status === status) return order;
      await new Promise((r) => setTimeout(r, 100));
    }
    return prisma.order.findUnique({ where: { id: orderId } });
  };

  beforeAll(async () => {
    (global as any).fetch = jest.fn(async (url: string) => {
      const host = new URL(url).host;
      const body = host.includes('trongrid')
        ? { success: true, data: chain.tron }
        : host.includes('toncenter')
          ? { jetton_transfers: chain.ton }
          : host.includes('er-api')
            ? {
                result: 'success',
                time_last_update_unix: Math.floor(Date.now() / 1000),
                rates: { USD: 1, RUB: 90, EUR: 0.9 },
              }
            : {};
      return { ok: true, status: 200, json: async () => body };
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
    adapter = app.get(CryptoAdapter);

    await prisma.paymentProvider.deleteMany({});
    const product = await prisma.product.create({
      data: {
        code: 'crypto-e2e',
        name: 'Crypto E2E',
        moduleScope: 'test',
        type: 'one_time',
        isActive: true,
      },
    });
    await prisma.price.create({
      data: {
        productId: product.id,
        code: 'crypto-e2e-usd',
        currency: 'USD',
        amount: 100,
        isActive: true,
      },
    });
    await prisma.price.create({
      data: {
        productId: product.id,
        code: 'crypto-e2e-rub',
        currency: 'RUB',
        amount: 9000,
        isActive: true,
      },
    });
    await prisma.price.create({
      data: {
        productId: product.id,
        code: 'crypto-e2e-zzz',
        currency: 'ZZZ',
        amount: 10,
        isActive: true,
      },
    });
  });

  afterEach(() => {
    chain.tron = [];
    chain.ton = [];
  });

  afterAll(async () => {
    (global as any).fetch = realFetch;
    MockJwtAuthGuard.testUserRoles = ['user'];
    await cleanupTestData(prisma);
    await app.close();
    await prisma.$disconnect();
    await new Promise((r) => setTimeout(r, 200));
  });

  describe('settings', () => {
    it('refuses a wallet that is not an address on its network', async () => {
      asAdmin();
      const res = await http()
        .put('/v1/admin/crypto/settings')
        .send({ wallets: { TRON: 'TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32H' } });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('not a valid TRON address');
    });

    it('refuses to turn the rail on with nothing to watch', async () => {
      asAdmin();
      const res = await http().put('/v1/admin/crypto/settings').send({ isActive: true });
      expect(res.status).toBe(400);
    });

    it('saves wallets and says which networks can take payments', async () => {
      asAdmin();
      const res = await http()
        .put('/v1/admin/crypto/settings')
        .send({
          isActive: true,
          wallets: { TRON: TRON_WALLET, TON: TON_WALLET, ETH: null },
          trongridApiKey: 'trongrid-secret-key',
        })
        .expect(200);

      const byChain = Object.fromEntries(res.body.chains.map((c: any) => [c.chain, c]));
      expect(byChain.TRON).toMatchObject({ wallet: TRON_WALLET, walletValid: true, payable: true });
      expect(byChain.TON.payable).toBe(true);
      expect(byChain.ETH.payable).toBe(false);
      expect(res.body.provider.isActive).toBe(true);
      // The key comes back as a fingerprint, never whole.
      expect(res.body.secrets.trongridApiKey).toBe('••••-key');
      expect(JSON.stringify(res.body)).not.toContain('trongrid-secret-key');
    });
  });

  describe('EVM networks', () => {
    it('opens every EVM network from one 0x wallet, and rejects a malformed one', async () => {
      asAdmin();
      await http()
        .put('/v1/admin/crypto/settings')
        .send({ wallets: { EVM: '0x12345' } })
        .expect(400);
      const res = await http()
        .put('/v1/admin/crypto/settings')
        .send({ wallets: { EVM: '0x1111111111111111111111111111111111111111' } })
        .expect(200);
      const evm = res.body.chains.filter((c: any) => c.evm);
      expect(evm.map((c: any) => c.chain)).toEqual([
        'ETH',
        'BSC',
        'POLYGON',
        'ARBITRUM',
        'OPTIMISM',
        'BASE',
        'AVAX',
      ]);
      expect(evm.every((c: any) => c.payable)).toBe(true);

      const session = await newSession();
      const crypto = (
        await http().get(`/v1/checkout/sessions/${session}`).expect(200)
      ).body.paymentMethods.find((m: any) => m.code === 'CRYPTO');
      expect(crypto.options.map((o: any) => o.id)).toEqual(
        expect.arrayContaining(['BSC_USDT', 'BASE_USDC', 'ARBITRUM_USDT']),
      );

      // Back to TRON/TON only, as the rest of this suite expects.
      asAdmin();
      await http()
        .put('/v1/admin/crypto/settings')
        .send({ wallets: { EVM: null } })
        .expect(200);
    });
  });

  describe('checkout', () => {
    it('offers crypto with its networks for a dollar price', async () => {
      const usd = await newSession();
      const usdSession = await http().get(`/v1/checkout/sessions/${usd}`).expect(200);
      const crypto = usdSession.body.paymentMethods.find((m: any) => m.code === 'CRYPTO');
      expect(crypto.options.map((o: any) => o.id).sort()).toEqual(['TON_USDT', 'TRON_USDT']);
    });

    it('converts a rouble price at the current rate plus the markup, and fixes the rate on the invoice', async () => {
      asAdmin();
      await http().put('/v1/admin/crypto/settings').send({ fxMarkupPercent: 2 }).expect(200);

      const rub = await newSession('crypto-e2e-rub');
      const rubSession = await http().get(`/v1/checkout/sessions/${rub}`).expect(200);
      expect(rubSession.body.paymentMethods.find((m: any) => m.code === 'CRYPTO')).toBeDefined();

      // 9 000 ₽ at 90 ₽/$ is $100; plus 2% is $102.
      const paid = await pay(rub, { cryptoChain: 'TRON', cryptoToken: 'USDT' }).expect(200);
      expect(paid.body.payment).toMatchObject({
        baseAmount: '102',
        price: { amount: '9000', currency: 'RUB' },
        fx: { perUsd: '90', source: 'open.er-api.com', markupPercent: 2 },
      });
      expect(Number(paid.body.payment.amount)).toBeGreaterThan(102);
      expect(Number(paid.body.payment.amount)).toBeLessThan(102.01);

      // The admin page shows the rate a rouble price will be charged at.
      asAdmin();
      const settings = await http().get('/v1/admin/crypto/settings').expect(200);
      expect(settings.body.fx.rates.find((r: any) => r.currency === 'RUB')).toMatchObject({
        perUsd: '90',
        available: true,
      });
      await http().put('/v1/admin/crypto/settings').send({ fxMarkupPercent: 0 }).expect(200);
    });

    it('charges at an admin’s pinned rate instead of the source', async () => {
      asAdmin();
      await http()
        .put('/v1/admin/crypto/settings')
        .send({ fixedRates: { RUB: '100' } })
        .expect(200);
      const rub = await newSession('crypto-e2e-rub');
      const paid = await pay(rub, { cryptoChain: 'TON', cryptoToken: 'USDT' }).expect(200);
      expect(paid.body.payment).toMatchObject({
        baseAmount: '90',
        fx: { perUsd: '100', source: 'fixed' },
      });

      asAdmin();
      await http()
        .put('/v1/admin/crypto/settings')
        .send({ fixedRates: { RUB: null } })
        .expect(200);
      await http()
        .put('/v1/admin/crypto/settings')
        .send({ fixedRates: { USD: '1' } })
        .expect(400);
      await http()
        .put('/v1/admin/crypto/settings')
        .send({ fixedRates: { RUB: '-3' } })
        .expect(400);
    });

    it('does not offer crypto for a currency it has no rate for', async () => {
      const session = await newSession('crypto-e2e-zzz');
      const body = (await http().get(`/v1/checkout/sessions/${session}`).expect(200)).body;
      expect(body.paymentMethods.find((m: any) => m.code === 'CRYPTO')).toBeUndefined();

      const refused = await pay(session, { cryptoChain: 'TRON', cryptoToken: 'USDT' });
      expect(refused.status).toBe(400);
      expect(refused.body.message).toContain('no current exchange rate');
    });

    it('needs a network to be chosen', async () => {
      const session = await newSession();
      expect((await pay(session, {})).status).toBe(400);
    });

    it('opens an invoice for a unique amount just above the price, and hands the same one back on retry', async () => {
      const session = await newSession();
      const first = await pay(session, { cryptoChain: 'TRON', cryptoToken: 'USDT' }).expect(200);

      expect(first.body.payment).toMatchObject({
        type: 'crypto',
        chain: 'TRON',
        network: 'TRC-20',
        token: 'USDT',
        address: TRON_WALLET,
        baseAmount: '100',
        invoiceStatus: 'awaiting',
      });
      const amount = Number(first.body.payment.amount);
      expect(amount).toBeGreaterThan(100);
      expect(amount).toBeLessThan(100.01);

      const again = await pay(session, { cryptoChain: 'TRON', cryptoToken: 'USDT' }).expect(200);
      expect(again.body.paymentIntentId).toBe(first.body.paymentIntentId);
      expect(again.body.payment.amount).toBe(first.body.payment.amount);

      // And the session shows it again after a reload.
      const reloaded = await http().get(`/v1/checkout/sessions/${session}`).expect(200);
      expect(reloaded.body.payment).toMatchObject({
        amount: first.body.payment.amount,
        rail: 'CRYPTO',
      });
    });

    it('replaces the invoice when the customer switches network, and gives the old amount back', async () => {
      const session = await newSession();
      const tron = await pay(session, { cryptoChain: 'TRON', cryptoToken: 'USDT' }).expect(200);
      const ton = await pay(session, { cryptoChain: 'TON', cryptoToken: 'USDT' }).expect(200);

      expect(ton.body.paymentIntentId).not.toBe(tron.body.paymentIntentId);
      expect(ton.body.payment.address).toBe(TON_WALLET);

      const oldIntent = await prisma.paymentIntent.findUnique({
        where: { id: tron.body.paymentIntentId },
      });
      expect(oldIntent?.status).toBe('expired');
      const oldInvoice = await prisma.cryptoInvoice.findUnique({
        where: { invoiceId: oldIntent!.providerIntentId! },
      });
      expect(oldInvoice?.status).toBe('cancelled');
      // The order itself is untouched: still being paid for.
      expect((await prisma.order.findUnique({ where: { id: session } }))?.status).toBe('created');
    });

    it('never gives two open invoices the same amount', async () => {
      const usdt = CHAINS.TRON.tokens.USDT!;
      const invoices = await Promise.all(
        Array.from({ length: 40 }, (_, i) =>
          adapter.ledger.reserve({
            invoiceId: `crypto_TRON_unique_${i}`,
            chain: 'TRON',
            token: 'USDT',
            receiverAddress: TRON_WALLET,
            baseAmountRaw: '5000000',
            decimals: usdt.decimals,
            expiresAt: new Date(Date.now() + 3600_000),
          }),
        ),
      );
      expect(new Set(invoices.map((i) => i.amountRaw)).size).toBe(40);
      await prisma.cryptoInvoice.deleteMany({
        where: { invoiceId: { startsWith: 'crypto_TRON_unique_' } },
      });
    });

    it('and the database holds that line even if the application does not', async () => {
      const base = {
        chain: 'TRON',
        token: 'USDT',
        receiverAddress: TRON_WALLET,
        receiverKey: TRON_WALLET,
        baseAmountRaw: '7000000',
        amountRaw: '7000001',
        decimals: 6,
        expiresAt: new Date(Date.now() + 3600_000),
      };
      await prisma.cryptoInvoice.create({ data: { ...base, invoiceId: 'crypto_TRON_dup_a' } });
      await expect(
        prisma.cryptoInvoice.create({ data: { ...base, invoiceId: 'crypto_TRON_dup_b' } }),
      ).rejects.toMatchObject({ code: 'P2002' });
      await prisma.cryptoInvoice.deleteMany({
        where: { invoiceId: { startsWith: 'crypto_TRON_dup_' } },
      });
    });
  });

  describe('settlement', () => {
    it('settles the order when the watcher sees the exact amount arrive', async () => {
      const session = await newSession();
      const paid = await pay(session, { cryptoChain: 'TON', cryptoToken: 'USDT' }).expect(200);

      chain.ton = [
        {
          source: '0:4C532D64E6BFB75203BD796AB4731572DC17C9E14694EFEEACBBD5E402B77567',
          destination: TON_WALLET_RAW,
          amount: paid.body.payment.amountRaw,
          jetton_master: TON_USDT_RAW,
          transaction_hash: Buffer.from(`ton-tx-${session}`).toString('base64'),
          transaction_now: Math.floor(Date.now() / 1000),
          transaction_aborted: false,
        },
      ];
      const report = await poll();
      expect(report.chains.find((c: any) => c.chain === 'TON')).toMatchObject({
        lastError: null,
        watching: true,
      });

      const order = await settle(session, 'paid');
      expect(order?.status).toBe('paid');
      const intent = await prisma.paymentIntent.findUnique({
        where: { id: paid.body.paymentIntentId },
      });
      expect(intent?.status).toBe('paid');
      // The invoice details survive settlement on the snapshot.
      expect((intent?.snapshot as any).receiverAddress).toBe(TON_WALLET);
      const invoice = await prisma.cryptoInvoice.findUnique({
        where: { invoiceId: intent!.providerIntentId! },
      });
      expect(invoice).toMatchObject({ status: 'paid' });
      expect(await prisma.invoice.count({ where: { orderId: session } })).toBe(1);

      // The next poll sees the same transfer again and changes nothing.
      await poll();
      expect(await prisma.cryptoTransfer.count({ where: { chain: 'TON' } })).toBe(1);
    });

    it('keeps money that matches no open invoice for an admin, with its likely invoice, and settles on assignment', async () => {
      const session = await newSession();
      const paid = await pay(session, { cryptoChain: 'TRON', cryptoToken: 'USDT' }).expect(200);

      // The customer sent the round price, not the amount on screen.
      chain.tron = [
        {
          transaction_id: `round-${session}`,
          token_info: { address: CHAINS.TRON.tokens.USDT!.contractAddress, decimals: 6 },
          block_timestamp: Date.now(),
          from: 'TCustomerWallet',
          to: TRON_WALLET,
          type: 'Transfer',
          value: '100000000',
        },
      ];
      await poll();

      asAdmin();
      const listed = await http().get('/v1/admin/crypto/transfers').expect(200);
      const transfer = listed.body.find((t: any) => t.txHash === `round-${session}`);
      expect(transfer).toMatchObject({ status: 'unmatched', amount: '100' });
      expect(transfer.suggestion).toBeTruthy();
      // Nothing was settled on its own.
      expect((await prisma.order.findUnique({ where: { id: session } }))?.status).toBe('created');

      const invoice = await prisma.cryptoInvoice.findFirst({
        where: {
          invoiceId: (await prisma.paymentIntent.findUnique({
            where: { id: paid.body.paymentIntentId },
          }))!.providerIntentId!,
        },
      });
      expect(transfer.suggestion.id).toBe(invoice!.id);

      const assigned = await http()
        .post(`/v1/admin/crypto/transfers/${transfer.id}/assign`)
        .send({ invoiceId: invoice!.id, note: 'Sent the round price; checked on tronscan' })
        .expect(201);
      expect(assigned.body.paymentStatus).toBe('paid');
      expect((await prisma.order.findUnique({ where: { id: session } }))?.status).toBe('paid');

      // And it cannot be assigned twice.
      await http()
        .post(`/v1/admin/crypto/transfers/${transfer.id}/assign`)
        .send({ invoiceId: invoice!.id })
        .expect(409);
    });

    it('sets aside a transfer only with a reason', async () => {
      chain.tron = [
        {
          transaction_id: 'stray-transfer',
          token_info: { address: CHAINS.TRON.tokens.USDT!.contractAddress, decimals: 6 },
          block_timestamp: Date.now(),
          to: TRON_WALLET,
          type: 'Transfer',
          value: '1234567',
        },
      ];
      // Only chains with an open invoice are polled, so give TRON one.
      const session = await newSession();
      await pay(session, { cryptoChain: 'TRON', cryptoToken: 'USDT' }).expect(200);
      await poll();

      const stray = await prisma.cryptoTransfer.findFirst({ where: { txHash: 'stray-transfer' } });
      expect(stray?.status).toBe('unmatched');
      asAdmin();
      await http()
        .post(`/v1/admin/crypto/transfers/${stray!.id}/ignore`)
        .send({ note: ' ' })
        .expect(400);
      await http()
        .post(`/v1/admin/crypto/transfers/${stray!.id}/ignore`)
        .send({ note: 'Test transfer from our own wallet' })
        .expect(201);
      expect((await prisma.cryptoTransfer.findUnique({ where: { id: stray!.id } }))?.status).toBe(
        'ignored',
      );
    });

    it('expires an invoice nobody paid once its grace period is over, and the order with it', async () => {
      const session = await newSession();
      const paid = await pay(session, { cryptoChain: 'TRON', cryptoToken: 'USDT' }).expect(200);
      const intent = await prisma.paymentIntent.findUnique({
        where: { id: paid.body.paymentIntentId },
      });
      await prisma.cryptoInvoice.update({
        where: { invoiceId: intent!.providerIntentId! },
        data: { expiresAt: new Date(Date.now() - 48 * 3600_000) },
      });

      await poll();

      const invoice = await prisma.cryptoInvoice.findUnique({
        where: { invoiceId: intent!.providerIntentId! },
      });
      expect(invoice?.status).toBe('expired');
      expect((await prisma.paymentIntent.findUnique({ where: { id: intent!.id } }))?.status).toBe(
        'expired',
      );
      expect((await prisma.order.findUnique({ where: { id: session } }))?.status).toBe('expired');
    });
  });
});
