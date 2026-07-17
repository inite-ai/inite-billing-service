import { Injectable } from '@nestjs/common';
import {
  PaymentRailAdapter,
  CreateIntentInput,
  CreateIntentResult,
  IntentStatusResult,
  WebhookParseResult,
} from '../../src/common/interfaces/payment-rail-adapter.interface';

/**
 * Mock Stripe adapter for testing
 * Note: Stripe is not implemented in v1, this is a placeholder for future use
 */
@Injectable()
export class MockStripeAdapter implements PaymentRailAdapter {
  private mockIntents: Map<string, any> = new Map();

  rail(): string {
    return 'STRIPE';
  }

  async createPaymentIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    const intentId = `pi_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const sessionId = `cs_${Date.now()}`;

    // Store mock intent
    this.mockIntents.set(intentId, {
      id: intentId,
      status: 'requires_payment_method',
      client_secret: `pi_${intentId}_secret`,
      amount: input.amount,
      currency: input.currency,
    });

    return {
      providerIntentId: intentId,
      providerCheckoutId: sessionId,
      checkoutUrl: `https://checkout.stripe.com/mock/${sessionId}`,
      expiresAt: new Date(Date.now() + 3600000),
      metadata: {
        mock: true,
        intent_id: intentId,
        session_id: sessionId,
      },
    };
  }

  async getIntentStatus(providerIntentId: string): Promise<IntentStatusResult> {
    const intent = this.mockIntents.get(providerIntentId);

    if (!intent) {
      return {
        status: 'created',
        metadata: { mock: true, not_found: true },
        providerData: {},
      };
    }

    // Map Stripe status to unified status
    const statusMap: Record<
      string,
      'created' | 'opened' | 'paid' | 'failed' | 'expired' | 'refunded'
    > = {
      requires_payment_method: 'opened',
      requires_confirmation: 'opened',
      requires_action: 'opened',
      processing: 'opened',
      requires_capture: 'opened',
      succeeded: 'paid',
      canceled: 'failed',
      payment_failed: 'failed',
      refunded: 'refunded',
    };

    return {
      status: statusMap[intent.status] || 'created',
      metadata: {
        stripe_status: intent.status,
        mock: true,
      },
      providerData: intent,
    };
  }

  async handleWebhook(rawPayload: any): Promise<WebhookParseResult> {
    const webhookId = rawPayload.id || `evt_${Date.now()}`;
    return {
      webhookId,
      eventType: rawPayload.type || rawPayload.event_type || 'payment_intent.succeeded',
      entityId: rawPayload.data?.object?.id || rawPayload.id,
      rail: 'STRIPE',
      payload: rawPayload,
    };
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

  // Helper to get all mock intents (for debugging)
  getAllMockIntents(): Map<string, any> {
    return new Map(this.mockIntents);
  }
}
