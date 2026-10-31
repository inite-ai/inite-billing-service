import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { RequestUser, User } from '../auth/decorators/user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ServiceScope, ServiceTokenGuard } from '../service-api/service-token.guard';
import { isMerchantRail, MerchantRail } from './merchant-credentials';
import { MerchantActor, MerchantsService } from './merchants.service';

/** The scope a service token needs to manage its merchants and their accounts. */
export const SCOPE_MERCHANTS = 'billing:merchants';

/** A tenant org from INITE Auth, or `<service>:<id>` until the merchant has one. */
const ORG_ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,254}$/;

class CreateMerchantDto {
  @IsString() @Matches(ORG_ID) orgId!: string;
  @IsString() @MaxLength(255) displayName!: string;
  @IsOptional() @IsString() @MaxLength(255) externalRef?: string;
}

class RefundDto {
  /** A decimal string; the rest of the order when absent. */
  @IsOptional() @IsString() @MaxLength(20) amount?: string;
  @IsOptional() @IsString() @MaxLength(255) reason?: string;
}

class PlatformFeeDto {
  @IsInt() @Min(0) @Max(5000) platformFeeBps!: number;
}

function rail(value: string): MerchantRail {
  const upper = String(value ?? '').toUpperCase();
  if (!isMerchantRail(upper)) throw new NotFoundException(`No merchant account on ${value}`);
  return upper;
}

function actor(user: RequestUser): MerchantActor & { serviceId: string } {
  if (!user?.serviceId) throw new ForbiddenException('A service is required');
  const clientId = (user as RequestUser & { clientId?: string }).clientId;
  return { serviceId: user.serviceId, actor: `service:${user.serviceCode}:${clientId ?? ''}` };
}

/**
 * A service's merchants and their own payment accounts
 * (docs/connected-accounts.md). Machine to machine, with an INITE Auth
 * service token carrying `billing:merchants`.
 */
@ApiTags('Merchants')
@ApiBearerAuth()
@UseGuards(ServiceTokenGuard)
@ServiceScope(SCOPE_MERCHANTS)
@Controller('v1/merchants')
export class MerchantsController {
  constructor(private readonly merchants: MerchantsService) {}

  @Post()
  @ApiOperation({ summary: 'Create (or return) the merchant for a tenant org' })
  create(@User() user: RequestUser, @Body() dto: CreateMerchantDto) {
    return this.merchants.create(actor(user), dto);
  }

  @Get('by-org/:orgId')
  byOrg(@User() user: RequestUser, @Param('orgId') orgId: string) {
    if (!ORG_ID.test(orgId)) throw new NotFoundException('Merchant not found');
    return this.merchants.getByOrg(actor(user).serviceId, orgId);
  }

  @Get(':merchantId')
  get(@User() user: RequestUser, @Param('merchantId', new ParseUUIDPipe()) merchantId: string) {
    return this.merchants.get(actor(user).serviceId, merchantId);
  }

  @Put(':merchantId/connections/:rail')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: "Store the merchant's own credentials for a rail (sealed)" })
  put(
    @User() user: RequestUser,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('rail') railParam: string,
    @Body() body: Record<string, unknown>,
  ) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('A credentials object is required');
    }
    return this.merchants.putConnection(actor(user), merchantId, rail(railParam), body);
  }

  @Post(':merchantId/connections/:rail/verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Prove the account is the merchant’s, by calling the provider' })
  verify(
    @User() user: RequestUser,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('rail') railParam: string,
  ) {
    return this.merchants.verify(actor(user), merchantId, rail(railParam));
  }

  @Delete(':merchantId/connections/:rail')
  disconnect(
    @User() user: RequestUser,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('rail') railParam: string,
  ) {
    return this.merchants.disconnect(actor(user), merchantId, rail(railParam));
  }

  @Post(':merchantId/orders/:orderId/refund')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: "Refund a merchant's order through the merchant's own account" })
  refund(
    @User() user: RequestUser,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body() dto: RefundDto,
  ) {
    return this.merchants.refund(actor(user), merchantId, orderId, dto);
  }
}

/** INITE's fee for a merchant: set by a billing admin only, off (0) by default. */
@ApiTags('Admin')
@ApiBearerAuth()
@Controller('v1/admin/merchants')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class MerchantsAdminController {
  constructor(private readonly merchants: MerchantsService) {}

  @Patch(':merchantId/platform-fee')
  setFee(
    @User() user: RequestUser,
    @Param('merchantId', new ParseUUIDPipe()) merchantId: string,
    @Body() dto: PlatformFeeDto,
  ) {
    return this.merchants.setPlatformFee(
      { serviceId: null, actor: `admin:${user?.userId ?? ''}` },
      merchantId,
      dto.platformFeeBps,
    );
  }
}
