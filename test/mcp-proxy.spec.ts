import { NotFoundException } from '@nestjs/common';

jest.mock('../src/workers/ssrf-guard', () => ({
  assertPublicUrl: jest.fn().mockResolvedValue({ ok: true, addresses: ['93.184.216.34'] }),
}));
jest.mock('../src/workers/pinned-post', () => ({
  postToPinnedAddress: jest.fn(),
}));

import { McpProxyService } from '../src/mcp/mcp-proxy.service';
import { assertPublicUrl } from '../src/workers/ssrf-guard';
import { postToPinnedAddress } from '../src/mcp/../workers/pinned-post';

const guard = assertPublicUrl as jest.Mock;
const forward = postToPinnedAddress as jest.Mock;

/**
 * The billed front door to somebody else's MCP server.
 *
 * The order of operations is the whole design. Authorisation happens before the
 * upstream is touched, so a caller who cannot pay never costs the operator a
 * request. The charge happens after it answered, so nobody is billed for a
 * server that was down. And a refusal is something an agent can act on — a
 * result carrying a checkout URL — rather than an error that ends the turn.
 */
describe('MCP gateway proxy', () => {
  const server = (overrides: any = {}) => ({
    id: 'srv-1',
    serviceId: 'svc-a',
    slug: 'weather',
    name: 'Weather tools',
    upstreamUrl: 'https://tools.example.com/mcp',
    upstreamHeaders: { 'X-Operator-Key': 'secret' },
    isActive: true,
    pricingMode: 'per_call',
    creditsPerCall: 2,
    featureCode: null,
    requiredEntitlement: null,
    priceCode: 'credits-100',
    ...overrides,
  });

  const build = (row: any = server(), overrides: any = {}) => {
    const prisma: any = {
      mcpServer: { findFirst: jest.fn().mockResolvedValue(row) },
      mcpCall: { create: jest.fn().mockResolvedValue({}) },
      meteredFeature: { findUnique: jest.fn().mockResolvedValue({ creditsPerUnit: '3' }) },
    };
    const credits = {
      getBalance: jest.fn().mockResolvedValue({ balance: 10 }),
      consume: jest.fn().mockResolvedValue({ success: true, remainingBalance: 8 }),
      ...overrides.credits,
    };
    const entitlements = {
      getUserEntitlementsByUserId: jest.fn().mockResolvedValue([]),
      ...overrides.entitlements,
    };
    const checkout = {
      createSession: jest
        .fn()
        .mockResolvedValue({ sessionId: 'o1', checkoutUrl: 'https://app/checkout/o1' }),
      ...overrides.checkout,
    };
    const service = new McpProxyService(
      prisma,
      credits as any,
      entitlements as any,
      checkout as any,
    );
    return { service, prisma, credits, entitlements, checkout };
  };

  const caller = { userId: 'user-1', isService: false, roles: [] };
  const call = (name = 'forecast') => ({
    jsonrpc: '2.0',
    id: 7,
    method: 'tools/call',
    params: { name },
  });

  const outcomeOf = (prisma: any) => prisma.mcpCall.create.mock.calls[0][0].data;

  beforeEach(() => {
    guard.mockResolvedValue({ ok: true, addresses: ['93.184.216.34'] });
    forward.mockReset();
    forward.mockResolvedValue({
      status: 200,
      ok: true,
      statusText: 'OK',
      body: '{"jsonrpc":"2.0","id":7,"result":{"content":[]}}',
      contentType: 'application/json',
    });
  });

  describe('what is free', () => {
    it('does not charge for the handshake', async () => {
      const { service, credits, prisma } = build();

      await service.handle(
        'weather',
        caller,
        { jsonrpc: '2.0', id: 1, method: 'initialize' },
        '{}',
      );

      expect(forward).toHaveBeenCalled();
      expect(credits.consume).not.toHaveBeenCalled();
      expect(outcomeOf(prisma).outcome).toBe('free');
    });

    it('does not charge for listing tools — a client cannot connect otherwise', async () => {
      const { service, credits } = build();

      await service.handle(
        'weather',
        caller,
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        '{}',
      );

      expect(credits.consume).not.toHaveBeenCalled();
    });

    it('charges nothing at all on a free server', async () => {
      const { service, credits } = build(server({ pricingMode: 'free' }));

      await service.handle('weather', caller, call(), '{}');

      expect(credits.consume).not.toHaveBeenCalled();
      expect(forward).toHaveBeenCalled();
    });
  });

  describe('a caller who cannot pay', () => {
    it('is refused before the operator’s server is troubled', async () => {
      const { service } = build(server(), {
        credits: { getBalance: jest.fn().mockResolvedValue({ balance: 1 }) },
      });

      const res = await service.handle('weather', caller, call(), '{}');

      expect(forward).not.toHaveBeenCalled();
      expect(res.status).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.result.isError).toBe(true);
      expect(body.id).toBe(7);
    });

    it('is told where to pay, so the agent can do something about it', async () => {
      const { service } = build(server(), {
        credits: { getBalance: jest.fn().mockResolvedValue({ balance: 0 }) },
      });

      const res = await service.handle('weather', caller, call(), '{}');
      const body = JSON.parse(res.body);

      expect(body.result.content[0].text).toContain('https://app/checkout/o1');
      expect(body.result.structuredContent).toMatchObject({ payment_required: true });
    });

    it('still refuses cleanly when the price is misconfigured', async () => {
      const { service } = build(server(), {
        credits: { getBalance: jest.fn().mockResolvedValue({ balance: 0 }) },
        checkout: { createSession: jest.fn().mockRejectedValue(new Error('no such price')) },
      });

      const res = await service.handle('weather', caller, call(), '{}');

      expect(res.status).toBe(200);
      expect(JSON.parse(res.body).result.isError).toBe(true);
    });

    it('is recorded as denied, with the reason', async () => {
      const { service, prisma } = build(server(), {
        credits: { getBalance: jest.fn().mockResolvedValue({ balance: 1 }) },
      });

      await service.handle('weather', caller, call(), '{}');

      expect(outcomeOf(prisma)).toMatchObject({ outcome: 'denied', toolName: 'forecast' });
      expect(outcomeOf(prisma).detail).toMatch(/insufficient credits/);
    });
  });

  describe('entitlement pricing', () => {
    const gated = server({ pricingMode: 'entitlement', requiredEntitlement: 'access.pro' });

    it('lets a holder through without charging credits', async () => {
      const { service, credits } = build(gated, {
        entitlements: {
          getUserEntitlementsByUserId: jest
            .fn()
            .mockResolvedValue([{ key: 'access.pro', status: 'active' }]),
        },
      });

      await service.handle('weather', caller, call(), '{}');

      expect(forward).toHaveBeenCalled();
      expect(credits.consume).toHaveBeenCalled();
    });

    it('refuses somebody who does not hold it', async () => {
      const { service } = build(gated);

      const res = await service.handle('weather', caller, call(), '{}');

      expect(forward).not.toHaveBeenCalled();
      expect(JSON.parse(res.body).result.content[0].text).toContain('access.pro');
    });

    it('does not count a revoked entitlement', async () => {
      const { service } = build(gated, {
        entitlements: {
          getUserEntitlementsByUserId: jest
            .fn()
            .mockResolvedValue([{ key: 'access.pro', status: 'revoked' }]),
        },
      });

      await service.handle('weather', caller, call(), '{}');

      expect(forward).not.toHaveBeenCalled();
    });
  });

  describe('a call that goes through', () => {
    it('charges only after the upstream answered', async () => {
      const { service, credits } = build();

      await service.handle('weather', caller, call(), '{"raw":true}');

      const forwardOrder = forward.mock.invocationCallOrder[0];
      const chargeOrder = credits.consume.mock.invocationCallOrder[0];
      expect(forwardOrder).toBeLessThan(chargeOrder);
    });

    it('passes the body through untouched and adds the operator’s headers', async () => {
      const { service } = build();

      await service.handle('weather', caller, call(), '{"raw":true}');

      const sent = forward.mock.calls[0][0];
      expect(sent.body).toBe('{"raw":true}');
      expect(sent.headers['X-Operator-Key']).toBe('secret');
      expect(sent.url).toBe('https://tools.example.com/mcp');
    });

    it('charges the operator’s service, not the platform', async () => {
      const { service, credits } = build();

      await service.handle('weather', caller, call(), '{}');

      expect(credits.consume).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', serviceId: 'svc-a', amount: 2 }),
      );
    });

    it('bills through a metered feature when the operator named one', async () => {
      const { service, credits } = build(
        server({ featureCode: 'mcp.weather', creditsPerCall: null }),
      );

      await service.handle('weather', caller, call(), '{}');

      expect(credits.consume).toHaveBeenCalledWith(
        expect.objectContaining({ featureCode: 'mcp.weather', units: 1 }),
      );
    });

    it('hands the upstream’s answer back as it came', async () => {
      const { service } = build();

      const res = await service.handle('weather', caller, call(), '{}');

      expect(res.status).toBe(200);
      expect(res.body).toBe('{"jsonrpc":"2.0","id":7,"result":{"content":[]}}');
    });
  });

  describe('when the upstream misbehaves', () => {
    it('does not charge for a server that errored', async () => {
      forward.mockResolvedValue({ status: 500, ok: false, statusText: 'err', body: 'boom' });
      const { service, credits, prisma } = build();

      await service.handle('weather', caller, call(), '{}');

      expect(credits.consume).not.toHaveBeenCalled();
      expect(outcomeOf(prisma).outcome).toBe('upstream_error');
    });

    it('answers a JSON-RPC error when it cannot be reached at all', async () => {
      forward.mockRejectedValue(new Error('ECONNREFUSED'));
      const { service, credits } = build();

      const res = await service.handle('weather', caller, call(), '{}');

      expect(res.status).toBe(502);
      expect(JSON.parse(res.body).error.code).toBe(-32603);
      expect(credits.consume).not.toHaveBeenCalled();
    });

    it('refuses to forward to an upstream that resolves somewhere private', async () => {
      guard.mockResolvedValue({ ok: false, reason: 'resolves_to_private' });
      const { service } = build();

      const res = await service.handle('weather', caller, call(), '{}');

      expect(forward).not.toHaveBeenCalled();
      expect(res.status).toBe(502);
    });
  });

  describe('when the charge fails after the work was done', () => {
    it('still returns the answer, and records that nobody paid', async () => {
      const { service, prisma } = build(server(), {
        credits: {
          getBalance: jest.fn().mockResolvedValue({ balance: 10 }),
          consume: jest.fn().mockResolvedValue({
            success: false,
            remainingBalance: 0,
            error: 'Insufficient credits',
          }),
        },
      });

      const res = await service.handle('weather', caller, call(), '{}');

      expect(res.status).toBe(200);
      expect(outcomeOf(prisma)).toMatchObject({ outcome: 'unpaid', creditsCharged: 0 });
    });
  });

  describe('the server itself', () => {
    it('is a 404 when the slug is unknown or switched off', async () => {
      const { service } = build(null);

      await expect(service.handle('nope', caller, call(), '{}')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('only ever resolves an active one', async () => {
      const { service, prisma } = build();

      await service.handle('weather', caller, call(), '{}');

      expect(prisma.mcpServer.findFirst).toHaveBeenCalledWith({
        where: { slug: 'weather', isActive: true },
      });
    });
  });

  describe('the call log', () => {
    it('records the successful call with what it cost', async () => {
      const { service, prisma } = build();

      await service.handle('weather', caller, call('forecast'), '{}');

      expect(outcomeOf(prisma)).toMatchObject({
        mcpServerId: 'srv-1',
        userId: 'user-1',
        method: 'tools/call',
        toolName: 'forecast',
        outcome: 'ok',
      });
      expect(outcomeOf(prisma).latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('never fails the call it is describing', async () => {
      const { service, prisma } = build();
      prisma.mcpCall.create.mockRejectedValue(new Error('log table is gone'));

      await expect(service.handle('weather', caller, call(), '{}')).resolves.toMatchObject({
        status: 200,
      });
    });
  });
});
