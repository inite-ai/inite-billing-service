import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PrismaService } from '../common/services/prisma.service';

@Module({
  controllers: [OrdersController],
  providers: [OrdersService, PrismaService],
  exports: [OrdersService],
})
export class OrdersModule {}
