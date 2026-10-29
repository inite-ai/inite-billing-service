import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { RequestUser, User } from '../auth/decorators/user.decorator';
import { USER_ID_PATTERN } from '../common/validators/is-user-id';
import {
  SCOPE_COMMITMENTS,
  ServiceScope,
  ServiceTokenGuard,
} from '../service-api/service-token.guard';
import { CommitmentsService } from './commitments.service';
import {
  CreateCommitmentDto,
  DisputeDto,
  PayFromWalletDto,
  ReasonDto,
  ReleaseDto,
} from './commitments.dto';

/** Every move takes a key: a retried call must never move money twice. */
function requireKey(key: string | undefined): string {
  const k = key?.trim();
  if (!k || k.length > 200) throw new BadRequestException('idempotency-key header is required');
  return k;
}

/**
 * A product's side of commitments. Only an INITE Auth service token with
 * `billing:commitments` gets in; a service sees and moves only its own rows.
 */
@ApiTags('Commitments')
@ApiBearerAuth()
@UseGuards(ServiceTokenGuard)
@ServiceScope(SCOPE_COMMITMENTS)
@Controller('v1/commitments')
export class CommitmentsController {
  constructor(private readonly commitments: CommitmentsService) {}

  @Get('policy')
  @ApiOperation({ summary: 'The stake offer: tiers, fee, credits, limits' })
  policy(@User() user: RequestUser, @Query('product') product: string) {
    return this.commitments.policy(user.serviceId!, product || 'break3-stake');
  }

  @Get('quote')
  @ApiOperation({ summary: 'What a tier costs, shown before payment' })
  quote(@User() user: RequestUser, @Query('product') product: string, @Query('tier') tier: string) {
    return this.commitments.quote(user.serviceId!, product || 'break3-stake', String(tier ?? ''));
  }

  @Get('exposure')
  @ApiOperation({ summary: 'What a person has at stake now, against the cap' })
  exposure(
    @User() user: RequestUser,
    @Query('userId') userId: string,
    @Query('product') product?: string,
  ) {
    if (!USER_ID_PATTERN.test(String(userId ?? '')))
      throw new BadRequestException('userId is a DID');
    return this.commitments.exposureView(user.serviceId!, userId, product || 'break3-stake');
  }

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Open a stake: the commitment and the checkout that pays it' })
  create(
    @User() user: RequestUser,
    @Body() dto: CreateCommitmentDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.commitments.create(user.serviceId!, dto, requireKey(key));
  }

  @Get()
  list(
    @User() user: RequestUser,
    @Query('externalRef') externalRef?: string,
    @Query('userId') userId?: string,
  ) {
    return this.commitments.list(user.serviceId!, { externalRef, userId });
  }

  @Get(':id')
  get(@User() user: RequestUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.commitments.view(user.serviceId!, id);
  }

  @Post(':id/pay-from-wallet')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async payFromWallet(
    @User() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: PayFromWalletDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.commitments.payFromWallet(
      user.serviceId!,
      user.serviceCode!,
      id,
      body.returnTo,
    );
    if (result.status === 'needs_approval') res.status(409);
    return result;
  }

  @Post(':id/release')
  @HttpCode(200)
  release(
    @User() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReleaseDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.commitments.release(
      user.serviceId!,
      id,
      dto.as,
      { actor: 'service', actorId: user.serviceCode },
      requireKey(key),
      dto.reason,
    );
  }

  @Post(':id/forfeit')
  @HttpCode(200)
  forfeit(
    @User() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReasonDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.commitments.forfeit(
      user.serviceId!,
      id,
      { actor: 'service', actorId: user.serviceCode },
      requireKey(key),
      dto.reason,
    );
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @User() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReasonDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.commitments.cancel(
      user.serviceId!,
      id,
      { actor: 'service', actorId: user.serviceCode },
      requireKey(key),
      dto.reason,
    );
  }

  @Post(':id/dispute')
  @HttpCode(200)
  dispute(
    @User() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DisputeDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.commitments.dispute(
      user.serviceId!,
      id,
      dto.by,
      { actor: 'service', actorId: user.serviceCode },
      requireKey(key),
      dto.reason,
    );
  }
}
