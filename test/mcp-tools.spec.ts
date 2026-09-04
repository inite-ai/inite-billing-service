import { McpToolsService, McpCaller } from '../src/mcp/mcp-tools.service';

/**
 * The MCP surface is the same billing service, spoken to an agent.
 *
 * Two things matter more here than in the REST API. An agent will happily pass
 * a `user_id` it read somewhere, so the identity rule has to hold against
 * arguments rather than trust them. And an agent retries on its own — a
 * timeout, a model that calls a tool twice — so a charge without an
 * idempotency key is a charge that happens twice.
 */
describe('MCP tools', () => {
  const build = (overrides: any = {}) => {
    const credits = {
      getBalance: jest.fn().mockResolvedValue({ balance: 40, totalGranted: 100, totalUsed: 60 }),
      getUserBalances: jest.fn().mockResolvedValue([
        { serviceId: null, balance: 10, totalGranted: 10, totalUsed: 0 },
        { serviceId: 'svc-a', balance: 40, totalGranted: 100, totalUsed: 60 },
      ]),
      consume: jest.fn().mockResolvedValue({ success: true, remainingBalance: 35 }),
      ...overrides.credits,
    };
    const entitlements = {
      getUserEntitlementsByUserId: jest.fn().mockResolvedValue([
        { key: 'access.pro', status: 'active', source: 'subscription', expiresAt: null },
        { key: 'access.legacy', status: 'revoked', source: 'order', expiresAt: null },
      ]),
      ...overrides.entitlements,
    };
    const catalog = {
      getProducts: jest.fn().mockResolvedValue([{ code: 'pro' }]),
      getPrices: jest.fn().mockResolvedValue([{ code: 'pro-monthly' }]),
    };
    const checkout = {
      createSession: jest
        .fn()
        .mockResolvedValue({ sessionId: 'order-1', checkoutUrl: 'https://app/checkout/order-1' }),
    };
    const subscriptions = { getUserSubscriptions: jest.fn().mockResolvedValue([]) };

    const service = new McpToolsService(
      credits as any,
      entitlements as any,
      catalog as any,
      checkout as any,
      subscriptions as any,
    );
    return { service, credits, entitlements, catalog, checkout, subscriptions };
  };

  const asUser: McpCaller = { userId: 'user-1', isService: false, roles: [] };
  const asService: McpCaller = {
    userId: 'service:svc-a',
    isService: true,
    serviceId: 'svc-a',
    roles: [],
  };

  const structured = (result: any) => result.structuredContent;

  describe('who the work is done for', () => {
    it('ignores a user_id a user token tries to pass', async () => {
      const { service, entitlements } = build();

      const result = await service.call(
        'check_entitlement',
        { key: 'access.pro', user_id: 'somebody-else' },
        asUser,
      );

      expect(entitlements.getUserEntitlementsByUserId).toHaveBeenCalledWith('user-1', undefined);
      expect(structured(result).user_id).toBe('user-1');
    });

    it('requires a service key to name the customer', async () => {
      const { service } = build();

      const result: any = await service.call('check_entitlement', { key: 'access.pro' }, asService);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/user_id is required/);
    });

    it('scopes a service to its own entitlements', async () => {
      const { service, entitlements } = build();

      await service.call('list_entitlements', { user_id: 'user-1' }, asService);

      expect(entitlements.getUserEntitlementsByUserId).toHaveBeenCalledWith('user-1', 'svc-a');
    });
  });

  describe('check_entitlement', () => {
    it('answers granted for one that is active', async () => {
      const { service } = build();
      const result = await service.call('check_entitlement', { key: 'access.pro' }, asUser);

      expect(structured(result)).toMatchObject({ granted: true, key: 'access.pro' });
    });

    it('answers not-granted rather than failing, so the agent can offer to sell', async () => {
      const { service } = build();
      const result: any = await service.call('check_entitlement', { key: 'access.team' }, asUser);

      expect(result.isError).toBeUndefined();
      expect(structured(result).granted).toBe(false);
    });

    it('does not count a revoked entitlement', async () => {
      const { service } = build();
      const result = await service.call('check_entitlement', { key: 'access.legacy' }, asUser);

      expect(structured(result).granted).toBe(false);
    });
  });

  describe('consume_credits', () => {
    it('passes the idempotency key through, so a retry charges once', async () => {
      const { service, credits } = build();

      await service.call(
        'consume_credits',
        { user_id: 'user-1', amount: 5, idempotency_key: 'call-42' },
        asService,
      );

      expect(credits.consume).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          amount: 5,
          serviceId: 'svc-a',
          idempotencyKey: 'call-42',
        }),
      );
    });

    it('reports an empty balance as a result, not an error', async () => {
      const { service } = build({
        credits: {
          consume: jest.fn().mockResolvedValue({
            success: false,
            remainingBalance: 0,
            error: 'Insufficient credits',
          }),
        },
      });

      const result: any = await service.call('consume_credits', { amount: 5 }, asUser);

      expect(result.isError).toBeUndefined();
      expect(structured(result)).toMatchObject({ success: false, error: 'Insufficient credits' });
    });
  });

  describe('failures', () => {
    it('comes back as tool content the model can read, not a protocol error', async () => {
      const { service } = build({
        entitlements: {
          getUserEntitlementsByUserId: jest.fn().mockRejectedValue(new Error('database is away')),
        },
      });

      const result: any = await service.call('check_entitlement', { key: 'access.pro' }, asUser);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('database is away');
    });

    it('says so for a tool that does not exist', async () => {
      const { service } = build();
      const result: any = await service.call('drop_database', {}, asUser);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/No such tool/);
    });
  });

  describe('the tool list itself', () => {
    it('marks reads as read-only and writes as not', async () => {
      const { service } = build();
      const byName = Object.fromEntries(service.list().map((t) => [t.name, t]));

      expect(byName.check_entitlement.readOnly).toBe(true);
      expect(byName.get_credit_balance.readOnly).toBe(true);
      expect(byName.consume_credits.readOnly).toBe(false);
      expect(byName.create_checkout_session.readOnly).toBe(false);
    });

    it('describes every tool, because the description is the whole interface', async () => {
      const { service } = build();
      for (const tool of service.list()) {
        expect(tool.description.length).toBeGreaterThan(30);
        expect(tool.title).toBeTruthy();
      }
    });
  });

  describe('create_checkout_session', () => {
    it('sells only the calling service’s catalogue', async () => {
      const { service, checkout } = build();

      await service.call(
        'create_checkout_session',
        {
          user_id: 'user-1',
          price_code: 'pro-monthly',
          mode: 'SUBSCRIPTION',
          idempotency_key: 'k',
        },
        asService,
      );

      expect(checkout.createSession).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ priceCode: 'pro-monthly', mode: 'SUBSCRIPTION' }),
        'k',
        undefined,
        'svc-a',
      );
    });
  });
});
