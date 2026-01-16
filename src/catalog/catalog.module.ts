import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { PrismaService } from '../common/services/prisma.service';

@Module({
  controllers: [CatalogController],
  providers: [CatalogService, PrismaService],
  exports: [CatalogService],
})
export class CatalogModule {}

