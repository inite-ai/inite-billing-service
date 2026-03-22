import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
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
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  // ─── Service endpoints (JWT or Service API key) ───────────

  @Post('consume')
  @UseGuards(JwtOrServiceGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Consume credits for a user' })
  async consumeCredits(
    @Body()
    body: {
      userId: string;
      serviceId?: string;
      amount: number;
      description?: string;
      metadata?: Record<string, any>;
    },
  ) {
    return this.creditsService.consume(body);
  }

  @Get(':userId')
  @UseGuards(JwtOrServiceGuard)
  @ApiOperation({ summary: 'Get user balances (service-to-service)' })
  async getUserBalances(@Param('userId') userId: string) {
    return this.creditsService.getUserBalances(userId);
  }
}
