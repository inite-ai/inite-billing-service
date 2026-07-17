import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtOrServiceGuard } from '../auth/guards/jwt-or-service.guard';
import { User, RequestUser } from '../auth/decorators/user.decorator';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionResponseDto } from '../common/dto/subscription.dto';

@ApiTags('Subscriptions')
@Controller('v1/subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Post('cancel')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel subscription at period end' })
  @ApiResponse({ status: 200 })
  async cancelSubscription(
    @User() user: RequestUser,
    @Body('subscriptionId') subscriptionId: string,
  ): Promise<void> {
    return this.subscriptionsService.cancelSubscription(user.userId, subscriptionId);
  }

  @Post('resume')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resume subscription' })
  @ApiResponse({ status: 200 })
  async resumeSubscription(
    @User() user: RequestUser,
    @Body('subscriptionId') subscriptionId: string,
  ): Promise<void> {
    return this.subscriptionsService.resumeSubscription(user.userId, subscriptionId);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get current user subscriptions' })
  @ApiResponse({ status: 200, type: [SubscriptionResponseDto] })
  async getMySubscriptions(@User() user: RequestUser): Promise<SubscriptionResponseDto[]> {
    return this.subscriptionsService.getUserSubscriptions(user.userId);
  }

  @Post('trial')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @UseGuards(JwtOrServiceGuard)
  @ApiOperation({ summary: 'Start a trial subscription (no payment required)' })
  @ApiResponse({ status: 201, type: SubscriptionResponseDto })
  async startTrial(
    @Req() req: any,
    @Body() body: { priceCode: string; userId?: string },
  ): Promise<SubscriptionResponseDto> {
    if (!body.priceCode) {
      throw new BadRequestException('priceCode is required');
    }
    const userId = req.user?.isService ? body.userId : req.user?.userId;
    if (!userId) {
      throw new BadRequestException('userId is required (pass in body for service API key calls)');
    }
    const callerServiceId = req.user?.isService ? req.user.serviceId : undefined;
    return this.subscriptionsService.startTrial(userId, body.priceCode, callerServiceId);
  }

  @Get('user/:userId')
  @UseGuards(JwtOrServiceGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get subscriptions for a user (service-scoped)' })
  @ApiResponse({ status: 200, type: [SubscriptionResponseDto] })
  async getUserSubscriptions(
    @Param('userId') userId: string,
    @Req() req: any,
  ): Promise<SubscriptionResponseDto[]> {
    // Non-service callers can only access their own subscriptions
    if (!req.user?.isService && req.user?.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }
    // Service API key → filter by that service's ID
    const serviceId = req.user?.isService ? req.user.serviceId : undefined;
    return this.subscriptionsService.getUserSubscriptions(userId, serviceId);
  }
}
