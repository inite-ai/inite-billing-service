import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsISO8601, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { RequestUser, User } from '../auth/decorators/user.decorator';
import {
  SCOPE_CHECKOUT,
  ServiceScope,
  ServiceTokenGuard,
} from '../service-api/service-token.guard';
import {
  GRANTS_PAGE_MAX,
  ServiceCreditGrantsService,
  decodeCursor,
} from './service-credit-grants.service';

export class ServiceCreditGrantsQuery {
  /** Grants and revokes written at or after this instant (ISO 8601). */
  @IsISO8601({ strict: true })
  since!: string;

  @IsOptional() @IsString() @MaxLength(200) cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(GRANTS_PAGE_MAX)
  limit?: number;
}

/**
 * Credits on the service-token lane: the grants and revokes billing announced
 * to this service (`billing.credits.granted` / `billing.credits.revoked`),
 * listed so the service can find an event that never reached it. The scope is
 * the lane's one, `billing:checkout`: a service that sells credits through
 * billing may read what it sold. A service sees only its own.
 */
@ApiTags('Credits')
@ApiBearerAuth()
@UseGuards(ServiceTokenGuard)
@ServiceScope(SCOPE_CHECKOUT)
@Controller('v1/service-credits')
export class ServiceCreditsController {
  constructor(private readonly grants: ServiceCreditGrantsService) {}

  @Get('grants')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: 'This service’s credit grants and revokes, oldest first, by a stable cursor',
  })
  @ApiQuery({ name: 'since', required: true, description: 'ISO 8601; inclusive' })
  @ApiQuery({ name: 'cursor', required: false, description: '`nextCursor` of the previous page' })
  @ApiQuery({ name: 'limit', required: false, description: `1–${GRANTS_PAGE_MAX}, default 100` })
  async list(@User() user: RequestUser, @Query() query: ServiceCreditGrantsQuery) {
    // The guard always sets it; without it there is no service to scope to.
    if (!user.serviceId) throw new ForbiddenException('Not a service');
    const since = new Date(query.since);
    if (Number.isNaN(since.getTime())) throw new BadRequestException('since is not a date');
    return this.grants.list(user.serviceId, {
      since,
      cursor: query.cursor ? decodeCursor(query.cursor) : undefined,
      limit: query.limit,
    });
  }
}
