import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { Commitment } from '@prisma/client';
import { PrismaService } from '../common/services/prisma.service';
import { PaymentOrchestratorService } from '../payment-orchestrator/payment-orchestrator.service';
import type { Connector } from '../common/connectors/connector.interface';
import type { CancelRoute } from './commitment-states';

/**
 * Where a cancelled stake's money goes back. A rail that refunds by API
 * (Stripe) gets the whole charge back on the card, before the commitment
 * moves — a failed provider refund leaves the stake held, never "refunded"
 * without the money. Every other rail (INITE wallet, x402, crypto, lava,
 * PIX) is paid back to the person's INITE wallet from the treasury.
 */
@Injectable()
export class CommitmentRefunds {
  private readonly logger = new Logger(CommitmentRefunds.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: PaymentOrchestratorService,
  ) {}

  async refundOnCard(row: Commitment): Promise<CancelRoute> {
    if (!row.paidRail) return 'wallet';
    let connector: Connector | undefined;
    try {
      connector = this.orchestrator.getAdapter(row.paidRail) as Connector;
    } catch {
      return 'wallet';
    }
    if (!connector.capabilities?.().supportsRefund || !connector.refund) return 'wallet';
    const intent = await this.prisma.paymentIntent.findFirst({
      where: { orderId: row.orderId, status: 'paid' },
    });
    if (!intent?.providerIntentId) return 'wallet';
    const total = row.stakeAmount.plus(row.feeAmount);
    const result = await connector.refund({
      providerIntentId: intent.providerIntentId,
      amount: total.toNumber(),
      currency: row.currency,
    });
    if (!result.refunded) {
      throw new BadRequestException('The card refund did not go through; the stake stays held');
    }
    this.logger.log(`Stake ${row.id} cancelled: ${total.toFixed(2)} refunded on ${row.paidRail}`);
    return 'card';
  }
}
