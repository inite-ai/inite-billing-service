import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { BacklogService } from './backlog.service';
import { PrismaService } from '../common/services/prisma.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [HealthController],
  providers: [HealthService, BacklogService, PrismaService],
  exports: [BacklogService],
})
export class HealthModule {}
