import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import Anthropic from '@anthropic-ai/sdk';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/services/prisma.service';
import { ANTHROPIC_CLIENT } from '../common/anthropic/anthropic.constants';
import { AnthropicConfigService } from '../common/anthropic/anthropic-config.service';

export interface Offer {
  productId: string;
  code: string;
  name: string;
  serviceName: string | null;
  priceId: string | null;
  priceCode: string | null;
  amount: string | null;
  currency: string | null;
  interval: string | null;
  reason: 'upgrade' | 'abandoned' | 'cross_sell' | 'popular_with' | 'top_seller';
  score: number;
  explanation?: string;
}

const RULE_SCORES = {
  upgrade: 50,
  abandoned: 45,
  cross_sell: 35,
  popular_with: 25,
  top_seller: 10,
} as const;

@Injectable()
export class RecommendationsService {
  private readonly logger = new Logger(RecommendationsService.name);
  private redis: Redis | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly anthropicConfig: AnthropicConfigService,
    @Optional() @Inject(ANTHROPIC_CLIENT) private readonly anthropic?: Anthropic,
  ) {}

  private getRedis(): Redis | null {
    if (this.redis) return this.redis;
    const url = this.config.get<string>('REDIS_URL');
    if (!url) return null;
    try {
      this.redis = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true });
      this.redis.on('error', () => undefined);
      return this.redis;
    } catch {
      return null;
    }
  }

  async getNextBestOffers(
    userId: string,
    options: {
      surface?: 'dashboard' | 'checkout' | 'assistant';
      sessionProductId?: string;
      limit?: number;
      explain?: boolean;
      locale?: string;
    } = {},
  ): Promise<Offer[]> {
    const limit = Math.min(Math.max(options.limit ?? 3, 1), 10);

    const [paidOrders, subscriptions, entitlements, recentEvents, catalog] =
      await Promise.all([
        this.prisma.order.findMany({
          where: { userId, status: 'paid' },
          include: { price: { include: { product: true } } },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
        this.prisma.subscription.findMany({
          where: { userId, status: { in: ['active', 'trialing'] } },
          include: { price: { include: { product: true } } },
        }),
        this.prisma.entitlement.findMany({
          where: { userId, status: 'active' },
        }),
        this.prisma.funnelEvent.findMany({
          where: {
            userId,
            eventType: { in: ['catalog_view', 'checkout_abandoned'] },
            createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) },
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
        this.prisma.product.findMany({
          where: { isActive: true },
          include: {
            prices: { where: { isActive: true } },
            service: { select: { id: true, name: true } },
          },
        }),
      ]);

    const ownedProductIds = new Set<string>();
    for (const order of paidOrders) {
      if (order.price?.product?.id) ownedProductIds.add(order.price.product.id);
    }
    for (const sub of subscriptions) {
      if (sub.price?.product?.id) ownedProductIds.add(sub.price.product.id);
    }
    // Exclude the product currently being bought in this checkout session
    if (options.sessionProductId) ownedProductIds.add(options.sessionProductId);

    const candidates: Offer[] = [];
    const push = (
      product: (typeof catalog)[number],
      reason: Offer['reason'],
      extraScore = 0,
    ) => {
      if (ownedProductIds.has(product.id)) return;
      const price = product.prices[0] ?? null;
      candidates.push({
        productId: product.id,
        code: product.code,
        name: product.name,
        serviceName: product.service?.name ?? null,
        priceId: price?.id ?? null,
        priceCode: price?.code ?? null,
        amount: price ? String(price.amount) : null,
        currency: price?.currency ?? null,
        interval: price?.interval ?? null,
        reason,
        score: RULE_SCORES[reason] + extraScore,
      });
    };

    // Rule: upgrade — pricier subscription products in services the user subscribes to
    for (const sub of subscriptions) {
      const currentProduct = sub.price?.product;
      const currentAmount = Number(sub.price?.amount ?? 0);
      if (!currentProduct?.serviceId) continue;
      for (const product of catalog) {
        if (
          product.serviceId === currentProduct.serviceId &&
          product.type === 'subscription' &&
          product.id !== currentProduct.id &&
          product.prices.some((p) => Number(p.amount) > currentAmount)
        ) {
          push(product, 'upgrade');
        }
      }
    }

    // Rule: abandoned — products from recent abandoned checkouts, still unowned
    for (const event of recentEvents) {
      if (event.eventType !== 'checkout_abandoned' || !event.productId) continue;
      const product = catalog.find((p) => p.id === event.productId);
      if (product) push(product, 'abandoned');
    }

    // Rule: cross_sell — other products in services where the user has entitlements/subs
    const engagedServiceIds = new Set<string>();
    for (const sub of subscriptions) {
      const sid = sub.price?.product?.serviceId;
      if (sid) engagedServiceIds.add(sid);
    }
    for (const entitlement of entitlements) {
      const product = catalog.find((p) => p.code === entitlement.key);
      if (product?.serviceId) engagedServiceIds.add(product.serviceId);
    }
    for (const product of catalog) {
      if (product.serviceId && engagedServiceIds.has(product.serviceId)) {
        push(product, 'cross_sell');
      }
    }

    // Rule: popular_with — co-purchase graph (cached 1h per anchor product)
    for (const anchorId of [...ownedProductIds].slice(0, 5)) {
      const coIds = await this.getCoPurchasedProductIds(anchorId);
      for (const coId of coIds) {
        const product = catalog.find((p) => p.id === coId);
        if (product) push(product, 'popular_with');
      }
    }

    // Rule: top_seller fallback — most purchased products in the last 90 days
    if (candidates.length < limit) {
      const topSellers = await this.getTopSellerProductIds();
      for (const topId of topSellers) {
        const product = catalog.find((p) => p.id === topId);
        if (product) push(product, 'top_seller');
      }
    }

    // Popularity boost + dedupe keeping the best-scored reason
    const popularity = await this.getPopularityMap(
      candidates.map((c) => c.productId),
    );
    const byProduct = new Map<string, Offer>();
    for (const candidate of candidates) {
      candidate.score += Math.log1p(popularity.get(candidate.productId) ?? 0);
      const existing = byProduct.get(candidate.productId);
      if (!existing || candidate.score > existing.score) {
        byProduct.set(candidate.productId, candidate);
      }
    }

    const offers = [...byProduct.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    if (options.explain && this.config.get('RECS_LLM_EXPLAIN') === 'true') {
      await this.attachExplanations(userId, offers, options.locale ?? 'en');
    }

    return offers;
  }

  private async getCoPurchasedProductIds(productId: string): Promise<string[]> {
    const redis = this.getRedis();
    const cacheKey = `nbo:copurchase:${productId}`;
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) return JSON.parse(cached);
      } catch {
        // cache miss path below
      }
    }

    const rows = await this.prisma.$queryRaw<Array<{ product_id: string }>>(
      Prisma.sql`
        SELECT pr2.product_id, COUNT(*) AS cnt
        FROM billing.orders o1
        JOIN billing.prices pr1 ON pr1.id = o1.price_id AND pr1.product_id = ${productId}::uuid
        JOIN billing.orders o2 ON o2.user_id = o1.user_id AND o2.status = 'paid' AND o2.id <> o1.id
        JOIN billing.prices pr2 ON pr2.id = o2.price_id AND pr2.product_id <> ${productId}::uuid
        WHERE o1.status = 'paid'
        GROUP BY pr2.product_id
        ORDER BY cnt DESC
        LIMIT 5
      `,
    );
    const ids = rows.map((r) => r.product_id);
    if (redis) {
      try {
        await redis.set(cacheKey, JSON.stringify(ids), 'EX', 3600);
      } catch {
        // best-effort cache
      }
    }
    return ids;
  }

  private async getTopSellerProductIds(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ product_id: string }>>(
      Prisma.sql`
        SELECT pr.product_id, COUNT(*) AS cnt
        FROM billing.orders o
        JOIN billing.prices pr ON pr.id = o.price_id
        WHERE o.status = 'paid'
          AND o.created_at >= NOW() - INTERVAL '90 days'
        GROUP BY pr.product_id
        ORDER BY cnt DESC
        LIMIT 5
      `,
    );
    return rows.map((r) => r.product_id);
  }

  private async getPopularityMap(
    productIds: string[],
  ): Promise<Map<string, number>> {
    if (productIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<
      Array<{ product_id: string; cnt: bigint }>
    >(Prisma.sql`
      SELECT pr.product_id, COUNT(*)::bigint AS cnt
      FROM billing.orders o
      JOIN billing.prices pr ON pr.id = o.price_id
      WHERE o.status = 'paid'
        AND pr.product_id IN (${Prisma.join(productIds)})
      GROUP BY pr.product_id
    `);
    return new Map(rows.map((r) => [r.product_id, Number(r.cnt)]));
  }

  /** Optional one-shot localized "why this fits" lines, Redis-cached 24h. */
  private async attachExplanations(
    userId: string,
    offers: Offer[],
    locale: string,
  ): Promise<void> {
    if (!this.anthropic || offers.length === 0) return;
    const redis = this.getRedis();

    const uncached: Offer[] = [];
    for (const offer of offers) {
      const key = `nbo:explain:${userId}:${offer.productId}:${locale}`;
      if (redis) {
        try {
          const cached = await redis.get(key);
          if (cached) {
            offer.explanation = cached;
            continue;
          }
        } catch {
          // fall through to generation
        }
      }
      uncached.push(offer);
    }
    if (uncached.length === 0) return;

    try {
      const response = await this.anthropic.messages.create(
        {
          ...this.anthropicConfig.messageParams({ maxTokens: 400 }),
          system: `Write one short sentence per offer explaining why it fits, in ${
            locale === 'ru' ? 'Russian' : 'English'
          }. Output STRICT JSON: {"explanations": {"<productId>": "<sentence>"}}. No other text.`,
          messages: [
            {
              role: 'user',
              content: JSON.stringify(
                uncached.map((o) => ({
                  productId: o.productId,
                  name: o.name,
                  service: o.serviceName,
                  reason: o.reason,
                })),
              ),
            },
          ],
        },
        { signal: AbortSignal.timeout(15_000), maxRetries: 0 },
      );
      const text =
        response.content[0]?.type === 'text' ? response.content[0].text : '';
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return;
      const parsed = JSON.parse(match[0]) as {
        explanations?: Record<string, string>;
      };
      for (const offer of uncached) {
        const explanation = parsed.explanations?.[offer.productId];
        if (explanation) {
          offer.explanation = explanation;
          if (redis) {
            try {
              await redis.set(
                `nbo:explain:${userId}:${offer.productId}:${locale}`,
                explanation,
                'EX',
                86400,
              );
            } catch {
              // best-effort cache
            }
          }
        }
      }
    } catch (error: any) {
      this.logger.warn(`NBO explanation generation failed: ${error.message}`);
    }
  }
}
