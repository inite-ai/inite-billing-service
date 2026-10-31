import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsString, Matches, MaxLength } from 'class-validator';
import { RequestUser, User } from '../auth/decorators/user.decorator';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import {
  SCOPE_CHECKOUT,
  ServiceScope,
  ServiceTokenGuard,
} from '../service-api/service-token.guard';
import { SERVICE_BUYER_PATTERN, assertOwnGuestId } from '../service-api/buyer';
import { ChangePlanDto } from './dto/change-plan.dto';
import { PlanChangeService } from './plan-change.service';

class ServiceTrialDto {
  @IsString()
  @MaxLength(255)
  @Matches(SERVICE_BUYER_PATTERN, {
    message: "userId must be a DID, a UUID or this service's guest id",
  })
  userId!: string;
  @IsString() @MaxLength(100) priceCode!: string;
}

/**
 * Subscriptions on the service-token lane (INITE Auth `client_credentials`,
 * scope `billing:checkout`): a trial with no card, the plans a subscriber
 * holds with this service, and a change of plan. The subscription itself is
 * bought through POST /v1/service-checkout/sessions with `mode: SUBSCRIPTION`.
 * A service sees and moves only its own plans.
 */
@ApiTags('Subscriptions')
@ApiBearerAuth()
@UseGuards(ServiceTokenGuard)
@ServiceScope(SCOPE_CHECKOUT)
@Controller('v1/service-subscriptions')
export class ServiceSubscriptionsController {
  constructor(
    private readonly subscriptions: SubscriptionsService,
    private readonly planChange: PlanChangeService,
  ) {}

  @Post('trial')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Start a no-card trial of one of this service’s plans' })
  async trial(@User() user: RequestUser, @Body() body: ServiceTrialDto) {
    assertOwnGuestId(body.userId, user.serviceCode);
    return this.subscriptions.startTrial(body.userId, body.priceCode, user.serviceId!);
  }

  @Get()
  @ApiOperation({ summary: 'A subscriber’s plans with this service' })
  async list(@User() user: RequestUser, @Query('userId') userId?: string) {
    if (!userId || userId.length > 255 || !SERVICE_BUYER_PATTERN.test(userId)) {
      throw new BadRequestException('userId is required');
    }
    return this.subscriptions.getUserSubscriptions(userId, user.serviceId!);
  }

  @Post(':id/change')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Change plan: upgrade now (prorated), downgrade at period end' })
  async change(
    @User() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ChangePlanDto,
  ) {
    return this.planChange.change({ serviceId: user.serviceId! }, { subscriptionId: id, ...body });
  }
}
