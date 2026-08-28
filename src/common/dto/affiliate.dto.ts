import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AffiliateResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  referralCode: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  commissionRate: string;

  @ApiProperty()
  totalEarned: string;

  @ApiProperty()
  totalPaid: string;

  @ApiProperty()
  referralUrl: string;

  @ApiProperty()
  createdAt: Date;
}

export class ReferralResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  referredUserId: string;

  @ApiProperty()
  firstOrderPaid: boolean;

  @ApiPropertyOptional()
  firstOrderId?: string;

  @ApiProperty()
  createdAt: Date;
}

export class CommissionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  orderId: string;

  @ApiProperty()
  amount: string;

  @ApiProperty()
  commissionRate: string;

  @ApiProperty()
  currency: string;

  @ApiProperty()
  status: string;

  @ApiPropertyOptional()
  earnedAt?: Date;

  @ApiProperty()
  createdAt: Date;
}

export class PayoutResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  periodStart: Date;

  @ApiProperty()
  periodEnd: Date;

  @ApiProperty()
  totalAmount: string;

  @ApiProperty()
  currency: string;

  @ApiProperty()
  status: string;

  @ApiPropertyOptional()
  payoutDate?: Date;

  @ApiProperty()
  createdAt: Date;
}

export class CreateAffiliateDto {
  @ApiPropertyOptional({ description: 'Custom referral code (auto-generated if not provided)' })
  referralCode?: string;
}

export class CurrencyBalanceDto {
  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({ description: 'Awaiting settlement — still inside the refund window' })
  pending: string;

  @ApiProperty({ description: 'Settled and not covered by a payout — withdrawable now' })
  available: string;

  @ApiProperty({ description: 'Settled ever, in this currency' })
  earned: string;

  @ApiProperty({ description: 'Covered by a payout' })
  paid: string;
}

export class AffiliateStatsDto {
  @ApiProperty()
  totalReferrals: number;

  @ApiProperty()
  totalCommissions: string;

  @ApiProperty()
  pendingCommissions: string;

  @ApiProperty()
  paidCommissions: string;

  @ApiProperty({
    type: [CurrencyBalanceDto],
    description:
      'Per-currency ledger balances. The flat totals above add currencies together and are kept for backwards compatibility only.',
  })
  balances: CurrencyBalanceDto[];

  @ApiProperty()
  upcomingPayout?: PayoutResponseDto;
}
