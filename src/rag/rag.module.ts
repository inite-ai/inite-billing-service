import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EmbeddingsService } from './embeddings.service';
import { ProductEmbeddingProcessor } from './product-embedding.processor';
import { ProductSearchService } from './product-search.service';
import { PrismaService } from '../common/services/prisma.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'embeddings',
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      },
    }),
  ],
  providers: [EmbeddingsService, ProductEmbeddingProcessor, ProductSearchService, PrismaService],
  exports: [EmbeddingsService, ProductSearchService, BullModule],
})
export class RagModule {}
