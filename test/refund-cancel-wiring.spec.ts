import { BadRequestException } from '@nestjs/common';
import { StripeAdapter } from '../src/adapters/stripe/stripe.adapter';
import { PaymentOrchestratorService } from '../src/payment-orchestrator/payment-orchestrator.service';
import { AdminOrdersService } from '../src/admin/services/admin-orders.service';

/**
 * Finding F: admin refund and subscription cancel were DB-only — the provider
 * kept the money / kept charging. These tests pin the provider calls and, for
 * refunds, that we call the provider BEFORE revoking access (so a failed refund
 * never leaves a customer without access AND without their money).
 */
describe('Provider refund / cancel wiring', () => {
  describe('StripeAdapter', () => {
    let adapter: StripeAdapter;
    let fetchMock: jest.Mock;

    beforeEach(() => {
      const prisma: any = {
        paymentProvider: {
          findUnique: jest.fn().mockResolvedValue({
            isActive: true,
            config: { secretKey: 'sk_test', apiVersion: '2024-12-18.acacia' },
          }),
        },
      };
      adapter = new StripeAdapter(prisma);
      fetchMock = jest.fn();
      global.fetch = fetchMock as any;
    });

    it('refund() POSTs to /v1/refunds against the payment intent', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ id: 're_1', status: 'succeeded' }),
      });
      const res = await adapter.refund({ providerIntentId: 'pi_123', amount: 12.5 });
      expect(res).toEqual({ refunded: true, providerRefundId: 're_1' });
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.stripe.com/v1/refunds');
      expect(opts.method).toBe('POST');
      expect(opts.body).toContain('payment_intent=pi_123');
      expect(opts.body).toContain('amount=1250'); // cents
    });

    it('reports refunded=false when Stripe returns a failed refund', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ id: 're_2', status: 'failed' }),
      });
      const res = await adapter.refund({ providerIntentId: 'pi_x' });
      expect(res.refunded).toBe(false);
    });

    it('cancelSubscription() DELETEs the subscription (immediate)', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'sub_1', status: 'canceled' }),
      });
      await adapter.cancelSubscription({ providerSubscriptionId: 'sub_1' });
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.stripe.com/v1/subscriptions/sub_1');
      expect(opts.method).toBe('DELETE');
    });

    it('cancelSubscription({atPeriodEnd}) POSTs cancel_at_period_end', async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'sub_2' }) });
      await adapter.cancelSubscription({ providerSubscriptionId: 'sub_2', atPeriodEnd: true });
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.stripe.com/v1/subscriptions/sub_2');
      expect(opts.method).toBe('POST');
      expect(opts.body).toContain('cancel_at_period_end=true');
    });

    it('declares refund + cancel capabilities', () => {
      const caps = adapter.capabilities();
      expect(caps.supportsRefund).toBe(true);
      expect(caps.supportsCancel).toBe(true);
    });
  });

  describe('orchestrator.cancelProviderSubscription', () => {
    const orch = () =>
      new PaymentOrchestratorService(
        null as any,
        null as any,
        null as any,
        null as any,
        null as any,
      );

    const connector = (supportsCancel: boolean) => ({
      rail: () => 'STRIPE',
      createPaymentIntent: jest.fn(),
      getIntentStatus: jest.fn(),
      capabilities: () => ({ supportedModes: ['SUBSCRIPTION'], supportsCancel }),
      cancelSubscription: jest.fn().mockResolvedValue({ cancelled: true }),
    });

    it('calls the connector when the rail supports cancel', async () => {
      const o = orch();
      const c = connector(true);
      o.registerAdapter(c as any);
      const ok = await o.cancelProviderSubscription(
        { id: 's1', rail: 'STRIPE', providerSubscriptionId: 'sub_1' },
        false,
      );
      expect(ok).toBe(true);
      expect(c.cancelSubscription).toHaveBeenCalledWith({
        providerSubscriptionId: 'sub_1',
        atPeriodEnd: false,
      });
    });

    it('is a no-op (false) when the rail cannot cancel programmatically', async () => {
      const o = orch();
      const c = connector(false);
      o.registerAdapter(c as any);
      const ok = await o.cancelProviderSubscription(
        { id: 's1', rail: 'STRIPE', providerSubscriptionId: 'sub_1' },
        true,
      );
      expect(ok).toBe(false);
      expect(c.cancelSubscription).not.toHaveBeenCalled();
    });

    it('is a no-op (false) when the subscription has no provider linkage', async () => {
      const o = orch();
      expect(await o.cancelProviderSubscription({ id: 's1', rail: null }, false)).toBe(false);
    });
  });

  describe('AdminOrdersService.refundOrder', () => {
    const paidOrder = {
      id: 'o1',
      status: 'paid',
      amount: 20,
      currency: 'USD',
      paymentIntents: [{ id: 'int1', status: 'paid', rail: 'STRIPE', providerIntentId: 'pi_1' }],
    };

    const makeService = (connector: any) => {
      const prisma: any = {
        order: {
          findUnique: jest.fn().mockResolvedValue(paidOrder),
          update: jest.fn(),
        },
      };
      const orchestrator: any = {
        getAdapter: jest.fn().mockReturnValue(connector),
        applyStateTransition: jest.fn().mockResolvedValue(undefined),
      };
      return { service: new AdminOrdersService(prisma, orchestrator), orchestrator };
    };

    it('refunds the provider BEFORE the DB transition', async () => {
      const order = new Map<string, number>();
      const connector = {
        capabilities: () => ({ supportsRefund: true }),
        refund: jest.fn().mockImplementation(async () => {
          order.set('refund', 1);
          return { refunded: true, providerRefundId: 're_1' };
        }),
      };
      const { service, orchestrator } = makeService(connector);
      orchestrator.applyStateTransition.mockImplementation(async () => order.set('transition', 2));

      await service.refundOrder('o1');

      expect(connector.refund).toHaveBeenCalledWith({
        providerIntentId: 'pi_1',
        amount: 20,
        currency: 'USD',
      });
      expect(orchestrator.applyStateTransition).toHaveBeenCalledWith('int1', 'refunded');
      // refund happened before the transition
      expect(order.get('refund')).toBe(1);
      expect(order.get('transition')).toBe(2);
    });

    it('aborts (no DB transition) when the provider refund fails', async () => {
      const connector = {
        capabilities: () => ({ supportsRefund: true }),
        refund: jest.fn().mockResolvedValue({ refunded: false }),
      };
      const { service, orchestrator } = makeService(connector);
      await expect(service.refundOrder('o1')).rejects.toBeInstanceOf(BadRequestException);
      expect(orchestrator.applyStateTransition).not.toHaveBeenCalled();
    });

    it('falls back to DB-only refund for rails without programmatic refund', async () => {
      const connector = { capabilities: () => ({ supportsRefund: false }) };
      const { service, orchestrator } = makeService(connector);
      await service.refundOrder('o1');
      expect(orchestrator.applyStateTransition).toHaveBeenCalledWith('int1', 'refunded');
    });
  });
});
