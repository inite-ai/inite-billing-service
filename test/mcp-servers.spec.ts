jest.mock('../src/workers/ssrf-guard', () => ({
  assertPublicUrl: jest.fn().mockResolvedValue({ ok: true, addresses: ['93.184.216.34'] }),
}));

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { McpServersService } from '../src/mcp/mcp-servers.service';
import { assertPublicUrl } from '../src/workers/ssrf-guard';

const guard = assertPublicUrl as jest.Mock;

/**
 * Registering a server to be billed for. An operator only ever sees and edits
 * its own; its upstream credentials are written and never read back; and a
 * private or malformed upstream is refused while the operator is looking at the
 * form, not at the first call.
 */
describe('MCP server registration', () => {
  const row = (o: any = {}) => ({
    id: 'srv-1',
    serviceId: 'svc-a',
    slug: 'weather',
    name: 'Weather',
    upstreamUrl: 'https://tools.example.com/mcp',
    upstreamHeaders: { 'X-Key': 'secret-value' },
    pricingMode: 'per_call',
    creditsPerCall: 2,
    ...o,
  });

  const build = (existing: any = null, bySlug: any = null) => {
    const prisma: any = {
      mcpServer: {
        findFirst: jest.fn().mockResolvedValue(existing),
        findUnique: jest.fn().mockResolvedValue(bySlug),
        findMany: jest.fn().mockResolvedValue(existing ? [existing] : []),
        create: jest.fn().mockImplementation(({ data }: any) => ({ id: 'srv-new', ...data })),
        update: jest.fn().mockImplementation(({ data }: any) => ({ ...existing, ...data })),
        delete: jest.fn(),
      },
    };
    return { prisma, service: new McpServersService(prisma) };
  };

  const input = (o: any = {}) => ({
    slug: 'weather',
    name: 'Weather',
    upstreamUrl: 'https://tools.example.com/mcp',
    creditsPerCall: 2,
    ...o,
  });

  beforeEach(() => guard.mockResolvedValue({ ok: true, addresses: ['93.184.216.34'] }));

  it('files the server under the calling service', async () => {
    const { prisma, service } = build();
    await service.register('svc-a', input());
    expect(prisma.mcpServer.create.mock.calls[0][0].data.serviceId).toBe('svc-a');
  });

  it('never returns the operator’s upstream credentials', async () => {
    const { service } = build(row());
    const [listed] = (await service.list('svc-a')) as any[];
    expect(listed).not.toHaveProperty('upstreamHeaders');
    expect(JSON.stringify(listed)).not.toContain('secret-value');
    expect(listed.upstreamHeaderKeys).toEqual(['X-Key']);
  });

  it('refuses an upstream that resolves somewhere private', async () => {
    guard.mockResolvedValue({ ok: false, reason: 'resolves_to_private' });
    const { service } = build();
    await expect(service.register('svc-a', input())).rejects.toThrow(/resolves_to_private/);
  });

  it('refuses a slug that is taken', async () => {
    const { service } = build(null, row({ serviceId: 'svc-b' }));
    await expect(service.register('svc-a', input())).rejects.toThrow(/taken/);
  });

  it.each(['A', 'ab', '-weather', 'weather-', 'we ather', 'we_ather'])(
    'refuses the slug %p',
    async (slug) => {
      const { service } = build();
      await expect(service.register('svc-a', input({ slug }))).rejects.toBeInstanceOf(
        BadRequestException,
      );
    },
  );

  it('needs a price for per-call billing', async () => {
    const { service } = build();
    await expect(service.register('svc-a', input({ creditsPerCall: undefined }))).rejects.toThrow(
      /creditsPerCall/,
    );
  });

  it('accepts a metered feature in place of a flat price', async () => {
    const { service } = build();
    await expect(
      service.register('svc-a', input({ creditsPerCall: undefined, featureCode: 'mcp.weather' })),
    ).resolves.toBeDefined();
  });

  it('needs the entitlement for entitlement billing', async () => {
    const { service } = build();
    await expect(service.register('svc-a', input({ pricingMode: 'entitlement' }))).rejects.toThrow(
      /requiredEntitlement/,
    );
  });

  it('does not let one operator see or change another’s server', async () => {
    const { prisma, service } = build(null);
    await expect(service.get('svc-a', 'srv-1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.update('svc-a', 'srv-1', { name: 'x' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.remove('svc-a', 'srv-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.mcpServer.findFirst).toHaveBeenCalledWith({
      where: { id: 'srv-1', serviceId: 'svc-a' },
    });
  });

  it('keeps an upstream credential the update did not mention', async () => {
    const { prisma, service } = build(row());
    await service.update('svc-a', 'srv-1', { upstreamHeaders: { 'X-Other': 'b' } });
    expect(prisma.mcpServer.update.mock.calls[0][0].data.upstreamHeaders).toEqual({
      'X-Key': 'secret-value',
      'X-Other': 'b',
    });
  });

  it('does not re-check the upstream when it did not change', async () => {
    const { service } = build(row());
    guard.mockClear();
    await service.update('svc-a', 'srv-1', { name: 'Renamed' });
    expect(guard).not.toHaveBeenCalled();
  });
});
