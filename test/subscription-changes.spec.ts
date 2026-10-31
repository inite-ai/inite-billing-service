import { Logger } from '@nestjs/common';
import {
  applyPlanChangePayment,
  applyRenewalPayment,
  renewedByBilling,
  subscriptionOrderKind,
} from '../src/payment-orchestrator/subscription-changes';

/**
 * Renewals and plan changes billing opens itself are paid as one-off orders
 * and applied to the subscription they name: the period continues from where
 * the paid one ended, a scheduled downgrade lands with the renewal, and the
 * entitlements move with the plan.
 */
describe('subscription changes paid through billing', () => {
  const logger = { error: jest.fn(), warn: jest.fn(), log: jest.fn() } as unknown as Logger;
  let outbox: { emit: jest.Mock };
  let tx: any;
  const product = (code: string, keys: string[]) => ({
    id: `prod-${code}`,
    code,
    serviceId: 'svc-1',
    metadata: { entitlements: keys },
  });
  const starter = {
    id: 'price-starter',
    code: 'studio-starter-monthly',
    interval: 'month',
    graceDays: 3,
    product: product('studio-starter', ['studio:plan:starter']),
  };
  const pro = {
    id: 'price-pro',
    code: 'studio-pro-monthly',
    interval: 'month',
    graceDays: 3,
    product: product('studio-pro', ['studio:plan:pro']),
  };
  const sub = (over: Record<string, unknown> = {}) => ({
    id: 'sub-1',
    userId: 'did:key:z6Mkbuyer',
    priceId: 'price-pro',
    status: 'active',
    rail: 'HODLE',
    providerSubscriptionId: null,
    currentPeriodStart: new Date('2026-11-01T00:00:00Z'),
    currentPeriodEnd: new Date('2099-12-01T00:00:00Z'),
    ...over,
  });

  beforeEach(() => {
    outbox = { emit: jest.fn() };
    tx = {
      subscription: { findUnique: jest.fn(), update: jest.fn() },
      paymentIntent: { findFirst: jest.fn().mockResolvedValue({ rail: 'CRYPTO' }) },
      entitlement: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'e1', key: 'studio:plan:pro', value: { subscription_id: 'sub-1' } },
          { id: 'e2', key: 'other:key', value: { subscription_id: 'sub-other' } },
        ]),
        updateMany: jest.fn(),
        create: jest.fn(),
      },
    };
  });

  it('reads what an order is for from its metadata', () => {
    expect(
      subscriptionOrderKind({
        metadata: { subscriptionRenewal: { subscriptionId: 's', periodEnd: 'x' } },
      }),
    ).toMatchObject({ kind: 'renewal' });
    expect(
      subscriptionOrderKind({ metadata: { planChange: { subscriptionId: 's', toPriceId: 'p' } } }),
    ).toMatchObject({ kind: 'plan_change' });
    expect(subscriptionOrderKind({ metadata: { successUrl: 'x' } })).toBeNull();
    expect(subscriptionOrderKind({})).toBeNull();
  });

  it('renews only what no provider renews', () => {
    expect(renewedByBilling({ rail: 'HODLE', providerSubscriptionId: null })).toBe(true);
    expect(renewedByBilling({ rail: 'CRYPTO', providerSubscriptionId: null })).toBe(true);
    expect(renewedByBilling({ rail: 'LAVA', providerSubscriptionId: 'c-1' })).toBe(false);
    expect(renewedByBilling({ rail: 'PROMO', providerSubscriptionId: null })).toBe(false);
    expect(renewedByBilling({ rail: null, providerSubscriptionId: null })).toBe(false);
  });

  it('continues the period from the old end and applies a scheduled downgrade', async () => {
    tx.subscription.findUnique.mockResolvedValue(sub({ pendingPriceId: 'price-starter' }));
    const order = { id: 'o-1', userId: 'did:key:z6Mkbuyer', price: starter };
    await applyRenewalPayment({ outbox, logger }, tx, order, {
      subscriptionId: 'sub-1',
      periodEnd: '2099-12-01T00:00:00.000Z',
    });

    const data = tx.subscription.update.mock.calls[0][0].data;
    expect(data).toMatchObject({
      priceId: 'price-starter',
      pendingPriceId: null,
      renewalOrderId: null,
      status: 'active',
      rail: 'CRYPTO',
    });
    expect(data.currentPeriodStart.toISOString()).toBe('2099-12-01T00:00:00.000Z');
    expect(data.currentPeriodEnd.toISOString()).toBe('2100-01-01T00:00:00.000Z');
    // Only this subscription's rows are revoked; the new plan's key is granted.
    expect(tx.entitlement.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['e1'] } } }),
    );
    expect(tx.entitlement.create.mock.calls[0][0].data).toMatchObject({
      key: 'studio:plan:starter',
      expiresAt: new Date('2100-01-04T00:00:00.000Z'),
    });
    const types = outbox.emit.mock.calls.map((c) => c[0]);
    expect(types).toEqual(
      expect.arrayContaining([
        'billing.entitlement.revoked',
        'billing.entitlement.granted',
        'billing.subscription.plan_changed',
        'billing.subscription.updated',
      ]),
    );
  });

  it('starts again from now when the renewal is paid after the subscription ended', async () => {
    tx.subscription.findUnique.mockResolvedValue(
      sub({ status: 'ended', currentPeriodEnd: new Date('2020-01-01T00:00:00Z') }),
    );
    const before = Date.now();
    await applyRenewalPayment(
      { outbox, logger },
      tx,
      { id: 'o-1', userId: 'did:key:z6Mkbuyer', price: pro },
      { subscriptionId: 'sub-1', periodEnd: '2020-01-01T00:00:00.000Z' },
    );
    const data = tx.subscription.update.mock.calls[0][0].data;
    expect(data.currentPeriodStart.getTime()).toBeGreaterThanOrEqual(before);
    expect(data.status).toBe('active');
  });

  it('applies nothing for an order that names someone else’s subscription', async () => {
    tx.subscription.findUnique.mockResolvedValue(sub({ userId: 'did:key:z6Mkother' }));
    await applyRenewalPayment(
      { outbox, logger },
      tx,
      { id: 'o-1', userId: 'did:key:z6Mkbuyer', price: pro },
      { subscriptionId: 'sub-1', periodEnd: 'x' },
    );
    expect(tx.subscription.update).not.toHaveBeenCalled();
    expect(tx.entitlement.create).not.toHaveBeenCalled();
  });

  it('moves a paid upgrade onto the new plan without moving the period', async () => {
    tx.subscription.findUnique.mockResolvedValue(sub({ priceId: 'price-starter' }));
    await applyPlanChangePayment(
      { outbox, logger },
      tx,
      { id: 'o-2', userId: 'did:key:z6Mkbuyer', price: pro },
      {
        subscriptionId: 'sub-1',
        fromPriceId: 'price-starter',
        toPriceId: 'price-pro',
        periodEnd: 'x',
      },
    );
    expect(tx.subscription.update.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ priceId: 'price-pro', pendingPriceId: null }),
    );
    expect(tx.subscription.update.mock.calls[0][0].data.currentPeriodEnd).toBeUndefined();
    expect(outbox.emit).toHaveBeenCalledWith(
      'billing.subscription.plan_changed',
      expect.objectContaining({ effective: 'now', order_id: 'o-2' }),
      expect.anything(),
    );
  });

  it('surfaces an upgrade paid after the subscription ended, granting nothing', async () => {
    tx.subscription.findUnique.mockResolvedValue(
      sub({ status: 'ended', priceId: 'price-starter' }),
    );
    await applyPlanChangePayment(
      { outbox, logger },
      tx,
      { id: 'o-3', userId: 'did:key:z6Mkbuyer', price: pro },
      {
        subscriptionId: 'sub-1',
        fromPriceId: 'price-starter',
        toPriceId: 'price-pro',
        periodEnd: 'x',
      },
    );
    expect(tx.subscription.update).not.toHaveBeenCalled();
    expect(tx.entitlement.create).not.toHaveBeenCalled();
    expect(outbox.emit).toHaveBeenCalledWith(
      'billing.subscription.plan_change_failed',
      expect.objectContaining({ order_id: 'o-3', reason: 'not_live' }),
      expect.anything(),
    );
  });
});
