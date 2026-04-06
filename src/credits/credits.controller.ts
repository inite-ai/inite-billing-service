import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
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

@ApiTags('Credits')
@Controller('v1/credits')
export class CreditsController {
  constructor(private readonly creditsService: CreditsService) {}

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

  // ─── Service endpoints (JWT or Service API key) ───────────

  @Post('consume')
  @UseGuards(JwtOrServiceGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Consume credits for a user' })
  async consumeCredits(
    @User() user: RequestUser,
    @Body()
    body: {
      userId: string;
      serviceId?: string;
      amount: number;
      description?: string;
      metadata?: Record<string, any>;
    },
  ) {
    // C3 fix: Force userId for non-service callers to prevent IDOR
    const userId = user.isService ? body.userId : user.userId;
    // Auto-inject serviceId from API key when not explicitly provided
    const serviceId = body.serviceId ?? (user.isService ? user.serviceId : undefined);
    return this.creditsService.consume({ ...body, userId, serviceId });
  }

  @Post('adjust')
  @UseGuards(JwtOrServiceGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Adjust credits for a user (service-to-service)' })
  async adjustCredits(
    @User() user: RequestUser,
    @Body()
    body: {
      userId: string;
      serviceId?: string;
      amount: number;
      description?: string;
    },
  ) {
    if (!user.isService) {
      throw new ForbiddenException('Only service accounts can adjust credits');
    }
    const serviceId = body.serviceId ?? user.serviceId;
    return this.creditsService.adminAdjust({ ...body, serviceId, description: body.description || 'service-adjust' });
  }

  @Get(':userId')
  @UseGuards(JwtOrServiceGuard)
  @ApiOperation({ summary: 'Get user balances (service-to-service)' })
  async getUserBalances(
    @User() user: RequestUser,
    @Param('userId') userId: string,
  ) {
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
