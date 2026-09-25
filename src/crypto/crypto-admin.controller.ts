import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { User, RequestUser } from '../auth/decorators/user.decorator';
import { CryptoAdminService } from './crypto-admin.service';

class UpdateCryptoSettingsDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** `{ TRON: "T…", ETH: null }` — null removes a wallet. */
  @IsOptional()
  @IsObject()
  wallets?: Record<string, string | null>;

  @IsOptional()
  @IsInt()
  expiryMinutes?: number;

  @IsOptional()
  @IsInt()
  lateGraceHours?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  etherscanApiKey?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  trongridApiKey?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  toncenterApiKey?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  solanaRpcUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  webhookSecret?: string | null;

  @IsOptional()
  @IsNumber()
  fxMarkupPercent?: number;

  /** `{ RUB: "84.5", EUR: null }` — units per US dollar; null unpins. */
  @IsOptional()
  @IsObject()
  fixedRates?: Record<string, string | number | null>;
}

class AssignTransferDto {
  @IsUUID()
  invoiceId: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

class IgnoreTransferDto {
  @IsString()
  @MaxLength(1000)
  note: string;
}

const INVOICE_STATUSES = ['awaiting', 'confirming', 'paid', 'expired', 'cancelled'];
const TRANSFER_STATUSES = ['unmatched', 'matched', 'ignored'];

@ApiTags('Admin')
@Controller('v1/admin/crypto')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class CryptoAdminController {
  constructor(private readonly crypto: CryptoAdminService) {}

  @Get('settings')
  @ApiOperation({ summary: 'Crypto rail settings, per-network readiness and watcher status' })
  getSettings() {
    return this.crypto.getSettings();
  }

  @Put('settings')
  @ApiOperation({ summary: 'Change wallets, API keys, payment window; turn the rail on or off' })
  updateSettings(@Body() body: UpdateCryptoSettingsDto) {
    return this.crypto.updateSettings(body as any);
  }

  @Get('invoices')
  @ApiOperation({ summary: 'Crypto invoices with their orders' })
  listInvoices(@Query('status') status?: string, @Query('limit') limit?: string) {
    return this.crypto.listInvoices({
      status: status && INVOICE_STATUSES.includes(status) ? status : undefined,
      limit: limit ? parseInt(limit, 10) || undefined : undefined,
    });
  }

  @Get('transfers')
  @ApiOperation({ summary: 'Incoming transfers — unmatched by default' })
  listTransfers(@Query('status') status?: string, @Query('limit') limit?: string) {
    return this.crypto.listTransfers({
      status: status && TRANSFER_STATUSES.includes(status) ? status : undefined,
      limit: limit ? parseInt(limit, 10) || undefined : undefined,
    });
  }

  @Post('transfers/:id/assign')
  @ApiOperation({ summary: 'Attribute an unmatched transfer to an invoice and settle its order' })
  assign(@Param('id') id: string, @Body() body: AssignTransferDto, @User() user: RequestUser) {
    return this.crypto.assign(id, body.invoiceId, user.userId, body.note);
  }

  @Post('transfers/:id/ignore')
  @ApiOperation({ summary: 'Set aside a transfer that pays for nothing here' })
  ignore(@Param('id') id: string, @Body() body: IgnoreTransferDto, @User() user: RequestUser) {
    return this.crypto.ignore(id, user.userId, body.note);
  }

  @Post('fx/refresh')
  @ApiOperation({ summary: 'Fetch exchange rates now' })
  refreshRates() {
    return this.crypto.refreshRates();
  }

  @Post('poll')
  @ApiOperation({ summary: 'Check the chains for payments now' })
  poll() {
    return this.crypto.pollNow();
  }
}
