import { Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { MerchantsService } from '../src/merchants/merchants.service';
import { MerchantRailsService } from '../src/merchants/merchant-rails.service';
import { MerchantWebhooksController } from '../src/merchants/merchant-webhooks.controller';
import { openCredentials, redact, sealCredentials } from '../src/merchants/merchant-credentials';
import { StripeAdapter } from '../src/adapters/stripe/stripe.adapter';
import { LavaAdapter } from '../src/adapters/lava/lava.adapter';
import { YooKassaAdapter } from '../src/adapters/yookassa/yookassa.adapter';
import { CheckoutService } from '../src/checkout/checkout.service';
import { WebhookProcessor } from '../src/workers/webhook.processor';
import { toMoney } from '../src/common/money';

/**
 * Merchant-own payment accounts (docs/connected-accounts.md): money goes to
 * the merchant's own provider account and INITE never holds it. What must
 * never happen: a service reaching another service's merchant, a merchant's
 * sale falling back to INITE's own provider accounts, a credential showing up
 * in a response, an error or a log, a webhook taken on a wrong secret, or an
 * unverified account taking a payment.
 */

// Obvious placeholders, never real keys.
const STRIPE_KEY = 'sk_test_PLACEHOLDERplaceholder0001';
const STRIPE_WHSEC = 'whsec_PLACEHOLDERplaceholder01';
const LAVA_KEY = 'lava-api-key-placeholder-0001';
const LAVA_WHSEC = 'lava-webhook-placeholder-01';

const SERVICE = '11111111-1111-4111-8111-111111111111';
const OTHER_SERVICE = '22222222-2222-4222-8222-222222222222';
const MERCHANT = '33333333-3333-4333-8333-333333333333';
const CONNECTION = '44444444-4444-4444-8444-444444444444';
const who = { serviceId: SERVICE, actor: 'service:shop:client' };

function merchantRow(serviceId = SERVICE) {
  return {
    id: MERCHANT,
    serviceId,
    orgId: 'shop:1',
    displayName: 'Shop one',
    externalRef: null,
    platformFeeBps: 0,
    connections: [],
  };
}

function connectionRow(over: Record<string, any> = {}) {
  return {
    id: CONNECTION,
    merchantId: MERCHANT,
    rail: 'STRIPE',
    status: 'verified',
    sealedCredentials: sealCredentials(CONNECTION, {
      secretKey: STRIPE_KEY,
      webhookSecret: STRIPE_WHSEC,
    }),
    hints: { last4: '0001' },
    verifiedAt: new Date(),
    lastError: null,
    createdAt: new Date(),
    ...over,
  };
}

function prismaMock(over: Record<string, any> = {}) {
  return {
    merchant: {
      findUnique: jest.fn().mockResolvedValue(merchantRow()),
      create: jest.fn(),
      update: jest.fn(),
    },
    merchantConnection: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }) => ({ ...data, createdAt: new Date() })),
      update: jest.fn().mockImplementation(({ data }) => ({ ...connectionRow(), ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    merchantAuditLog: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    paymentProvider: {
      findUnique: jest.fn().mockResolvedValue({
        code: 'STRIPE',
        isActive: true,
        config: { secretKey: 'sk_test_INITEOWNplaceholder000001', webhookSecret: 'whsec_inite' },
      }),
      findMany: jest.fn().mockResolvedValue([{ code: 'STRIPE', currencies: [], config: {} }]),
    },
    order: { findUnique: jest.fn(), update: jest.fn() },
    ...over,
  } as any;
}

function registryWith(prisma: any) {
  const adapters: Record<string, any> = {
    STRIPE: new StripeAdapter(prisma),
    LAVA: new LavaAdapter(prisma),
    YOOKASSA: new YooKassaAdapter(prisma),
  };
  return { get: (rail: string) => adapters[rail] } as any;
}

function build(prisma = prismaMock()) {
  const rails = new MerchantRailsService(prisma, registryWith(prisma));
  const orchestrator = { applyStateTransition: jest.fn() } as any;
  const lock = {
    runWithLock: jest.fn(async (_k: string, _t: number, fn: any) => (await fn(), true)),
  } as any;
  const config = new ConfigService({ FRONTEND_URL: 'https://billing.example' });
  const service = new MerchantsService(prisma, config, rails, orchestrator, lock);
  return { prisma, rails, service, orchestrator };
}

function stripeFetch(handler: (url: string, init: any) => any) {
  return jest.spyOn(global, 'fetch').mockImplementation((async (url: any, init: any) => {
    const body = handler(String(url), init);
    return {
      ok: body.status === undefined || body.status < 400,
      status: body.status ?? 200,
      statusText: 'x',
      json: async () => body.json,
      text: async () => JSON.stringify(body.json),
    } as any;
  }) as any);
}

afterEach(() => jest.restoreAllMocks());

describe('merchant accounts: tenancy', () => {
  it("another service's merchant does not exist for this one (404)", async () => {
    const { service, prisma } = build();
    prisma.merchant.findUnique.mockResolvedValue(merchantRow(OTHER_SERVICE));
    await expect(service.get(SERVICE, MERCHANT)).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.putConnection(who, MERCHANT, 'STRIPE', { secretKey: STRIPE_KEY }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.verify(who, MERCHANT, 'STRIPE')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.disconnect(who, MERCHANT, 'STRIPE')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.refund(who, MERCHANT, '55555555-5555-4555-8555-555555555555', {}),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.merchantConnection.create).not.toHaveBeenCalled();
    expect(prisma.order.findUnique).not.toHaveBeenCalled();
  });

  it("refuses to refund an order that is not this merchant's", async () => {
    const { service, prisma } = build();
    prisma.order.findUnique.mockResolvedValue({ id: 'o', merchantId: 'someone-else' });
    await expect(
      service.refund(who, MERCHANT, '55555555-5555-4555-8555-555555555555', {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('merchant accounts: secrets', () => {
  it('seals credentials bound to the connection id, and answers with hints only', async () => {
    const { service, prisma } = build();
    const answer = await service.putConnection(who, MERCHANT, 'STRIPE', {
      secretKey: STRIPE_KEY,
      webhookSecret: STRIPE_WHSEC,
      somethingElse: 'dropped',
    });
    const stored = prisma.merchantConnection.create.mock.calls[0][0].data;
    expect(stored.sealedCredentials).toMatch(/^sealed:v1:/);
    expect(stored.sealedCredentials).not.toContain(STRIPE_KEY);
    expect(openCredentials(stored.id, stored.sealedCredentials)).toEqual({
      secretKey: STRIPE_KEY,
      webhookSecret: STRIPE_WHSEC,
    });
    // Copied onto another row, the blob does not open.
    expect(() => openCredentials(MERCHANT, stored.sealedCredentials)).toThrow();
    const text = JSON.stringify(answer) + JSON.stringify(prisma.merchantAuditLog.create.mock.calls);
    expect(text).not.toContain(STRIPE_KEY);
    expect(text).not.toContain(STRIPE_WHSEC);
    expect(answer).toMatchObject({
      rail: 'STRIPE',
      status: 'pending',
      hints: { last4: '0001', mode: 'test', keyType: 'secret' },
      webhookUrl: `https://billing.example/v1/webhooks/merchant/${stored.id}`,
    });
  });

  it('a bad credential is refused without echoing it', async () => {
    const { service } = build();
    const bad = 'sk_live_short';
    await expect(
      service.putConnection(who, MERCHANT, 'STRIPE', { secretKey: bad }),
    ).rejects.toThrow(/secretKey is not in the expected format/);
    await service
      .putConnection(who, MERCHANT, 'STRIPE', { secretKey: bad })
      .catch((e) => expect(String(e.message)).not.toContain(bad));
  });

  it('a failed verification keeps no secret in lastError, the answer or the log', async () => {
    const { service, prisma } = build();
    prisma.merchantConnection.findUnique.mockResolvedValue(connectionRow({ status: 'pending' }));
    prisma.merchantConnection.findUnique.mockResolvedValueOnce(
      connectionRow({ status: 'pending' }),
    );
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    stripeFetch(() => ({ status: 401, json: { error: { message: `Invalid key ${STRIPE_KEY}` } } }));
    await service.verify(who, MERCHANT, 'STRIPE');
    const data = prisma.merchantConnection.updateMany.mock.calls[0][0].data;
    expect(data.status).toBe('failed');
    expect(data.lastError).not.toContain(STRIPE_KEY);
    const logged = JSON.stringify([...warn.mock.calls, ...error.mock.calls]);
    expect(logged).not.toContain(STRIPE_KEY);
  });

  it('redacts our secrets and anything key-shaped', () => {
    expect(redact('bad sk_live_abcdefghijk and mine-secret-value', ['mine-secret-value'])).toBe(
      'bad [redacted] and [redacted]',
    );
  });
});

describe('merchant accounts: routing', () => {
  it('a verified Stripe connection calls Stripe with the merchant key, never reading INITE’s', async () => {
    const { rails, prisma } = build();
    prisma.merchantConnection.findUnique.mockResolvedValue(connectionRow());
    const fetch = stripeFetch(() => ({
      json: { id: 'cs_1', url: 'https://checkout.stripe.example/cs_1', payment_intent: 'pi_1' },
    }));
    const { connector } = await rails.connectorFor(MERCHANT, 'STRIPE');
    await connector.createPaymentIntent({
      orderId: 'order_1',
      amount: 10,
      currency: 'USD',
      mode: 'PAYMENT',
    });
    expect(fetch.mock.calls[0][1]!.headers).toMatchObject({
      Authorization: `Bearer ${STRIPE_KEY}`,
    });
    expect(prisma.paymentProvider.findUnique).not.toHaveBeenCalled();
  });

  it('an unverified, failed or disconnected connection is not routable', async () => {
    const { rails, prisma } = build();
    for (const status of ['pending', 'failed', 'disconnected']) {
      prisma.merchantConnection.findUnique.mockResolvedValue(connectionRow({ status }));
      await expect(rails.connectorFor(MERCHANT, 'STRIPE')).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(() => rails.bind(connectionRow({ status }))).toThrow(UnprocessableEntityException);
    }
  });

  it('offers only verified merchant rails that take the currency, never INITE providers', async () => {
    const { rails, prisma } = build();
    prisma.merchantConnection.findMany.mockResolvedValue([{ rail: 'STRIPE' }, { rail: 'LAVA' }]);
    await expect(rails.eligibleRails(MERCHANT, 'BRL', toMoney('10'))).resolves.toEqual(['STRIPE']);
    expect(prisma.merchantConnection.findMany.mock.calls[0][0].where).toEqual({
      merchantId: MERCHANT,
      status: 'verified',
    });
    expect(prisma.paymentProvider.findMany).not.toHaveBeenCalled();
  });

  it('a merchant with no verified account is refused (422) and never falls back to INITE', async () => {
    const prisma = prismaMock({
      product: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'p',
          code: 'shop-open',
          type: 'open',
          isActive: true,
          serviceId: SERVICE,
          service: { id: SERVICE, code: 'shop', metadata: {} },
          metadata: { open: { currencies: { USD: { min: '1', max: '500' } } } },
        }),
      },
    });
    const openPolicy = {
      assertWithinCap: jest.fn(),
      eligibleRails: jest.fn().mockResolvedValue(['STRIPE']),
      audit: jest.fn(),
    };
    const merchantRails = { eligibleRails: jest.fn().mockResolvedValue([]) };
    const checkout = new CheckoutService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { track: jest.fn() } as any,
      new ConfigService({}),
      undefined,
      openPolicy as any,
      merchantRails as any,
    );
    // Idempotency in memory: no Redis in a unit test.
    jest.spyOn(checkout as any, 'getRedis').mockReturnValue(null);
    await expect(
      checkout.createOpenSession(
        'shop:buyer0001',
        {
          line: {
            productCode: 'shop-open',
            amount: '10.00',
            currency: 'USD',
            title: 'Mug',
            ref: 'ord-1',
            quantity: 1,
          },
          successUrl: 'https://shop.example/ok',
          errorUrl: 'https://shop.example/err',
          merchantId: MERCHANT,
        },
        'key-1',
        { serviceId: SERVICE, serviceCode: 'shop' },
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(merchantRails.eligibleRails).toHaveBeenCalledWith(MERCHANT, 'USD', expect.anything());
    expect(openPolicy.eligibleRails).not.toHaveBeenCalled();
  });
});

describe('merchant accounts: webhooks', () => {
  function controller(prisma: any) {
    const webhooks = { storeWebhookEvent: jest.fn() };
    const rails = new MerchantRailsService(prisma, registryWith(prisma));
    return { ctl: new MerchantWebhooksController(prisma, rails, webhooks as any), webhooks };
  }

  function stripeSigned(body: string, secret: string) {
    const t = Math.floor(Date.now() / 1000);
    const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
    return `t=${t},v1=${v1}`;
  }

  const event = {
    id: 'evt_1',
    type: 'payment_intent.succeeded',
    data: { object: { id: 'pi_1' } },
  };
  const raw = JSON.stringify(event);

  it("takes a Stripe event signed with the connection's own secret, stored under the connection", async () => {
    const prisma = prismaMock();
    prisma.merchantConnection.findUnique.mockResolvedValue(connectionRow());
    const { ctl, webhooks } = controller(prisma);
    await ctl.handle(CONNECTION, event, { rawBody: Buffer.from(raw) } as any, {
      'stripe-signature': stripeSigned(raw, STRIPE_WHSEC),
    });
    expect(webhooks.storeWebhookEvent).toHaveBeenCalledWith(
      `MERCHANT:${CONNECTION}`,
      'evt_1',
      'payment.paid',
      'pi_1',
      event,
    );
  });

  it("refuses a Stripe event signed with another secret (INITE's or another merchant's)", async () => {
    const prisma = prismaMock();
    prisma.merchantConnection.findUnique.mockResolvedValue(connectionRow());
    const { ctl, webhooks } = controller(prisma);
    for (const secret of ['whsec_inite', 'whsec_OTHERMERCHANTplaceholder']) {
      await expect(
        ctl.handle(CONNECTION, event, { rawBody: Buffer.from(raw) } as any, {
          'stripe-signature': stripeSigned(raw, secret),
        }),
      ).rejects.toThrow('Invalid webhook');
    }
    expect(webhooks.storeWebhookEvent).not.toHaveBeenCalled();
  });

  it("refuses a lava.top event without the creator's own webhook key (not the API key)", async () => {
    const prisma = prismaMock();
    prisma.merchantConnection.findUnique.mockResolvedValue(
      connectionRow({
        rail: 'LAVA',
        sealedCredentials: sealCredentials(CONNECTION, {
          apiKey: LAVA_KEY,
          webhookSecret: LAVA_WHSEC,
          defaultOfferId: 'offer-0001',
        }),
      }),
    );
    const { ctl, webhooks } = controller(prisma);
    const body = { eventType: 'payment.success', contractId: 'c-1' };
    for (const key of [LAVA_KEY, 'wrong-key-placeholder']) {
      await expect(
        ctl.handle(CONNECTION, body, { rawBody: Buffer.from('{}') } as any, { 'x-api-key': key }),
      ).rejects.toThrow('Invalid webhook');
    }
    await ctl.handle(CONNECTION, body, { rawBody: Buffer.from('{}') } as any, {
      'x-api-key': LAVA_WHSEC,
    });
    expect(webhooks.storeWebhookEvent).toHaveBeenCalledTimes(1);
  });

  it('an unknown, unverified or disconnected connection takes nothing', async () => {
    const prisma = prismaMock();
    const { ctl } = controller(prisma);
    for (const row of [
      null,
      connectionRow({ status: 'pending' }),
      connectionRow({ status: 'disconnected', sealedCredentials: null }),
    ]) {
      prisma.merchantConnection.findUnique.mockResolvedValue(row);
      await expect(
        ctl.handle(CONNECTION, event, { rawBody: Buffer.from(raw) } as any, {
          'stripe-signature': stripeSigned(raw, STRIPE_WHSEC),
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    }
  });

  it("a merchant's event settles only that merchant's orders; INITE's rail never settles one", async () => {
    const prisma = prismaMock({
      webhookEvent: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
      },
      paymentIntent: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    const rails = new MerchantRailsService(prisma, registryWith(prisma));
    const inite = { getIntentStatus: jest.fn().mockResolvedValue({ status: 'paid' }) };
    const orchestrator = {
      getAdapter: jest.fn().mockReturnValue(inite),
      applyStateTransition: jest.fn(),
    } as any;
    const processor = new WebhookProcessor(prisma, orchestrator, undefined, rails);
    stripeFetch(() => ({
      json: { id: 'pi_1', status: 'succeeded', amount: 1000, currency: 'usd' },
    }));

    prisma.merchantConnection.findUnique.mockResolvedValue(connectionRow());
    prisma.webhookEvent.findUnique.mockResolvedValue({
      id: 'w1',
      rail: `MERCHANT:${CONNECTION}`,
      status: 'received',
      eventType: 'payment.paid',
      entityId: 'pi_1',
      attempts: 0,
    });
    await processor.process({
      data: { rail: `MERCHANT:${CONNECTION}`, webhookId: 'evt_1' },
    } as any);
    expect(prisma.paymentIntent.findFirst.mock.calls[0][0].where).toEqual({
      providerIntentId: 'pi_1',
      rail: 'STRIPE',
      order: { merchantId: MERCHANT },
    });
    expect(orchestrator.getAdapter).not.toHaveBeenCalled();
    expect(prisma.paymentProvider.findUnique).not.toHaveBeenCalled();

    prisma.webhookEvent.findUnique.mockResolvedValue({
      id: 'w2',
      rail: 'STRIPE',
      status: 'received',
      eventType: 'payment.paid',
      entityId: 'pi_1',
      attempts: 0,
    });
    await processor.process({ data: { rail: 'STRIPE', webhookId: 'evt_2' } } as any);
    expect(prisma.paymentIntent.findFirst.mock.calls[1][0].where).toEqual({
      providerIntentId: 'pi_1',
      rail: 'STRIPE',
      order: { merchantId: null },
    });
    expect(orchestrator.applyStateTransition).not.toHaveBeenCalled();
  });
});

describe('YooKassa on a merchant shop', () => {
  const creds = { shopId: '123456', secretKey: 'test_PLACEHOLDERplaceholder0001' };
  const scope = { merchantId: MERCHANT, connectionId: CONNECTION };

  it('accepts a notification only when the payment is found in the bound shop', async () => {
    const yk = new YooKassaAdapter(prismaMock()).withCredentials(creds, scope);
    const payload = {
      type: 'notification',
      event: 'payment.succeeded',
      object: { id: 'yk-pay-0001' },
    };
    stripeFetch(() => ({ status: 404, json: { description: 'not found' } }));
    await expect(
      yk.verifyWebhook!({ rawBody: Buffer.from(''), headers: {}, config: {}, payload }),
    ).resolves.toBe(false);
    jest.restoreAllMocks();
    const fetch = stripeFetch(() => ({ json: { id: 'yk-pay-0001', status: 'succeeded' } }));
    await expect(
      yk.verifyWebhook!({ rawBody: Buffer.from(''), headers: {}, config: {}, payload }),
    ).resolves.toBe(true);
    const auth = Buffer.from(`${creds.shopId}:${creds.secretKey}`).toString('base64');
    expect(fetch.mock.calls[0][1]!.headers).toMatchObject({ Authorization: `Basic ${auth}` });
  });

  it('reads status from the API: paid with its amount, refunded when all of it came back', async () => {
    const yk = new YooKassaAdapter(prismaMock()).withCredentials(creds, scope);
    stripeFetch(() => ({
      json: { id: 'p', status: 'succeeded', amount: { value: '150.00', currency: 'RUB' } },
    }));
    await expect(yk.getIntentStatus('p')).resolves.toMatchObject({
      status: 'paid',
      amount: 150,
      currency: 'RUB',
    });
    jest.restoreAllMocks();
    stripeFetch(() => ({
      json: {
        id: 'p',
        status: 'succeeded',
        amount: { value: '150.00', currency: 'RUB' },
        refunded_amount: { value: '150.00', currency: 'RUB' },
      },
    }));
    await expect(yk.getIntentStatus('p')).resolves.toMatchObject({ status: 'refunded' });
  });

  it('verifies the shop the credentials open is the one named', async () => {
    const yk = new YooKassaAdapter(prismaMock()).withCredentials(creds, scope);
    stripeFetch(() => ({ json: { account_id: '999999', status: 'enabled' } }));
    await expect(yk.verifyAccount!()).rejects.toThrow(/different YooKassa shop/);
  });
});
