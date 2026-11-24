import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { ServiceCatalogController } from './service-catalog.controller';
import { CatalogService } from './catalog.service';
import { PrismaService } from '../common/services/prisma.service';
import { ConnectorsModule } from '../common/connectors/connectors.module';
import { PayabilityService } from '../checkout/payability.service';
import { RagModule } from '../rag/rag.module';

@Module({
  imports: [RagModule, ConnectorsModule],
  controllers: [CatalogController, ServiceCatalogController],
  providers: [CatalogService, PayabilityService, PrismaService],
  exports: [CatalogService],
})
export class CatalogModule {}
