import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';
import { assertPublicUrl } from '../workers/ssrf-guard';

export interface RegisterMcpServerInput {
  slug: string;
  name: string;
  description?: string;
  upstreamUrl: string;
  upstreamHeaders?: Record<string, unknown>;
  pricingMode?: 'free' | 'per_call' | 'entitlement';
  creditsPerCall?: number;
  featureCode?: string;
  requiredEntitlement?: string;
  priceCode?: string;
  isActive?: boolean;
  metadata?: Record<string, unknown>;
}

const SLUG = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const PRICING_MODES = ['free', 'per_call', 'entitlement'] as const;

/**
 * `upstream_headers` holds the operator's own credentials for their own server
 * — the same kind of secret as a payment provider's API key, and treated the
 * same way: written, never read back, merged rather than replaced so saving one
 * field cannot silently wipe another.
 */
function withoutSecrets<T extends { upstreamHeaders?: unknown }>(server: T) {
  const { upstreamHeaders, ...rest } = server;
  const keys =
    upstreamHeaders && typeof upstreamHeaders === 'object'
      ? Object.keys(upstreamHeaders as Record<string, unknown>)
      : [];
  return { ...rest, upstreamHeaderKeys: keys };
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function mergeHeaders(stored: unknown, patch: unknown): Record<string, unknown> | undefined {
  if (patch === undefined) return undefined;
  const base = new Map<string, unknown>(
    stored && typeof stored === 'object'
      ? Object.entries(stored as Record<string, unknown>).filter(([k]) => !UNSAFE_KEYS.has(k))
      : [],
  );
  if (patch && typeof patch === 'object') {
    for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
      if (UNSAFE_KEYS.has(key)) continue;
      if (value === null) base.delete(key);
      else base.set(key, value);
    }
  }
  return Object.fromEntries(base);
}

/**
 * Registration and upkeep of proxied MCP servers.
 *
 * An operator is a registered service, and a service only ever sees and edits
 * its own servers — the slug namespace is shared, but nothing else is.
 */
@Injectable()
export class McpServersService {
  private readonly logger = new Logger(McpServersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(serviceId: string) {
    const servers = await this.prisma.mcpServer.findMany({
      where: { serviceId },
      orderBy: { createdAt: 'desc' },
    });
    return servers.map(withoutSecrets);
  }

  async get(serviceId: string, id: string) {
    const server = await this.prisma.mcpServer.findFirst({ where: { id, serviceId } });
    // A server belonging to another operator is not this caller's to know about.
    if (!server) throw new NotFoundException(`MCP server not found: ${id}`);
    return withoutSecrets(server);
  }

  async register(serviceId: string, input: RegisterMcpServerInput) {
    await this.validate(input, input.pricingMode ?? 'per_call');

    const existing = await this.prisma.mcpServer.findUnique({ where: { slug: input.slug } });
    if (existing) {
      throw new BadRequestException(`The slug "${input.slug}" is taken`);
    }

    const created = await this.prisma.mcpServer.create({
      data: {
        serviceId,
        slug: input.slug,
        name: input.name,
        description: input.description,
        upstreamUrl: input.upstreamUrl,
        upstreamHeaders: (input.upstreamHeaders ?? {}) as any,
        pricingMode: input.pricingMode ?? 'per_call',
        creditsPerCall: input.creditsPerCall,
        featureCode: input.featureCode,
        requiredEntitlement: input.requiredEntitlement,
        priceCode: input.priceCode,
        isActive: input.isActive ?? true,
        metadata: (input.metadata ?? {}) as any,
      },
    });

    this.logger.log(`Registered MCP server ${created.slug} for service ${serviceId}`);
    return withoutSecrets(created);
  }

  async update(serviceId: string, id: string, input: Partial<RegisterMcpServerInput>) {
    const server = await this.prisma.mcpServer.findFirst({ where: { id, serviceId } });
    if (!server) throw new NotFoundException(`MCP server not found: ${id}`);

    const pricingMode = input.pricingMode ?? (server.pricingMode as any);
    await this.validate({ ...server, ...input } as RegisterMcpServerInput, pricingMode, {
      slugChanged: Boolean(input.slug && input.slug !== server.slug),
      urlChanged: Boolean(input.upstreamUrl && input.upstreamUrl !== server.upstreamUrl),
    });

    if (input.slug && input.slug !== server.slug) {
      const taken = await this.prisma.mcpServer.findUnique({ where: { slug: input.slug } });
      if (taken) throw new BadRequestException(`The slug "${input.slug}" is taken`);
    }

    const updated = await this.prisma.mcpServer.update({
      where: { id },
      data: {
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.upstreamUrl !== undefined ? { upstreamUrl: input.upstreamUrl } : {}),
        ...(input.pricingMode !== undefined ? { pricingMode: input.pricingMode } : {}),
        ...(input.creditsPerCall !== undefined ? { creditsPerCall: input.creditsPerCall } : {}),
        ...(input.featureCode !== undefined ? { featureCode: input.featureCode } : {}),
        ...(input.requiredEntitlement !== undefined
          ? { requiredEntitlement: input.requiredEntitlement }
          : {}),
        ...(input.priceCode !== undefined ? { priceCode: input.priceCode } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata as any } : {}),
        upstreamHeaders: mergeHeaders(server.upstreamHeaders, input.upstreamHeaders) as any,
      },
    });

    return withoutSecrets(updated);
  }

  async remove(serviceId: string, id: string) {
    const server = await this.prisma.mcpServer.findFirst({ where: { id, serviceId } });
    if (!server) throw new NotFoundException(`MCP server not found: ${id}`);
    await this.prisma.mcpServer.delete({ where: { id } });
    return { deleted: true, slug: server.slug };
  }

  /**
   * What the operator is owed and what their callers did.
   *
   * Deliberately includes the calls nobody paid for: an operator who cannot see
   * `unpaid` and `denied` cannot tell a pricing mistake from a quiet week.
   */
  async usage(serviceId: string, id: string, days = 30) {
    const server = await this.prisma.mcpServer.findFirst({ where: { id, serviceId } });
    if (!server) throw new NotFoundException(`MCP server not found: ${id}`);

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const [byOutcome, credits, recent] = await Promise.all([
      this.prisma.mcpCall.groupBy({
        by: ['outcome'],
        where: { mcpServerId: id, createdAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.mcpCall.aggregate({
        where: { mcpServerId: id, createdAt: { gte: since } },
        _sum: { creditsCharged: true },
      }),
      this.prisma.mcpCall.findMany({
        where: { mcpServerId: id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);

    return {
      slug: server.slug,
      since: since.toISOString(),
      calls: Object.fromEntries(byOutcome.map((row) => [row.outcome, row._count._all])),
      creditsCharged: credits._sum.creditsCharged ?? 0,
      recent,
    };
  }

  /**
   * Every operator's servers with their traffic, for the platform admin.
   *
   * Two grouped queries rather than one per server, so the page costs the same
   * with three servers as with three hundred. A server with no calls in the
   * window still appears, with zeroes — a silent server is the thing an admin
   * most needs to notice.
   */
  async overview(days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const [servers, byOutcome, credits] = await Promise.all([
      this.prisma.mcpServer.findMany({
        orderBy: { createdAt: 'desc' },
        include: { service: { select: { id: true, code: true, name: true } } },
      }),
      this.prisma.mcpCall.groupBy({
        by: ['mcpServerId', 'outcome'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.mcpCall.groupBy({
        by: ['mcpServerId'],
        where: { createdAt: { gte: since } },
        _sum: { creditsCharged: true },
      }),
    ]);

    const calls = new Map<string, Record<string, number>>();
    for (const row of byOutcome) {
      const bucket = calls.get(row.mcpServerId) ?? {};
      bucket[row.outcome] = row._count._all;
      calls.set(row.mcpServerId, bucket);
    }
    const charged = new Map(credits.map((row) => [row.mcpServerId, row._sum.creditsCharged ?? 0]));

    return {
      since: since.toISOString(),
      servers: servers.map((server) => ({
        ...withoutSecrets(server),
        calls: calls.get(server.id) ?? {},
        creditsCharged: charged.get(server.id) ?? 0,
      })),
    };
  }

  /** Which operator a server is filed under — the admin acts in their name. */
  async operatorOf(id: string): Promise<string> {
    const server = await this.prisma.mcpServer.findUnique({
      where: { id },
      select: { serviceId: true },
    });
    if (!server) throw new NotFoundException(`MCP server not found: ${id}`);
    return server.serviceId;
  }

  /**
   * Everything that would otherwise fail at the first call instead of at
   * registration, when the operator is watching.
   */
  private async validate(
    input: RegisterMcpServerInput,
    pricingMode: string,
    changed: { slugChanged?: boolean; urlChanged?: boolean } = {
      slugChanged: true,
      urlChanged: true,
    },
  ): Promise<void> {
    if (changed.slugChanged !== false && !SLUG.test(input.slug ?? '')) {
      throw new BadRequestException(
        'slug must be 3-64 characters of lowercase letters, digits and hyphens, and start and end with one of the first two',
      );
    }

    if (!PRICING_MODES.includes(pricingMode as any)) {
      throw new BadRequestException(`pricingMode must be one of: ${PRICING_MODES.join(', ')}`);
    }

    if (pricingMode === 'per_call' && !input.featureCode) {
      const credits = input.creditsPerCall;
      if (typeof credits !== 'number' || credits < 0) {
        throw new BadRequestException(
          'per_call pricing needs creditsPerCall (a non-negative integer) or a featureCode to charge through',
        );
      }
    }

    if (pricingMode === 'entitlement' && !input.requiredEntitlement) {
      throw new BadRequestException('entitlement pricing needs requiredEntitlement');
    }

    if (changed.urlChanged !== false) {
      // Checked here so a bad or private upstream is refused while the operator
      // is looking at the form, not silently at the first call. It is checked
      // again on every forward, because DNS can change under us.
      const guard = await assertPublicUrl(input.upstreamUrl ?? '');
      if (!guard.ok) {
        throw new BadRequestException(`upstreamUrl was rejected: ${guard.reason}`);
      }
    }
  }
}
