import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/services/prisma.service';
import { EmbeddingsService } from './embeddings.service';

export function buildProductContent(product: {
  name: string;
  type: string;
  metadata?: any;
  service?: { name: string } | null;
}): string {
  const metadata = (product.metadata ?? {}) as Record<string, any>;
  const parts = [
    product.name,
    typeof metadata.description === 'string' ? metadata.description : '',
    Array.isArray(metadata.features) ? metadata.features.join('\n') : '',
    `service:${product.service?.name ?? 'unknown'} type:${product.type}`,
  ];
  return parts.filter(Boolean).join('\n');
}

@Injectable()
@Processor('embeddings')
export class ProductEmbeddingProcessor extends WorkerHost {
  private readonly logger = new Logger(ProductEmbeddingProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingsService: EmbeddingsService,
    @InjectQueue('embeddings') private readonly embeddingsQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<{ productId: string }>): Promise<void> {
    if (!this.embeddingsService.enabled) return;

    const product = await this.prisma.product.findUnique({
      where: { id: job.data.productId },
      include: { service: { select: { name: true } } },
    });
    if (!product) return;

    const content = buildProductContent(product);
    const contentHash = createHash('sha256').update(content).digest('hex');

    const existing = await this.prisma.productEmbedding.findUnique({
      where: { productId: product.id },
      select: { contentHash: true },
    });
    if (existing?.contentHash === contentHash) return; // unchanged

    const vectors = await this.embeddingsService.embed([content]);
    if (!vectors || vectors.length === 0) return;

    const vectorLiteral = `[${vectors[0].join(',')}]`;
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO billing.product_embeddings
        (id, product_id, content, content_hash, embedding, model, updated_at)
      VALUES
        (gen_random_uuid(), ${product.id}::uuid, ${content}, ${contentHash},
         ${vectorLiteral}::vector, ${this.embeddingsService.model}, NOW())
      ON CONFLICT (product_id) DO UPDATE SET
        content = EXCLUDED.content,
        content_hash = EXCLUDED.content_hash,
        embedding = EXCLUDED.embedding,
        model = EXCLUDED.model,
        updated_at = NOW()
    `);
    this.logger.log(`Embedded product ${product.id} (${product.name})`);
  }

  /** Nightly reconcile: enqueue active products with missing/stale embeddings. */
  @Cron('0 0 3 * * *')
  async reconcile(): Promise<void> {
    if (!this.embeddingsService.enabled) return;

    const products = await this.prisma.product.findMany({
      where: { isActive: true },
      include: { service: { select: { name: true } } },
    });
    const embeddings = await this.prisma.productEmbedding.findMany({
      select: { productId: true, contentHash: true },
    });
    const hashByProduct = new Map(
      embeddings.map((e) => [e.productId, e.contentHash]),
    );

    let enqueued = 0;
    for (const product of products) {
      const hash = createHash('sha256')
        .update(buildProductContent(product))
        .digest('hex');
      if (hashByProduct.get(product.id) === hash) continue;
      await this.embeddingsQueue.add(
        'embed-product',
        { productId: product.id },
        { jobId: `reconcile:${product.id}:${hash.slice(0, 12)}` },
      );
      enqueued++;
    }
    if (enqueued > 0) {
      this.logger.log(`Embedding reconcile enqueued ${enqueued} products`);
    }
  }
}
