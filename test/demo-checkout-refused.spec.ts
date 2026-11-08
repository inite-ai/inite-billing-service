import { ForbiddenException } from '@nestjs/common';
import { CheckoutService } from '../src/checkout/checkout.service';
import { PlanChangeService } from '../src/subscription-lifecycle/plan-change.service';
import { DEMO_ORG_ID, DEMO_SUBSCRIBER } from '../src/common/demo';

/**
 * The family demo can never buy, pay or change a plan (owner, 2026-11). The
 * global DemoReadOnlyInterceptor refuses a demo session's writes before any
 * handler; this is the second wall, in the services themselves, because a
 * selling service's API key can name any subscriber, the demo tenant
 * included. Each refusal must come before the first database read, the
 * Redis client, the payment orchestrator's adapters and any network call.
 */
describe('a demo checkout is refused before any network call', () => {
  let fetchSpy: jest.SpyInstance;
  const touched: string[] = [];

  /** Every dependency records being called; none may be. */
  const deep = (name: string): any =>
    new Proxy(function () {}, {
      get: (_t, prop) => (prop === 'then' ? undefined : deep(`${name}.${String(prop)}`)),
      apply: () => {
        touched.push(name);
        return Promise.resolve(null);
      },
    });

  const build = () =>
    new CheckoutService(
      deep('prisma'),
      deep('catalog'),
      deep('orchestrator'),
      deep('affiliates'),
      deep('promo'),
      deep('funnel'),
      deep('config'),
      deep('risk'),
      deep('openPolicy'),
    );

  beforeEach(() => {
    touched.length = 0;
    fetchSpy = jest.spyOn(globalThis, 'fetch' as any).mockImplementation(() => {
      throw new Error('network');
    });
  });
  afterEach(() => fetchSpy.mockRestore());

  const expectRefusedUntouched = async (p: Promise<unknown>) => {
    await expect(p).rejects.toBeInstanceOf(ForbiddenException);
    await p.catch((e: any) => expect(e.getResponse().error).toBe('demo_read_only'));
    expect(touched).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  };

  it('createSession', () =>
    expectRefusedUntouched(
      build().createSession(
        DEMO_SUBSCRIBER,
        { priceCode: 'p', mode: 'SUBSCRIPTION' } as any,
        'idem-1',
      ),
    ));

  it('createCartSession (a service key naming the demo tenant)', () =>
    expectRefusedUntouched(
      build().createCartSession(
        DEMO_SUBSCRIBER,
        { lines: [{ priceCode: 'p', quantity: 1 }] } as any,
        'k',
        'svc',
      ),
    ));

  it('createOpenSession', () =>
    expectRefusedUntouched(
      build().createOpenSession(DEMO_SUBSCRIBER, { line: {} } as any, 'k', {
        serviceId: 's',
        serviceCode: 'c',
      }),
    ));

  it('getSession, paySession and refreshPayment for a demo session', async () => {
    await expectRefusedUntouched(build().getSession('order-1', DEMO_SUBSCRIBER));
    await expectRefusedUntouched(
      build().paySession('order-1', DEMO_SUBSCRIBER, { rail: 'stripe' }),
    );
    await expectRefusedUntouched(build().refreshPayment('order-1', DEMO_SUBSCRIBER));
  });

  it("a demo tenant's order opened by link or service key is refused once read, before a provider", async () => {
    const order = {
      id: 'order-1',
      userId: DEMO_SUBSCRIBER,
      price: { product: { serviceId: 's' } },
    };
    const getAdapter = jest.fn();
    const prisma: any = { order: { findUnique: jest.fn().mockResolvedValue(order) } };
    const service = new CheckoutService(
      prisma,
      {} as any,
      { getAdapter } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    await expect(service.getSession('order-1', undefined, 's')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      service.paySession('order-1', undefined, { rail: 'stripe' }, undefined, 'tok'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.refreshPayment('order-1', undefined, 'tok')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(getAdapter).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a plan change for the demo tenant opens no order, link or event', async () => {
    const sub = {
      id: 'sub-1',
      userId: DEMO_SUBSCRIBER,
      status: 'active',
      price: { product: { serviceId: 's' } },
    };
    const prisma: any = {
      subscription: { findUnique: jest.fn().mockResolvedValue(sub) },
      order: { create: jest.fn() },
    };
    const outbox: any = { emit: jest.fn() };
    const service = new PlanChangeService(
      prisma,
      outbox,
      {} as any,
      {} as any,
      { get: () => undefined } as any,
    );
    await expect(
      service.change({ serviceId: 's' }, { subscriptionId: 'sub-1', priceCode: 'p' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.change(
        { userId: DEMO_SUBSCRIBER, orgId: DEMO_ORG_ID, orgRole: 'owner', demo: true },
        { subscriptionId: 'sub-1', priceCode: 'p' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.order.create).not.toHaveBeenCalled();
    expect(outbox.emit).not.toHaveBeenCalled();
  });
});
