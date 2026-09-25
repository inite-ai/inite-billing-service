import { BadRequestException } from '@nestjs/common';
import { LAVA_UNMATCHED_EVENT, LavaAdapter } from '../src/adapters/lava/lava.adapter';
import { reconcileAmount } from '../src/workers/reconcile-amount';

/**
 * lava.top, pinned against the shapes in its published API
 * (gate.lava.top/docs/documentation.yaml).
 *
 * The adapter this replaced could not complete a sale: it read `completed`
 * where the API returns `COMPLETED`, reported no amount so the processor
 * failed every payment it did read, required an offer id nothing supplied,
 * and never sent the customer back.
 */
describe('LavaAdapter', () => {
  const fetchMock = jest.fn();
  const answer = (body: unknown, status = 200) =>
    Promise.resolve({
      ok: status < 400,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    });

  const provider = (config: Record<string, unknown> = {}) => ({
    code: 'LAVA',
    isActive: true,
    config: { apiKey: 'lava-api-key', ...config },
  });

  const build = (
    opts: {
      config?: Record<string, unknown>;
      price?: any;
      intent?: any;
      intents?: any[];
      subscription?: any;
    } = {},
  ) => {
    const prisma: any = {
      paymentProvider: { findUnique: jest.fn().mockResolvedValue(provider(opts.config)) },
      price: { findUnique: jest.fn().mockResolvedValue(opts.price ?? null) },
      paymentIntent: {
        findFirst: jest.fn().mockResolvedValue(opts.intent ?? null),
        findMany: jest.fn().mockResolvedValue(opts.intents ?? []),
        update: jest.fn().mockResolvedValue({}),
      },
      subscription: { findFirst: jest.fn().mockResolvedValue(opts.subscription ?? null) },
    };
    return { adapter: new LavaAdapter(prisma), prisma };
  };

  const price = (o: Record<string, unknown> = {}) => ({
    code: 'pro-monthly',
    amount: '1490',
    interval: 'none',
    metadata: {},
    product: { metadata: {} },
    ...o,
  });

  const input = (o: Record<string, any> = {}) => ({
    orderId: 'ord-ext-1',
    amount: 1490,
    currency: 'RUB',
    mode: 'PAYMENT' as const,
    successUrl: 'https://shop.example/thanks',
    errorUrl: '',
    ...o,
    metadata: {
      price_code: 'pro-monthly',
      buyerEmail: 'buyer@example.com',
      checkoutReturnUrl: 'https://billing.inite.ai/checkout/ord-1',
      ...(o.metadata ?? {}),
    },
  });

  const created = {
    id: 'c5a0cacc-3453-44b0-9532-aa492f1ba191',
    status: 'new',
    paymentUrl: 'https://pay.lava.top/x',
  };
  const sentBody = () => JSON.parse(fetchMock.mock.calls[0][1].body);

  beforeEach(() => {
    fetchMock.mockReset();
    (global as any).fetch = fetchMock;
  });

  describe('opening an invoice', () => {
    it('sells a price through its own offer and sends the customer back after', async () => {
      fetchMock.mockReturnValue(answer(created, 201));
      const { adapter } = build({ price: price({ metadata: { lavaOfferId: 'offer-own' } }) });

      const result = await adapter.createPaymentIntent(input());

      expect(fetchMock.mock.calls[0][0]).toBe('https://gate.lava.top/api/v3/invoice');
      expect(fetchMock.mock.calls[0][1].headers['X-Api-Key']).toBe('lava-api-key');
      expect(sentBody()).toMatchObject({
        email: 'buyer@example.com',
        offerId: 'offer-own',
        currency: 'RUB',
        periodicity: 'ONE_TIME',
        // Back to our checkout, which confirms the payment itself and then
        // goes on to the shop — whatever happened on lava.top.
        successful_return_url: 'https://billing.inite.ai/checkout/ord-1?returned=1',
        failure_return_url: 'https://billing.inite.ai/checkout/ord-1?returned=1',
        cancel_return_url: 'https://billing.inite.ai/checkout/ord-1?returned=1',
      });
      expect(sentBody().amount).toBeUndefined();
      expect(result).toMatchObject({
        providerIntentId: created.id,
        checkoutUrl: created.paymentUrl,
      });
      expect(result.metadata).toMatchObject({
        buyerEmail: 'buyer@example.com',
        lava_offer_id: 'offer-own',
      });
    });

    it('falls back to the dynamic default offer, sending the amount', async () => {
      fetchMock.mockReturnValue(answer(created, 201));
      const { adapter } = build({ config: { defaultOfferId: 'offer-dynamic' }, price: price() });
      await adapter.createPaymentIntent(input());
      expect(sentBody()).toMatchObject({ offerId: 'offer-dynamic', amount: 1490 });
    });

    it('never charges a fixed offer’s full price for a discounted order', async () => {
      const { adapter } = build({ price: price({ metadata: { lavaOfferId: 'offer-own' } }) });
      await expect(adapter.createPaymentIntent(input({ amount: 990 }))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(fetchMock).not.toHaveBeenCalled();

      fetchMock.mockReturnValue(answer(created, 201));
      const withDefault = build({
        config: { defaultOfferId: 'offer-dynamic' },
        price: price({ metadata: { lavaOfferId: 'offer-own' } }),
      });
      await withDefault.adapter.createPaymentIntent(input({ amount: 990 }));
      expect(sentBody()).toMatchObject({ offerId: 'offer-dynamic', amount: 990 });
    });

    it('says what is missing when there is no offer at all', async () => {
      const { adapter } = build({ price: price() });
      await expect(adapter.createPaymentIntent(input())).rejects.toThrow('lavaOfferId');
    });

    it('bills a yearly subscription yearly, and needs a subscription offer for it', async () => {
      fetchMock.mockReturnValue(answer(created, 201));
      const { adapter } = build({
        price: price({ interval: 'year', metadata: { lavaOfferId: 'offer-year' } }),
      });
      await adapter.createPaymentIntent(input({ mode: 'SUBSCRIPTION' }));
      expect(sentBody()).toMatchObject({ offerId: 'offer-year', periodicity: 'PERIOD_YEAR' });

      const noOffer = build({
        config: { defaultOfferId: 'offer-dynamic' },
        price: price({ interval: 'month' }),
      });
      await expect(
        noOffer.adapter.createPaymentIntent(input({ mode: 'SUBSCRIPTION' })),
      ).rejects.toThrow('no lava.top offer');
    });

    it('pays by СБП through the provider that carries it', async () => {
      fetchMock.mockReturnValue(answer(created, 201));
      const { adapter } = build({ price: price({ metadata: { lavaOfferId: 'o' } }) });
      await adapter.createPaymentIntent(input({ method: 'SBP' }));
      expect(sentBody()).toMatchObject({ paymentProvider: 'PAY2ME', paymentMethod: 'SBP' });
    });

    it('refuses a currency lava.top does not take, and a buyer with no email', async () => {
      const { adapter } = build({ price: price({ metadata: { lavaOfferId: 'o' } }) });
      await expect(adapter.createPaymentIntent(input({ currency: 'KZT' }))).rejects.toThrow(
        'RUB, USD, EUR',
      );
      await expect(
        adapter.createPaymentIntent(input({ metadata: { buyerEmail: '' } })),
      ).rejects.toThrow('email');
    });

    it('offers card and СБП for roubles, card and PayPal for dollars', async () => {
      const { adapter } = build();
      expect((await adapter.listMethods({ currency: 'RUB' })).map((m) => m.id)).toEqual([
        'CARD',
        'SBP',
      ]);
      expect((await adapter.listMethods({ currency: 'USD' })).map((m) => m.id)).toEqual([
        'CARD',
        'PAYPAL',
      ]);
      expect(adapter.capabilities().currencies).toEqual(['RUB', 'USD', 'EUR']);
    });
  });

  describe('reading a payment', () => {
    const invoice = (o: Record<string, unknown> = {}) => ({
      id: created.id,
      type: 'INVOICE',
      status: 'COMPLETED',
      receipt: { amount: 1490, currency: 'RUB', fee: 74.5 },
      ...o,
    });

    it('reads the upper-case status the API returns, with the amount the processor needs', async () => {
      fetchMock.mockReturnValue(answer(invoice()));
      const { adapter } = build({ intent: { snapshot: { buyerEmail: 'b@e.com' } } });

      const result = await adapter.getIntentStatus(created.id);

      expect(fetchMock.mock.calls[0][0]).toBe(
        `https://gate.lava.top/api/v2/invoices/${created.id}`,
      );
      expect(result).toMatchObject({ status: 'paid', amount: 1490, currency: 'RUB' });
      // And the processor accepts it — it used to fail every one as unverifiable.
      expect(reconcileAmount({ amount: '1490', currency: 'RUB' }, result)).toMatchObject({
        ok: true,
      });
      // The snapshot keeps what the invoice was opened with.
      expect(result.providerData).toMatchObject({ buyerEmail: 'b@e.com' });
    });

    it.each([
      ['NEW', 'created'],
      ['IN_PROGRESS', 'opened'],
      ['FAILED', 'failed'],
      ['subscription-active', 'paid'],
      ['subscription-failed', 'failed'],
    ])('maps %s to %s', async (status, expected) => {
      fetchMock.mockReturnValue(answer(invoice({ status })));
      const { adapter } = build();
      expect((await adapter.getIntentStatus(created.id)).status).toBe(expected);
    });

    it('reports a refund lava.top told us about as refunded', async () => {
      const { adapter } = build({
        intent: { snapshot: { lavaRefund: { eventType: 'refund.success', full: true } } },
      });
      expect((await adapter.getIntentStatus(created.id)).status).toBe('refunded');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('webhooks', () => {
    it('checks the webhook key set in lava.top, falling back to the API key, or Basic auth', () => {
      const { adapter } = build();
      const verify = (config: Record<string, string>, headers: Record<string, string>) =>
        adapter.verifyWebhook({ rawBody: Buffer.from(''), headers, config, payload: {} });

      expect(verify({ apiKey: 'api', webhookKey: 'hook' }, { 'x-api-key': 'hook' })).toBe(true);
      expect(verify({ apiKey: 'api', webhookKey: 'hook' }, { 'x-api-key': 'api' })).toBe(false);
      expect(verify({ apiKey: 'api' }, { 'x-api-key': 'api' })).toBe(true);
      expect(
        verify(
          { webhookUsername: 'u', webhookPassword: 'p' },
          { authorization: `Basic ${Buffer.from('u:p').toString('base64')}` },
        ),
      ).toBe(true);
      expect(verify({}, { 'x-api-key': 'anything' })).toBe(false);
    });

    it('anchors a renewal to the subscription’s first contract', async () => {
      const { adapter } = build();
      const parsed = await adapter.handleWebhook({
        eventType: 'subscription.recurring.payment.success',
        contractId: 'renewal-2',
        parentContractId: 'first-1',
        status: 'subscription-active',
      });
      expect(parsed).toMatchObject({ eventType: 'subscription.renewed', entityId: 'first-1' });
    });

    it('finds the first contract for a cancellation, which names only the latest', async () => {
      fetchMock.mockReturnValue(answer({ id: 'renewal-2', parentInvoice: { id: 'first-1' } }));
      const { adapter } = build();
      const parsed = await adapter.handleWebhook({
        eventType: 'subscription.cancelled',
        contractId: 'renewal-2',
      });
      expect(parsed).toMatchObject({ eventType: 'subscription.cancelled', entityId: 'first-1' });
    });

    const refund = (o: Record<string, unknown> = {}) => ({
      event_id: 'ev-1',
      event_type: 'refund.success',
      data: {
        refund_id: 'rf-1',
        refund_type: 'full',
        amount: 1490,
        currency: 'RUB',
        product: { tier_id: 'offer-own' },
        customer_email: 'Buyer@Example.com',
        ...o,
      },
    });
    const paidIntent = {
      id: 'pi-1',
      providerIntentId: created.id,
      amount: '1490',
      snapshot: { buyerEmail: 'buyer@example.com', lava_offer_id: 'offer-own' },
    };

    it('matches a refund to its sale and marks it for refunding', async () => {
      const { adapter, prisma } = build({ intents: [paidIntent] });
      const parsed = await adapter.handleWebhook(refund());
      expect(parsed).toMatchObject({ eventType: 'payment.refunded', entityId: created.id });
      expect(prisma.paymentIntent.update.mock.calls[0][0].data.snapshot.lavaRefund).toMatchObject({
        full: true,
        eventType: 'refund.success',
      });
    });

    it('records, without settling, a refund it cannot match or a partial one', async () => {
      const unknown = build({ intents: [] });
      expect((await unknown.adapter.handleWebhook(refund())).eventType).toBe(LAVA_UNMATCHED_EVENT);

      const partial = build({ intents: [paidIntent] });
      expect(
        (await partial.adapter.handleWebhook(refund({ refund_type: 'partial' }))).eventType,
      ).toBe(LAVA_UNMATCHED_EVENT);
    });

    it('treats a chargeback as money taken back', async () => {
      const { adapter } = build({ intents: [paidIntent] });
      const parsed = await adapter.handleWebhook({
        event_id: 'cb-1',
        event_type: 'chargeback.initiated',
        data: {
          amount: 1490,
          customer_email: 'buyer@example.com',
          product: { tier_id: 'offer-own' },
        },
      });
      expect(parsed.eventType).toBe('payment.refunded');
    });
  });

  describe('subscriptions without a webhook', () => {
    const sub = (o: Record<string, unknown> = {}) => ({
      providerSubscriptionId: 'first-1',
      currentPeriodEnd: new Date('2026-10-01T00:00:00Z'),
      status: 'active',
      ...o,
    });
    const first = (o: Record<string, unknown> = {}) => ({
      id: 'first-1',
      type: 'SUBSCRIPTION_FIRST_INVOICE',
      status: 'COMPLETED',
      subscriptionStatus: 'ACTIVE',
      subscriptionDetails: { expiredAt: '2026-10-01T00:00:00Z' },
      ...o,
    });

    it('sees a renewal in the paid-until date moving past our period', async () => {
      fetchMock.mockReturnValue(
        answer(first({ subscriptionDetails: { expiredAt: '2026-11-01T00:00:00Z' } })),
      );
      const { adapter } = build();
      await expect(adapter.syncSubscription(sub())).resolves.toBe('subscription.renewed');
      expect(fetchMock.mock.calls[0][0]).toBe('https://gate.lava.top/api/v2/invoices/first-1');
    });

    it('sees nothing new while the dates agree', async () => {
      fetchMock.mockReturnValue(answer(first()));
      const { adapter } = build();
      await expect(adapter.syncSubscription(sub())).resolves.toBeNull();
    });

    it('sees a cancellation and a failed renewal — the latter once', async () => {
      fetchMock.mockReturnValue(answer(first({ subscriptionStatus: 'CANCELLED' })));
      await expect(build().adapter.syncSubscription(sub())).resolves.toBe('subscription.cancelled');

      fetchMock.mockReturnValue(answer(first({ subscriptionStatus: 'FAILED' })));
      await expect(build().adapter.syncSubscription(sub())).resolves.toBe(
        'subscription.renewal_failed',
      );
      await expect(
        build().adapter.syncSubscription(sub({ status: 'past_due' })),
      ).resolves.toBeNull();
    });

    it('asks to be polled', () => {
      expect(build().adapter.capabilities().statusPolling).toBe(true);
    });
  });

  describe('cancelling a subscription', () => {
    it('cancels it on lava.top too, by first contract and buyer email', async () => {
      fetchMock.mockReturnValue(answer(null, 204));
      const { adapter } = build({ intent: { snapshot: { buyerEmail: 'buyer@example.com' } } });
      await expect(
        adapter.cancelSubscription({ providerSubscriptionId: 'first-1' }),
      ).resolves.toEqual({
        cancelled: true,
      });
      const [url, init] = fetchMock.mock.calls[0];
      expect(init.method).toBe('DELETE');
      expect(url).toBe(
        'https://gate.lava.top/api/v1/subscriptions?contractId=first-1&email=buyer%40example.com',
      );
    });

    it('counts one lava.top no longer has as cancelled', async () => {
      fetchMock.mockReturnValue(answer({ error: 'not found' }, 404));
      const { adapter } = build({ intent: { snapshot: { buyerEmail: 'b@e.com' } } });
      await expect(adapter.cancelSubscription({ providerSubscriptionId: 'x' })).resolves.toEqual({
        cancelled: true,
      });
    });
  });
});
