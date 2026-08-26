import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtOrServiceGuard } from '../auth/guards/jwt-or-service.guard';
import { User, RequestUser } from '../auth/decorators/user.decorator';
import { CreditsService } from './credits.service';
import { publicApiValidation } from '../common/pipes/public-api-validation.pipe';
import { AdjustCreditsDto, ConsumeCreditsDto } from './dto/credits.dto';
import { MeteringService } from './metering.service';

@ApiTags('Credits')
@Controller('v1/credits')
export class CreditsController {
  constructor(
    private readonly creditsService: CreditsService,
    private readonly meteringService: MeteringService,
  ) {}

  // ─── User endpoints (JWT auth) ────────────────────────────

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get all my credit balances' })
  async getMyBalances(@User() user: RequestUser) {
    return this.creditsService.getUserBalances(user.userId);
  }

  @Get('me/usage')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get my usage history' })
  async getMyUsageHistory(
    @User() user: RequestUser,
    @Query('serviceId') serviceId?: string,
    @Query('type') type?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.creditsService.getUsageHistory(user.userId, {
      serviceId,
      type,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? Math.min(parseInt(limit, 10), 100) : undefined,
    });
  }

  @Get('me/usage/breakdown')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get my usage breakdown by feature/day' })
  async getMyUsageBreakdown(
    @User() user: RequestUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('groupBy') groupBy?: string,
    @Query('featureCode') featureCode?: string,
  ) {
    return this.meteringService.getUsageBreakdown({
      userId: user.userId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      groupBy: groupBy === 'day' ? 'day' : 'feature',
      featureCode,
    });
  }

  // ─── Service endpoints (JWT or Service API key) ───────────

  @Get('features')
  @UseGuards(JwtOrServiceGuard)
  @ApiOperation({ summary: 'List active metered features (codes and rates)' })
  async listFeatures() {
    return this.meteringService.listFeatures();
  }

  @Post('consume')
  @UseGuards(JwtOrServiceGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Consume credits for a user (flat or metered)' })
  async consumeCredits(
    @User() user: RequestUser,
    @Body(publicApiValidation()) body: ConsumeCreditsDto,
  ) {
    // C3 fix: Force userId for non-service callers to prevent IDOR
    const userId = user.isService ? body.userId : user.userId;
    if (!userId) {
      throw new BadRequestException('userId is required (pass in body for service API key calls)');
    }
    // A service key may only ever act within its OWN service scope. Deriving the
    // scope from the authenticated key (never body.serviceId) stops one service
    // from draining credits booked under another service's scope. A user caller
    // operates on their own balances (optionally body-scoped to a service).
    const serviceId = user.isService ? user.serviceId : body.serviceId;
    return this.creditsService.consume({ ...body, userId, serviceId });
  }

  @Post('adjust')
  @UseGuards(JwtOrServiceGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Adjust credits for a user (service-to-service)' })
  async adjustCredits(
    @User() user: RequestUser,
    @Body(publicApiValidation()) body: AdjustCreditsDto,
  ) {
    if (!user.isService) {
      throw new ForbiddenException('Only service accounts can adjust credits');
    }
    // Scope the adjustment to the calling service's own credits — never a
    // body-supplied serviceId. Otherwise any service key could mint or drain
    // credits under another service's scope (write-access IDOR).
    const serviceId = user.serviceId;
    if (!body.userId) {
      throw new BadRequestException('userId is required');
    }
    return this.creditsService.adminAdjust({
      ...body,
      userId: body.userId,
      serviceId,
      description: body.description || 'service-adjust',
    });
  }

  @Get(':userId')
  @UseGuards(JwtOrServiceGuard)
  @ApiOperation({ summary: 'Get user balances (service-to-service)' })
  async getUserBalances(@User() user: RequestUser, @Param('userId') userId: string) {
    // C4 fix: Non-service callers can only access their own balances
    if (!user.isService && userId !== user.userId) {
      throw new ForbiddenException('You can only access your own credit balances');
    }
    // Service callers get only their service-specific balance
    if (user.isService && user.serviceId) {
      return this.creditsService.getBalance(userId, user.serviceId);
    }
    return this.creditsService.getUserBalances(userId);
  }
}
