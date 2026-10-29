import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequestUser, User } from '../auth/decorators/user.decorator';
import { CharitiesService } from './charities.service';
import { CommitmentsService } from './commitments.service';
import { CommitmentCatalogService } from './commitment-catalog.service';
import { CharityDto, CharityPayoutDto, CharityPayoutSentDto, OverrideDto } from './commitments.dto';

/**
 * What anyone may read: each charity, what it was given and the batches that
 * handed it over. Aggregates only; no mutation lives here.
 */
@ApiTags('Commitments')
@Controller('v1/commitments')
export class CommitmentsPublicController {
  constructor(
    private readonly charities: CharitiesService,
    private readonly commitments: CommitmentsService,
  ) {}

  @Get('charities')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Charities with totals forfeited, paid out and owed (public)' })
  list() {
    return this.charities.listPublic();
  }

  @Get('charities/:code/ledger')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: "One charity's forfeits and payout batches (public)" })
  ledger(@Param('code') code: string) {
    return this.charities.ledgerPublic(code);
  }

  /** A person's own stakes, from their own token. */
  @Get('mine')
  @UseGuards(JwtAuthGuard)
  mine(@User() user: RequestUser) {
    return this.commitments.mine(user.userId);
  }
}

function adminKey(key: string | undefined): string {
  const k = key?.trim();
  if (!k || k.length > 200) throw new BadRequestException('idempotency-key header is required');
  return `admin:${k}`;
}

/** Admin: disputes, charities, payout batches, the price sync. */
@ApiTags('Admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('v1/admin/commitments')
export class CommitmentsAdminController {
  constructor(
    private readonly commitments: CommitmentsService,
    private readonly charities: CharitiesService,
    private readonly catalog: CommitmentCatalogService,
  ) {}

  @Get()
  async list(@Query('status') status?: string) {
    return this.commitments.adminList(status);
  }

  @Get('charities')
  charityList() {
    return this.charities.listAdmin();
  }

  @Post('charities')
  upsertCharity(@Body() dto: CharityDto) {
    return this.charities.upsert(dto);
  }

  @Post('payouts')
  createPayout(@User() user: RequestUser, @Body() dto: CharityPayoutDto) {
    return this.charities.createPayout(dto.charityCode, new Date(dto.periodTo), user.userId);
  }

  @Post('payouts/:id/sent')
  @HttpCode(200)
  payoutSent(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: CharityPayoutSentDto) {
    return this.charities.markPayoutSent(id, dto.reference);
  }

  @Post('products/:code/sync')
  @HttpCode(200)
  sync(@Param('code') code: string) {
    return this.catalog.sync(code);
  }

  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.commitments.view(null, id);
  }

  @Post(':id/override')
  @HttpCode(200)
  override(
    @User() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: OverrideDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.commitments.override(id, dto.to, user.userId, adminKey(key), dto.reason);
  }
}
