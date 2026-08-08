import { GooglePlayAdapter } from '../src/adapters/google-play/google-play.adapter';

/**
 * getIntentStatus previously assumed a purchase was 'paid' whenever the
 * subscription lookup threw — so a transient Google error or an invalid token
 * would mark an unpaid order paid. It must now verify one-time products via the
 * products API and fail closed (never 'paid') when it cannot confirm the state.
 */
describe('GooglePlayAdapter.getIntentStatus fail-closed verification', () => {
  const PACKAGE = 'ai.inite.app';

  const buildAdapter = (opts: {
    productId?: string | null;
    requests: (path: string) => Promise<any>;
  }) => {
    const prisma: any = {
      paymentProvider: {
        findUnique: jest.fn().mockResolvedValue({
          isActive: true,
          config: { packageName: PACKAGE, serviceAccountEmail: 'x@y', privateKey: 'k' },
        }),
      },
      paymentIntent: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            opts.productId === undefined
              ? { snapshot: {} }
              : { snapshot: { google_product_id: opts.productId } },
          ),
      },
    };
    const adapter = new GooglePlayAdapter(prisma);
    // Intercept the authenticated Android Publisher calls.
    jest
      .spyOn(adapter as any, 'googleRequest')
      .mockImplementation((...args: any[]) => opts.requests(args[1] as string));
    return adapter;
  };

  const isSubPath = (p: string) => p.includes('/subscriptionsv2/');
  const isProductPath = (p: string) => p.includes('/purchases/products/');

  it('active subscription → paid (unchanged happy path)', async () => {
    const adapter = buildAdapter({
      requests: async (p) => {
        if (isSubPath(p)) return { subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE', lineItems: [] };
        throw new Error('unexpected');
      },
    });
    expect((await adapter.getIntentStatus('tok')).status).toBe('paid');
  });

  it('one-time product purchased (purchaseState 0) → paid', async () => {
    const adapter = buildAdapter({
      productId: 'coins_100',
      requests: async (p) => {
        if (isSubPath(p)) throw new Error('404 not a subscription');
        if (isProductPath(p)) return { purchaseState: 0, orderId: 'GPA.1' };
        throw new Error('unexpected');
      },
    });
    const res = await adapter.getIntentStatus('tok');
    expect(res.status).toBe('paid');
    expect(res.metadata?.purchase_state).toBe(0);
  });

  it('one-time product pending (purchaseState 2) → NOT paid', async () => {
    const adapter = buildAdapter({
      productId: 'coins_100',
      requests: async (p) => {
        if (isSubPath(p)) throw new Error('404 not a subscription');
        if (isProductPath(p)) return { purchaseState: 2 };
        throw new Error('unexpected');
      },
    });
    expect((await adapter.getIntentStatus('tok')).status).toBe('created');
  });

  it('transient error on BOTH lookups → fail closed to created (never paid)', async () => {
    const adapter = buildAdapter({
      productId: 'coins_100',
      requests: async () => {
        throw new Error('Google Play API error: 503');
      },
    });
    const res = await adapter.getIntentStatus('tok');
    expect(res.status).not.toBe('paid');
    expect(res.status).toBe('created');
  });

  it('missing productId + subscription lookup fails → fail closed to created', async () => {
    const adapter = buildAdapter({
      requests: async (p) => {
        if (isSubPath(p)) throw new Error('invalid token');
        throw new Error('unexpected');
      },
    });
    const res = await adapter.getIntentStatus('forged-token');
    expect(res.status).toBe('created');
  });
});
