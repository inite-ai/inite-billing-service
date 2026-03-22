import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User, RequestUser } from '../auth/decorators/user.decorator';
import { AffiliatesService } from './affiliates.service';
import {
  AffiliateResponseDto,
  ReferralResponseDto,
  CommissionResponseDto,
  PayoutResponseDto,
  AffiliateStatsDto,
  CreateAffiliateDto,
} from '../common/dto/affiliate.dto';

@ApiTags('Affiliates')
@Controller('v1/affiliates')
export class AffiliatesController {
  constructor(private readonly affiliatesService: AffiliatesService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create or get affiliate account' })
  @ApiResponse({ status: 201, type: AffiliateResponseDto })
  async createAffiliate(
    @User() user: RequestUser,
    @Body() dto: CreateAffiliateDto,
    @Query('serviceId') serviceId?: string,
  ): Promise<AffiliateResponseDto> {
    return this.affiliatesService.createOrGetAffiliate(
      user.userId,
      dto.referralCode,
      serviceId,
    );
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get current user affiliate account' })
  @ApiResponse({ status: 200, type: AffiliateResponseDto })
  async getMyAffiliate(
    @User() user: RequestUser,
    @Query('serviceId') serviceId?: string,
  ): Promise<AffiliateResponseDto> {
    return this.affiliatesService.getAffiliateByUserId(user.userId, serviceId);
  }

  @Get('me/stats')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get affiliate statistics' })
  @ApiResponse({ status: 200, type: AffiliateStatsDto })
  async getMyStats(
    @User() user: RequestUser,
    @Query('serviceId') serviceId?: string,
  ): Promise<AffiliateStatsDto> {
    const affiliate = await this.affiliatesService.getAffiliateByUserId(user.userId, serviceId);
    return this.affiliatesService.getAffiliateStats(affiliate.id);
  }

  @Get('me/referrals')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get my referrals' })
  @ApiResponse({ status: 200, type: [ReferralResponseDto] })
  async getMyReferrals(
    @User() user: RequestUser,
    @Query('serviceId') serviceId?: string,
  ): Promise<ReferralResponseDto[]> {
    const affiliate = await this.affiliatesService.getAffiliateByUserId(user.userId, serviceId);
    return this.affiliatesService.getReferrals(affiliate.id);
  }

  @Get('me/commissions')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get my commissions' })
  @ApiResponse({ status: 200, type: [CommissionResponseDto] })
  async getMyCommissions(
    @User() user: RequestUser,
    @Query('status') status?: string,
    @Query('serviceId') serviceId?: string,
  ): Promise<CommissionResponseDto[]> {
    const affiliate = await this.affiliatesService.getAffiliateByUserId(user.userId, serviceId);
    return this.affiliatesService.getCommissions(affiliate.id, status);
  }

  @Get('me/payouts')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get my payouts' })
  @ApiResponse({ status: 200, type: [PayoutResponseDto] })
  async getMyPayouts(
    @User() user: RequestUser,
    @Query('serviceId') serviceId?: string,
  ): Promise<PayoutResponseDto[]> {
    const affiliate = await this.affiliatesService.getAffiliateByUserId(user.userId, serviceId);
    return this.affiliatesService.getPayouts(affiliate.id);
  }

  @Get('me/balance')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get available balance for withdrawal' })
  async getMyBalance(
    @User() user: RequestUser,
    @Query('serviceId') serviceId?: string,
  ) {
    const affiliate = await this.affiliatesService.getAffiliateByUserId(user.userId, serviceId);
    return this.affiliatesService.getBalance(affiliate.id);
  }

  @Post('me/withdraw')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request withdrawal from affiliate balance' })
  async requestWithdrawal(
    @User() user: RequestUser,
    @Body() body: { amount?: number; currency?: string },
    @Query('serviceId') serviceId?: string,
  ) {
    const affiliate = await this.affiliatesService.getAffiliateByUserId(user.userId, serviceId);
    return this.affiliatesService.requestWithdrawal(affiliate.id, body.amount, body.currency);
  }

  @Get('me/tree')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get my referral tree' })
  async getMyTree(
    @User() user: RequestUser,
    @Query('serviceId') serviceId?: string,
  ) {
    const affiliate = await this.affiliatesService.getAffiliateByUserId(user.userId, serviceId);
    return this.affiliatesService.getAffiliateTree(affiliate.id);
  }
}
