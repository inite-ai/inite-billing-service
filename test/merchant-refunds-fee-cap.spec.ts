import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MerchantsService } from '../src/merchants/merchants.service';
import { sealCredentials } from '../src/merchants/merchant-credentials';
import { OpenSalePolicy } from '../src/checkout/open-sale.policy';
import { merchantSalesInOpenCap } from '../src/checkout/open-product';
import { toMoney } from '../src/common/money';

/**
 * Owner decisions of 31.10.2026 on merchant-own accounts:
 * - a rail with no refund API (lava.top, crypto) has its refund recorded
 *   only, and the answer says so;
 * - INITE's fee is a setting per merchant and per account, 0 by default,
 *   and is never applied;
 * - a merchant's sale is not held to, nor counted in, the service's open
 *   daily cap unless MERCHANT_SALES_IN_OPEN_CAP is "true".
 */

const SERVICE = '11111111-1111-4111-8111-111111111111';
const MERCHANT = '33333333-3333-4333-8333-333333333333';
const CONNECTION = '44444444-4444-4444-8444-444444444444';
const ORDER = '55555555-5555-4555-8555-555555555555';
const who = { serviceId: SERVICE, actor: 'service:shop:client' };
// Obvious placeholders, never real keys.
const STRIPE_KEY = 'sk_test_PLACEHOLDERplaceholder0001';

function connection(rail: string, credentials: Record<string, unknown>, over = {}) {
  return {
    id: CONNECTION,
    merchantId: MERCHANT,
    rail,
    status: 'verified',
    sealedCredentials: sealCredentials(CONNECTION, credentials),
    hints: {},
    verifiedAt: new Date(),
    lastError: null,
    platformFeeBps: null,
    createdAt: new Date(),
    ...over,
  };
}

function build(rail: string, connector: any = null) {
  const conn = connection(
    rail,
    rail === 'STRIPE' ? { secretKey: STRIPE_KEY } : { apiKey: 'x', webhookSecret: 'y' },
  );
  const prisma: any = {
    merchant: {
      findUnique: jest.fn().mockResolvedValue({
        id: MERCHANT,
        serviceId: SERVICE,
        orgId: 'shop:1',
        displayName: 'Shop',
        platformFeeBps: 0,
        connections: [conn],
      }),
    },
    merchantConnection: {
      findUnique: jest.fn().mockResolvedValue(conn),
      update: jest.fn().mockImplementation(({ data }) => ({ ...conn, ...data })),
    },
    merchantAuditLog: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    order: {
      findUnique: jest.fn().mockResolvedValue({
        id: ORDER,
        merchantId: MERCHANT,
        merchantConnectionId: CONNECTION,
        status: 'paid',
        amount: toMoney('100.00'),
        currency: 'RUB',
        paymentIntents: [{ id: 'pi-1', rail, providerIntentId: 'prov-1', status: 'paid' }],
      }),
    },
  };
  const rails: any = {
    connectorFor: jest.fn().mockResolvedValue({ connector, connection: conn }),
  };
  const orchestrator: any = { applyStateTransition: jest.fn() };
  const lock: any = {
    runWithLock: jest.fn(async (_k: string, _t: number, fn: any) => (await fn(), true)),
  };
  const config = new ConfigService({ FRONTEND_URL: 'https://billing.example' });
  const service = new MerchantsService(prisma, config, rails, orchestrator, lock);
  return { prisma, rails, orchestrator, service };
}

describe('merchant refunds on a rail with no refund API', () => {
  it.each(['LAVA', 'CRYPTO'])(
    '%s: records the refund without calling the provider, and says so',
    async (rail) => {
      const { service, prisma, rails, orchestrator } = build(rail);
      const answer = await service.refund(who, MERCHANT, ORDER, { reason: 'returned' });
      expect(rails.connectorFor).not.toHaveBeenCalled();
      expect(answer).toMatchObject({ status: 'refunded', recordedOnly: true, refunded: '100.00' });
      expect(String((answer as any).note)).toMatch(/no refund API/);
      expect(orchestrator.applyStateTransition).toHaveBeenCalledWith('pi-1', 'refunded');
      const row = prisma.merchantAuditLog.create.mock.calls[0][0].data;
      expect(row).toMatchObject({ action: 'order.refunded', connectionId: CONNECTION });
      expect(row.detail).toMatchObject({ recordedOnly: true, rail, amount: '100.0000' });
    },
  );

  it('a partial recorded refund leaves the order paid', async () => {
    const { service, orchestrator } = build('LAVA');
    const answer = await service.refund(who, MERCHANT, ORDER, { amount: '40.00' });
    expect(answer).toMatchObject({ status: 'paid', refunded: '40.00', recordedOnly: true });
    expect(orchestrator.applyStateTransition).not.toHaveBeenCalled();
  });

  it('a provider refund that fails is refused and audited, with no secret in the log', async () => {
    const connector = {
      capabilities: () => ({ supportsRefund: true }),
      refund: jest.fn().mockRejectedValue(new Error(`bad key ${STRIPE_KEY}`)),
    };
    const { service, prisma, orchestrator } = build('STRIPE', connector);
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    await expect(service.refund(who, MERCHANT, ORDER, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(orchestrator.applyStateTransition).not.toHaveBeenCalled();
    const row = prisma.merchantAuditLog.create.mock.calls[0][0].data;
    expect(row.action).toBe('order.refund_failed');
    expect(JSON.stringify(row)).not.toContain(STRIPE_KEY);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(STRIPE_KEY);
  });

  it('a provider refund goes through the merchant connector and is not recorded-only', async () => {
    const connector = {
      capabilities: () => ({ supportsRefund: true }),
      refund: jest.fn().mockResolvedValue({ refunded: true, providerRefundId: 're_1' }),
    };
    const { service } = build('STRIPE', connector);
    const answer = await service.refund(who, MERCHANT, ORDER, {});
    expect(connector.refund).toHaveBeenCalled();
    expect(answer).toMatchObject({ recordedOnly: false, providerRefundId: 're_1' });
  });
});

describe('INITE platform fee on a merchant', () => {
  it('is shown per merchant and per account, defaults to none, and is never applied', async () => {
    const { service } = build('LAVA');
    const view: any = await service.get(SERVICE, MERCHANT);
    expect(view.platformFeeBps).toBe(0);
    expect(view.platformFeeApplied).toBe(false);
    expect(view.connections[0]).toMatchObject({ platformFeeBps: null, refunds: 'record-only' });
  });

  it('an admin sets a per-account fee, audited', async () => {
    const { service, prisma } = build('STRIPE');
    const view: any = await service.setConnectionPlatformFee(
      { serviceId: null, actor: 'admin:1' },
      MERCHANT,
      'STRIPE',
      150,
    );
    expect(view).toMatchObject({ platformFeeBps: 150, refunds: 'provider' });
    expect(prisma.merchantAuditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'connection.fee_set',
      detail: { rail: 'STRIPE', from: null, to: 150 },
    });
  });
});

describe("merchant sales and the service's open daily cap", () => {
  const prev = process.env.MERCHANT_SALES_IN_OPEN_CAP;
  afterEach(() => {
    if (prev === undefined) delete process.env.MERCHANT_SALES_IN_OPEN_CAP;
    else process.env.MERCHANT_SALES_IN_OPEN_CAP = prev;
  });

  function policy(used: string) {
    const prisma: any = {
      order: { aggregate: jest.fn().mockResolvedValue({ _sum: { amount: toMoney(used) } }) },
    };
    return { prisma, policy: new OpenSalePolicy(prisma, {} as any) };
  }
  const service = { id: SERVICE, metadata: { openDailyCap: { RUB: '1000.00' } } };
  const uncapped = { id: SERVICE, metadata: {} };

  it('is off by default and only "true" turns it on', () => {
    expect(merchantSalesInOpenCap({})).toBe(false);
    expect(merchantSalesInOpenCap({ MERCHANT_SALES_IN_OPEN_CAP: '1' })).toBe(false);
    expect(merchantSalesInOpenCap({ MERCHANT_SALES_IN_OPEN_CAP: 'TRUE' })).toBe(true);
  });

  it('off: a merchant sale is not held to the cap, even with no cap set', async () => {
    delete process.env.MERCHANT_SALES_IN_OPEN_CAP;
    const { prisma, policy: p } = policy('999.00');
    await expect(
      p.assertWithinCap(uncapped, 'RUB', toMoney('500'), undefined, { merchant: true }),
    ).resolves.toBeUndefined();
    expect(prisma.order.aggregate).not.toHaveBeenCalled();
  });

  it("off: INITE's own open sales do not count merchants' orders", async () => {
    delete process.env.MERCHANT_SALES_IN_OPEN_CAP;
    const { prisma, policy: p } = policy('0');
    await p.assertWithinCap(service, 'RUB', toMoney('10'));
    expect(prisma.order.aggregate.mock.calls[0][0].where).toMatchObject({ merchantId: null });
  });

  it('on: a merchant sale is held to the cap and merchants count', async () => {
    process.env.MERCHANT_SALES_IN_OPEN_CAP = 'true';
    const { prisma, policy: p } = policy('999.00');
    await expect(
      p.assertWithinCap(service, 'RUB', toMoney('5'), undefined, { merchant: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.order.aggregate.mock.calls[0][0].where).not.toHaveProperty('merchantId');
  });
});
