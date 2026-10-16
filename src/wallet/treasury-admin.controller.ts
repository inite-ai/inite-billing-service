import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { TreasuryService } from './treasury.service';

class SetUpTreasuryDto {
  /** USDC a transfer, enforced by Turnkey. Default 500. */
  @IsOptional() @IsString() @MaxLength(12) perTransfer?: string;
  /** USDC per 24 h, enforced by billing. Default 500. */
  @IsOptional() @IsString() @MaxLength(12) dailyLimit?: string;
}

/** The treasury card top-ups are paid out of: its address to fund, limits, payouts. */
@ApiTags('Admin: treasury')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('v1/admin/treasury')
export class TreasuryAdminController {
  constructor(private readonly treasury: TreasuryService) {}

  @Get()
  @ApiOperation({ summary: 'Treasury address, balance, limits and recent payouts' })
  status() {
    return this.treasury.status();
  }

  @Post()
  @ApiOperation({ summary: 'Set up the treasury (once) and the card top-up product' })
  setUp(@Body() body: SetUpTreasuryDto) {
    return this.treasury.setUp(body);
  }

  @Post('payout')
  @ApiOperation({ summary: 'Pay out paid card top-ups now instead of on the next minute' })
  async payOut() {
    await this.treasury.payOut();
    return this.treasury.status();
  }
}
