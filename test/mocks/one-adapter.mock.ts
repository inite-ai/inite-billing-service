import { Injectable } from '@nestjs/common';
import { createHmac } from 'crypto';
import { WebhookVerifyInput } from '../../src/common/connectors/connector.interface';
import { safeTimingSafeEqual } from '../../src/common/connectors/webhook-verify.util';
import {
  PaymentRailAdapter,
  CreateIntentInput,
  CreateIntentResult,
  IntentStatusResult,
  WebhookParseResult,
} from '../../src/common/interfaces/payment-rail-adapter.interface';

@Injectable()
export class MockOneAdapter implements PaymentRailAdapter {
  private mockIntents: Map<string, any> = new Map();

  rail(): string {
    return 'ONE';
  }

  async createPaymentIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    const intentId = `one_intent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const checkoutId = `one_checkout_${Date.now()}`;

    // Store mock intent
    this.mockIntents.set(intentId, {
      id: intentId,
      status: 'OPENED',
      external_id: input.orderId,
      checkout_url: `https://checkout.one.lat/mock/${checkoutId}`,
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    });

    return {
      providerIntentId: intentId,
      providerCheckoutId: checkoutId,
      checkoutUrl: `https://checkout.one.lat/mock/${checkoutId}`,
      expiresAt: new Date(Date.now() + 3600000),
      metadata: {
        mock: true,
        intent_id: intentId,
        checkout_id: checkoutId,
      },
    };
  }

  async getIntentStatus(providerIntentId: string): Promise<IntentStatusResult> {
    const intent = this.mockIntents.get(providerIntentId);

    if (!intent) {
      // Return default status if intent not found (for testing edge cases)
      return {
        status: 'created',
        metadata: { mock: true, not_found: true },
        providerData: {},
      };
    }

    // Map ONE status to unified status
    const statusMap: Record<
      string,
      'created' | 'opened' | 'paid' | 'failed' | 'expired' | 'refunded'
    > = {
      OPENED: 'opened',
      CLOSED: 'paid',
      EXPIRED: 'expired',
      REJECTED: 'failed',
      REFUNDED: 'refunded',
    };

    return {
      status: statusMap[intent.status] || 'created',
      metadata: {
        one_status: intent.status,
        external_id: intent.external_id,
        mock: true,
      },
      providerData: intent,
    };
  }

  /**
   * Mirrors the real ONE adapter: HMAC-SHA256 over the exact request bytes,
   * keyed on the provider's apiSecret. Kept faithful rather than always-true so
   * the e2e actually covers the fail-closed path the controller depends on.
   */
  verifyWebhook({ rawBody, headers, config }: WebhookVerifyInput): boolean {
    const apiSecret = config.apiSecret || '';
    if (!apiSecret) return false;
    const signature = headers['x-signature'];
    const expected = createHmac('sha256', apiSecret).update(rawBody).digest('hex');
    return !!signature && safeTimingSafeEqual(expected, signature);
  }

  async handleWebhook(rawPayload: any): Promise<WebhookParseResult> {
    const webhookId = rawPayload.id || rawPayload.webhook_id || `webhook_${Date.now()}`;
    return {
      webhookId,
      eventType: rawPayload.event_type || rawPayload.eventType || 'payment.order.updated',
      entityId: rawPayload.entity_id || rawPayload.entityId || rawPayload.id,
      rail: 'ONE',
      payload: rawPayload,
    };
  }

  // Helper to get all mock intents (for debugging)
  getAllMockIntents(): Map<string, any> {
    return new Map(this.mockIntents);
  }

  // Helper to create intent with specific status for testing
  createIntentWithStatus(orderId: string, status: string): string {
    const intentId = `one_intent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.mockIntents.set(intentId, {
      id: intentId,
      status,
      external_id: orderId,
      checkout_url: `https://checkout.one.lat/mock/${intentId}`,
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    });
    return intentId;
  }

  // Helper method for tests to update intent status
  setIntentStatus(providerIntentId: string, status: string): void {
    const intent = this.mockIntents.get(providerIntentId);
    if (intent) {
      intent.status = status;
    }
  }

  // Helper method to clear mocks
  clearMocks(): void {
    this.mockIntents.clear();
  }
}
