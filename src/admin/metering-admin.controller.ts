import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { MeteringService } from '../credits/metering.service';

class CreateFeatureDto {
  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsUUID()
  serviceId?: string;

  @IsIn(['tokens', 'requests', 'generations', 'seconds'])
  unit: string;

  @IsNumber()
  @Min(0)
  creditsPerUnit: number;

  @IsOptional()
  @IsObject()
  tierRates?: Record<string, number>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class UpdateFeatureDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(['tokens', 'requests', 'generations', 'seconds'])
  unit?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  creditsPerUnit?: number;

  @IsOptional()
  @IsObject()
  tierRates?: Record<string, number>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class CreateQuotaDto {
  @IsOptional()
  @IsUUID()
  featureId?: string;

  @IsOptional()
  @IsUUID()
  serviceId?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsIn(['day', 'week', 'month', 'billing_period'])
  window: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  limitUnits?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  limitCredits?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  softCapPct?: number;

  @IsOptional()
  @IsIn(['block', 'notify_only'])
  overagePolicy?: string;
}

class UpdateQuotaDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  limitUnits?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  limitCredits?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  softCapPct?: number;

  @IsOptional()
  @IsIn(['block', 'notify_only'])
  overagePolicy?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

@ApiTags('Admin')
@Controller('v1/admin/metering')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class MeteringAdminController {
  constructor(private readonly meteringService: MeteringService) {}

  // ─── Features ──────────────────────────────────────────────

  @Get('features')
  @ApiOperation({ summary: 'List metered features (incl. inactive)' })
  async listFeatures() {
    return this.meteringService.listFeatures(true);
  }

  @Post('features')
  @ApiOperation({ summary: 'Create a metered feature' })
  async createFeature(@Body() body: CreateFeatureDto) {
    return this.meteringService.createFeature(body);
  }

  @Put('features/:id')
  @ApiOperation({ summary: 'Update a metered feature' })
  async updateFeature(@Param('id') id: string, @Body() body: UpdateFeatureDto) {
    return this.meteringService.updateFeature(id, body);
  }

  @Delete('features/:id')
  @ApiOperation({ summary: 'Delete a metered feature' })
  async deleteFeature(@Param('id') id: string) {
    return this.meteringService.deleteFeature(id);
  }

  // ─── Quotas ────────────────────────────────────────────────

  @Get('quotas')
  @ApiOperation({ summary: 'List quotas' })
  async listQuotas(@Query('featureId') featureId?: string, @Query('userId') userId?: string) {
    return this.meteringService.listQuotas({ featureId, userId });
  }

  @Post('quotas')
  @ApiOperation({ summary: 'Create a quota' })
  async createQuota(@Body() body: CreateQuotaDto) {
    return this.meteringService.createQuota(body);
  }

  @Put('quotas/:id')
  @ApiOperation({ summary: 'Update a quota' })
  async updateQuota(@Param('id') id: string, @Body() body: UpdateQuotaDto) {
    return this.meteringService.updateQuota(id, body);
  }

  @Delete('quotas/:id')
  @ApiOperation({ summary: 'Delete a quota' })
  async deleteQuota(@Param('id') id: string) {
    return this.meteringService.deleteQuota(id);
  }

  // ─── Usage ─────────────────────────────────────────────────

  @Get('usage')
  @ApiOperation({ summary: 'Usage totals / time series' })
  async usage(
    @Query('featureCode') featureCode?: string,
    @Query('serviceId') serviceId?: string,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('granularity') granularity?: string,
  ) {
    return this.meteringService.getUsageBreakdown({
      userId,
      serviceId,
      featureCode,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      groupBy: granularity === 'day' ? 'day' : 'feature',
    });
  }
}
