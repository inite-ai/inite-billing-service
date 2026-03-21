import { Injectable, Logger } from '@nestjs/common';
import {
  PaymentRailAdapter,
  CreateIntentInput,
  CreateIntentResult,
  IntentStatusResult,
} from '../../common/interfaces/payment-rail-adapter.interface';
import { PrismaService } from '../../common/services/prisma.service';

/**
 * Crypto adapter stub - implements interface but uses fake provider
 * For v1, this is a stub implementation. Real on-chain integration
 * should be implemented separately if needed.
 */
@Injectable()
export class CryptoAdapter implements PaymentRailAdapter {
  private readonly logger = new Logger(CryptoAdapter.name);

  constructor(private readonly prisma: PrismaService) {
    this.logger.warn(
      'CryptoAdapter is a stub implementation - not for production use',
    );
  }

  rail(): string {
    return 'CRYPTO';
  }

  async createPaymentIntent(
    input: CreateIntentInput,
  ): Promise<CreateIntentResult> {
    // Stub: ONCHAIN_INVOICE mode
    if (!input.cryptoChainId || !input.cryptoToken || !input.receiverAddress) {
      throw new Error(
        'Crypto adapter requires: cryptoChainId, cryptoToken, receiverAddress',
      );
    }

    // Stub: Generate fake invoice ID
    const fakeInvoiceId = `crypto_invoice_${Date.now()}`;
    const fakeCheckoutUrl = `https://example.com/crypto-invoice/${fakeInvoiceId}`;

    this.logger.warn(
      `CryptoAdapter stub: created fake invoice ${fakeInvoiceId} for order ${input.orderId}`,
    );

    return {
      providerIntentId: fakeInvoiceId,
      checkoutUrl: fakeCheckoutUrl,
      expiresAt: new Date(Date.now() + 3600000), // 1 hour
      metadata: {
        chain_id: input.cryptoChainId,
        token: input.cryptoToken,
        receiver_address: input.receiverAddress,
        mode: 'ONCHAIN_INVOICE',
        stub: true,
      },
    };
  }

  async getIntentStatus(providerIntentId: string): Promise<IntentStatusResult> {
    // Stub: Always return 'created' status
    this.logger.warn(
      `CryptoAdapter stub: getStatus for ${providerIntentId} - returning 'created'`,
    );

    return {
      status: 'created',
      metadata: {
        stub: true,
        provider_intent_id: providerIntentId,
      },
      providerData: {
        invoice_id: providerIntentId,
        status: 'pending',
      },
    };
  }

  /**
   * Stub method for handling on-chain transaction confirmations
   * In real implementation, this would be called by a blockchain indexer/webhook
   */
  async handleTransactionConfirmation(
    txHash: string,
    confirmations: number,
    requiredConfirmations: number = 3,
  ): Promise<boolean> {
    this.logger.warn(
      `CryptoAdapter stub: handleTransactionConfirmation for ${txHash} - confirmations: ${confirmations}/${requiredConfirmations}`,
    );
    return confirmations >= requiredConfirmations;
  }
}

