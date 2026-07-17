import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { InsightsService } from './insights.service';

@ApiTags('Admin')
@Controller('v1/admin/insights')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Throttle({ default: { limit: 5, ttl: 60000 } })
export class InsightsController {
  constructor(private readonly insightsService: InsightsService) {}

  @Post('funnel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'AI narrative explanation of funnel metrics (cached 6h)' })
  async explainFunnel(
    @Body()
    body: {
      serviceId?: string;
      from?: string;
      to?: string;
      granularity?: 'day' | 'week' | 'month';
      locale?: string;
      force?: boolean;
    },
  ) {
    return this.insightsService.explainFunnel({
      serviceId: body.serviceId,
      from: body.from ? new Date(body.from) : undefined,
      to: body.to ? new Date(body.to) : undefined,
      granularity: body.granularity,
      locale: body.locale,
      force: body.force === true,
    });
  }
}
