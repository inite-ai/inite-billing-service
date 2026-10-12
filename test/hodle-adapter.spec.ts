import { createHmac } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { HODLE_UNMATCHED_EVENT, HodleAdapter } from '../src/adapters/hodle/hodle.adapter';
import { reconcileAmount } from '../src/workers/reconcile-amount';

/**
 * Hodle, pinned against its published API (hodle.com.br/openapi.json) and the
 * webhook guide (docs.hodle.com.br/docs/webhooks): a PIX deposit in BRL cents,
 * read back by externalId, settled by a signed DEPOSIT_PIX_CONFIRMED.
 */
describe('HodleAdapter', () => {
  const fetchMock = jest.fn();
  const answer = (body: unknown, status = 200) =>
    Promise.resolve({
      ok: status < 400,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    });

  const build = (config: Record<string, unknown> = {}, active = true) => {
    const prisma: any = {
      paymentProvider: {
        findUnique: jest.fn().mockResolvedValue({
          code: 'HODLE',
          isActive: active,
          config: { apiKey: 'hodle-key', webhookSecret: 'whsec', ...config },
        }),
      },
    };
    return new HodleAdapter(prisma);
  };

  const input = (o: Record<string, any> = {}) => ({
    orderId: 'ord-1',
    amount: 49,
    currency: 'BRL',
    mode: 'PAYMENT' as const,
    ...o,
  });

  beforeEach(() => {
    fetchMock.mockReset();
    (global as any).fetch = fetchMock;
  });

  describe('createPaymentIntent', () => {
    it('opens a BRS deposit for the amount in cents and returns the PIX code', async () => {
      fetchMock.mockReturnValueOnce(
        answer({
          success: true,
          externalId: 'ord-1-x',
          qrCode: '000201pix',
          fee: 0.5,
          walletCharge: 'wc1',
        }),
      );
      const result = await build().createPaymentIntent(input());

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.hodle.com.br/api/deposit/asset');
      expect(init.headers.Authorization).toBe('Bearer hodle-key');
      const body = JSON.parse(init.body);
      expect(body).toMatchObject({ value: 4900, asset: 'BRS' });
      expect(body.externalId).toMatch(/^ord-1-/);
      expect(body.address).toBeUndefined();
      expect(result.providerIntentId).toBe('ord-1-x');
      expect(result.checkoutUrl).toBeUndefined();
      expect(result.metadata).toMatchObject({ qrCode: '000201pix', value: 4900 });
    });

    it('sends network and address for a stablecoin asset', async () => {
      fetchMock.mockReturnValueOnce(answer({ success: true, externalId: 'e', qrCode: 'q' }));
      await build({ asset: 'usdt', network: 'polygon', address: '0xabc' }).createPaymentIntent(
        input(),
      );
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
        asset: 'USDT',
        network: 'polygon',
        address: '0xabc',
      });
    });

    it('refuses other currencies, subscriptions and amounts under R$1', async () => {
      const adapter = build();
      await expect(adapter.createPaymentIntent(input({ currency: 'USD' }))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(
        adapter.createPaymentIntent(input({ mode: 'SUBSCRIPTION' })),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(adapter.createPaymentIntent(input({ amount: 0.5 }))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('turns a Hodle refusal into a message the customer can act on', async () => {
      fetchMock.mockReturnValueOnce(
        answer({ success: false, error: 'Validation failed', errorCode: 'KYC_REQUIRED' }, 403),
      );
      await expect(build().createPaymentIntent(input())).rejects.toThrow(/KYC_REQUIRED/);
    });

    it('refuses a host that is not Hodle', async () => {
      await expect(
        build({ apiBaseUrl: 'https://evil.example' }).createPaymentIntent(input()),
      ).rejects.toThrow(/untrusted/);
    });
  });

  describe('getIntentStatus', () => {
    const deposit = (data: Record<string, unknown>) =>
      answer({ success: true, data: { value: 4900, ...data } });

    it('reports a settled PIX as paid, in reais, so the processor can reconcile it', async () => {
      fetchMock.mockReturnValueOnce(
        deposit({ status: 'FIAT_PAID', paidAt: '2026-10-11T12:00:00Z' }),
      );
      const status = await build().getIntentStatus('ord-1-x');
      expect(fetchMock.mock.calls[0][0]).toBe('https://api.hodle.com.br/api/deposit/asset/ord-1-x');
      expect(status).toMatchObject({ status: 'paid', amount: 49, currency: 'BRL' });
      expect(reconcileAmount({ amount: '49', currency: 'BRL' } as any, status).ok).toBe(true);
    });

    it('maps pending, expired and refunded', async () => {
      const adapter = build();
      fetchMock.mockReturnValueOnce(deposit({ status: 'PENDING' }));
      expect((await adapter.getIntentStatus('a')).status).toBe('opened');
      fetchMock.mockReturnValueOnce(deposit({ status: 'EXPIRED' }));
      expect((await adapter.getIntentStatus('a')).status).toBe('expired');
      fetchMock.mockReturnValueOnce(deposit({ status: 'REFUNDED' }));
      expect((await adapter.getIntentStatus('a')).status).toBe('refunded');
    });

    it('keeps a deposit whose PIX settled as paid even if delivery failed', async () => {
      const adapter = build();
      fetchMock.mockReturnValueOnce(deposit({ status: 'FAILED', paidAt: '2026-10-11T12:00:00Z' }));
      expect((await adapter.getIntentStatus('a')).status).toBe('paid');
      fetchMock.mockReturnValueOnce(deposit({ status: 'FAILED', paidAt: null }));
      expect((await adapter.getIntentStatus('a')).status).toBe('failed');
    });
  });

  describe('verifyWebhook', () => {
    const sign = (body: string, ts: string, secret = 'whsec') =>
      createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    const now = () => String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({
      event: 'DEPOSIT_PIX_CONFIRMED',
      data: { externalId: 'ord-1-x' },
    });
    const verify = (
      headers: Record<string, string | undefined>,
      config: Record<string, unknown> = { webhookSecret: 'whsec' },
    ) =>
      build().verifyWebhook({
        rawBody: Buffer.from(body),
        headers,
        config,
        payload: JSON.parse(body),
      });

    it('accepts a correctly signed, fresh delivery', () => {
      const ts = now();
      expect(verify({ 'x-hodle-signature': sign(body, ts), 'x-hodle-timestamp': ts })).toBe(true);
    });

    it('rejects a wrong signature, a stale timestamp and a missing secret', () => {
      const ts = now();
      expect(
        verify({ 'x-hodle-signature': sign(body, ts, 'other'), 'x-hodle-timestamp': ts }),
      ).toBe(false);
      const old = String(Number(ts) - 600);
      expect(verify({ 'x-hodle-signature': sign(body, old), 'x-hodle-timestamp': old })).toBe(
        false,
      );
      expect(verify({ 'x-hodle-signature': sign(body, ts), 'x-hodle-timestamp': ts }, {})).toBe(
        false,
      );
      expect(verify({ 'x-hodle-timestamp': ts })).toBe(false);
    });
  });

  describe('handleWebhook', () => {
    it('turns a confirmed PIX into a paid event for the deposit', async () => {
      const parsed = await build().handleWebhook({
        event: 'DEPOSIT_PIX_CONFIRMED',
        data: { eventId: 'ev1', externalId: 'ord-1-x', status: 'FIAT_PAID', value: 4900 },
      });
      expect(parsed).toMatchObject({
        eventType: 'payment.paid',
        entityId: 'ord-1-x',
        webhookId: 'hodle_ev1',
      });
    });

    it('refunds only on a full refund, and records the rest', async () => {
      const adapter = build();
      const full = await adapter.handleWebhook({
        event: 'DEPOSIT_ASSET_REFUNDED',
        data: { eventId: 'e2', externalId: 'd', status: 'REFUNDED' },
      });
      expect(full.eventType).toBe('payment.refunded');
      const partial = await adapter.handleWebhook({
        event: 'DEPOSIT_ASSET_REFUNDED',
        data: { eventId: 'e3', externalId: 'd', status: 'COMPLETED', partial: true },
      });
      expect(partial.eventType).toBe(HODLE_UNMATCHED_EVENT);
      const failed = await adapter.handleWebhook({
        event: 'DEPOSIT_ASSET_FAILED',
        data: { eventId: 'e4', externalId: 'd' },
      });
      expect(failed.eventType).toBe(HODLE_UNMATCHED_EVENT);
    });

    it('acknowledges the registration test', async () => {
      const parsed = await build().handleWebhook({ event: 'WEBHOOK_TEST', data: {} });
      expect(parsed.eventType).toBe(HODLE_UNMATCHED_EVENT);
    });
  });

  it('describes the PIX for the checkout page', async () => {
    const described = await build().describeIntent({
      providerIntentId: 'ord-1-x',
      status: 'created',
      snapshot: { qrCode: '000201pix', value: 4900, hodle_status: 'PENDING' },
    });
    expect(described).toEqual({
      type: 'pix',
      qrCode: '000201pix',
      amount: '49.00',
      currency: 'BRL',
      depositStatus: 'PENDING',
    });
  });
});
