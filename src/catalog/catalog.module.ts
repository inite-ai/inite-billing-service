import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { ServiceCatalogController } from './service-catalog.controller';
import { CatalogService } from './catalog.service';
import { PrismaService } from '../common/services/prisma.service';
import { RagModule } from '../rag/rag.module';

@Module({
  imports: [RagModule],
  controllers: [CatalogController, ServiceCatalogController],
  providers: [CatalogService, PrismaService],
  exports: [CatalogService],
})
export class CatalogModule {}
