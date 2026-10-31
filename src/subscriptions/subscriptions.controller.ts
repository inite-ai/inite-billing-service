import {
  Controller,
  ParseUUIDPipe,
  Post,
  Body,
  Get,
  Param,
  Query,
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
import { ORG_MANAGERS_ONLY, mayManage } from './subscribers';
import { isOrgSubscriber } from '../common/validators/is-user-id';
import { publicApiValidation } from '../common/pipes/public-api-validation.pipe';
import { StartTrialDto } from './dto/start-trial.dto';
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
    // A single primitive body field bypasses the global pipe entirely, so a
    // malformed id used to reach Prisma instead of returning a 400.
    @Body('subscriptionId', new ParseUUIDPipe()) subscriptionId: string,
  ): Promise<void> {
    return this.subscriptionsService.cancelSubscription(user, subscriptionId);
  }

  @Post('resume')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resume subscription' })
  @ApiResponse({ status: 200 })
  async resumeSubscription(
    @User() user: RequestUser,
    @Body('subscriptionId', new ParseUUIDPipe()) subscriptionId: string,
  ): Promise<void> {
    return this.subscriptionsService.resumeSubscription(user, subscriptionId);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "The signed-in person's subscriptions and their organisation's (token org_id)",
  })
  @ApiResponse({ status: 200, type: [SubscriptionResponseDto] })
  async getMySubscriptions(
    @User() user: RequestUser,
    // The customer page for one service (`/subscriptions?service=<code>`).
    @Query('service') service?: string,
  ): Promise<SubscriptionResponseDto[]> {
    return this.subscriptionsService.getSubscriptionsFor(
      user,
      typeof service === 'string' && service ? service : undefined,
    );
  }

  @Post('trial')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @UseGuards(JwtOrServiceGuard)
  @ApiOperation({ summary: 'Start a trial subscription (no payment required)' })
  @ApiResponse({ status: 201, type: SubscriptionResponseDto })
  async startTrial(
    @Req() req: any,
    @Body(publicApiValidation()) body: StartTrialDto,
  ): Promise<SubscriptionResponseDto> {
    if (!body.priceCode) {
      throw new BadRequestException('priceCode is required');
    }
    // A person starts a trial for themselves, or for their organisation
    // (`org:<org_id>` of their token) when they are its owner or admin.
    let userId: string | undefined;
    if (req.user?.isService) {
      userId = body.userId;
    } else if (body.userId && body.userId !== req.user?.userId) {
      if (!isOrgSubscriber(body.userId) || !mayManage(req.user, body.userId)) {
        throw new ForbiddenException(ORG_MANAGERS_ONLY);
      }
      userId = body.userId.toLowerCase();
    } else {
      userId = req.user?.userId;
    }
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
