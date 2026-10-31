import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtOrServiceGuard } from '../auth/guards/jwt-or-service.guard';
import { User, RequestUser } from '../auth/decorators/user.decorator';
import { PrismaService } from '../common/services/prisma.service';
import { ChangePlanDto } from './dto/change-plan.dto';
import { PlanChangeService } from './plan-change.service';
import { allowedOriginsOf, validReturnTo } from './return-to';

@ApiTags('Subscriptions')
@Controller('v1/subscriptions')
export class SubscriptionChangeController {
  constructor(
    private readonly planChange: PlanChangeService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Change plan within one service: an upgrade answers with a payment for the
   * prorated difference, a downgrade or a change of interval is scheduled for
   * the end of the period. The subscriber (their token) or the service that
   * sold the plan (its API key) may ask.
   */
  @Post(':id/change')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtOrServiceGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Change the plan of a subscription (upgrade now, downgrade at period end)',
  })
  async change(
    @Req() req: any,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ChangePlanDto,
  ) {
    const caller = req.user?.isService
      ? { serviceId: String(req.user.serviceId) }
      : {
          userId: String(req.user?.userId),
          orgId: req.user?.orgId as string | undefined,
          orgRole: req.user?.orgRole as string | undefined,
        };
    return this.planChange.change(caller, { subscriptionId: id, ...body });
  }

  /**
   * What the customer page needs to show one service's plans and a way back:
   * the service's name, and `return_to` only when it is on one of the
   * service's allowed origins.
   */
  @Get('portal')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'The customer page for one service, with a validated return link' })
  async portal(
    @User() _user: RequestUser,
    @Query('service') code?: string,
    @Query('return_to') returnTo?: string,
  ) {
    // A repeated query parameter arrives as an array: only one string names a service.
    if (typeof code !== 'string' || !code || code.length > 100) {
      throw new NotFoundException('Service not found');
    }
    const service = await this.prisma.service.findUnique({ where: { code } });
    if (!service || !service.isActive) throw new NotFoundException('Service not found');
    const metadata = (service.metadata as Record<string, unknown> | null) ?? {};
    const displayName =
      typeof metadata.displayName === 'string' && metadata.displayName.trim()
        ? metadata.displayName.trim()
        : service.name;
    return {
      service: { code: service.code, name: displayName },
      returnTo: validReturnTo(returnTo, allowedOriginsOf(metadata)),
    };
  }
}
