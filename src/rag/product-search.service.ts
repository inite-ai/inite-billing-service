import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/services/prisma.service';
import { EmbeddingsService } from './embeddings.service';

@Injectable()
export class ProductSearchService {
  private readonly logger = new Logger(ProductSearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingsService: EmbeddingsService,
  ) {}

  /**
   * Semantic product search via pgvector cosine similarity.
   * Falls back to ILIKE when embeddings are disabled or none are indexed.
   */
  async semanticSearchProducts(
    query: string,
    options: { limit?: number; serviceId?: string } = {},
  ) {
    const limit = Math.min(Math.max(options.limit ?? 5, 1), 20);

    if (this.embeddingsService.enabled) {
      try {
        const vectors = await this.embeddingsService.embed([query]);
        if (vectors && vectors.length > 0) {
          const vectorLiteral = `[${vectors[0].join(',')}]`;
          const rows = await this.prisma.$queryRaw<
            Array<{ product_id: string; score: number }>
          >(Prisma.sql`
            SELECT pe.product_id, 1 - (pe.embedding <=> ${vectorLiteral}::vector) AS score
            FROM billing.product_embeddings pe
            JOIN billing.products p ON p.id = pe.product_id
            WHERE p.is_active = true
              AND pe.embedding IS NOT NULL
              ${options.serviceId ? Prisma.sql`AND p.service_id = ${options.serviceId}::uuid` : Prisma.empty}
            ORDER BY pe.embedding <=> ${vectorLiteral}::vector
            LIMIT ${limit}
          `);

          if (rows.length > 0) {
            const scoreById = new Map(rows.map((r) => [r.product_id, r.score]));
            const products = await this.prisma.product.findMany({
              where: { id: { in: rows.map((r) => r.product_id) } },
              include: {
                prices: { where: { isActive: true } },
                service: { select: { id: true, code: true, name: true } },
              },
            });
            return products
              .map((p) => ({ ...p, score: scoreById.get(p.id) ?? 0 }))
              .sort((a, b) => b.score - a.score);
          }
        }
      } catch (error: any) {
        this.logger.warn(`Semantic search failed, falling back to ILIKE: ${error.message}`);
      }
    }

    // Fallback: naive substring match on name/code
    const products = await this.prisma.product.findMany({
      where: {
        isActive: true,
        ...(options.serviceId ? { serviceId: options.serviceId } : {}),
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { code: { contains: query, mode: 'insensitive' } },
        ],
      },
      include: {
        prices: { where: { isActive: true } },
        service: { select: { id: true, code: true, name: true } },
      },
      take: limit,
    });
    return products.map((p) => ({ ...p, score: null }));
  }

  /**
   * Fuzzy admin order search via pg_trgm (userId / externalId / product name).
   * Embeddings for orders are deliberately not used — IDs don't embed usefully.
   */
  async fuzzySearchOrders(query: string, options: { page?: number; limit?: number } = {}) {
    const page = Math.max(options.page ?? 1, 1);
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);

    const rows = await this.prisma.$queryRaw<Array<{ id: string; rank: number }>>(
      Prisma.sql`
        SELECT o.id,
               GREATEST(
                 similarity(o.user_id, ${query}),
                 COALESCE(similarity(o.external_id, ${query}), 0),
                 COALESCE(similarity(p.name, ${query}), 0)
               ) AS rank
        FROM billing.orders o
        LEFT JOIN billing.prices pr ON pr.id = o.price_id
        LEFT JOIN billing.products p ON p.id = pr.product_id
        WHERE o.user_id % ${query}
           OR o.external_id % ${query}
           OR COALESCE(similarity(p.name, ${query}), 0) > 0.3
        ORDER BY rank DESC
        LIMIT ${limit} OFFSET ${(page - 1) * limit}
      `,
    );

    if (rows.length === 0) {
      return { items: [], total: 0, page, limit };
    }

    const rankById = new Map(rows.map((r) => [r.id, r.rank]));
    const orders = await this.prisma.order.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      include: { price: { include: { product: true } } },
    });
    const items = orders
      .map((o) => ({ ...o, rank: rankById.get(o.id) ?? 0 }))
      .sort((a, b) => b.rank - a.rank);

    return { items, total: items.length, page, limit };
  }
}
