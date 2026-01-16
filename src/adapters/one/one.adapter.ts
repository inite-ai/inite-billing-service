import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PaymentRailAdapter,
  CreateIntentInput,
  CreateIntentResult,
  IntentStatusResult,
  WebhookParseResult,
} from '../../common/interfaces/payment-rail-adapter.interface';

interface OnePaymentOrder {
  id: string;
  status: 'OPENED' | 'CLOSED' | 'EXPIRED' | 'REJECTED' | 'REFUNDED';
  external_id?: string;
  checkout_url?: string;
  expires_at?: string;
  metadata?: Record<string, any>;
}

interface OneCheckoutPreference {
  id: string;
  checkout_url: string;
  expires_at?: string;
}

@Injectable()
export class OneAdapter implements PaymentRailAdapter {
  private readonly logger = new Logger(OneAdapter.name);
  private readonly apiBaseUrl: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;

  constructor(private readonly configService: ConfigService) {
    this.apiBaseUrl =
      this.configService.get<string>('ONE_API_BASE_URL') ||
      'https://api.one.lat';
    this.apiKey = this.configService.get<string>('ONE_API_KEY') || '';
    this.apiSecret = this.configService.get<string>('ONE_API_SECRET') || '';

    if (!this.apiKey || !this.apiSecret) {
      this.logger.warn('ONE API credentials not configured');
    }
  }

  rail(): string {
    return 'ONE';
  }

  async createPaymentIntent(
    input: CreateIntentInput,
  ): Promise<CreateIntentResult> {
    const preferenceType = input.mode === 'SUBSCRIPTION' ? 'SUBSCRIPTION' : 'PAYMENT';

    const preferenceData: any = {
      type: preferenceType,
      external_id: input.orderId,
      items: [
        {
          title: 'Order',
          quantity: 1,
          unit_price: input.amount,
          currency: input.currency,
        },
      ],
      metadata: {
        ...input.metadata,
        order_id: input.orderId,
      },
    };

    if (input.successUrl) {
      preferenceData.success_url = input.successUrl;
    }
    if (input.errorUrl) {
      preferenceData.error_url = input.errorUrl;
    }

    try {
      const response = await fetch(`${this.apiBaseUrl}/v1/checkout_preferences`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'x-api-secret': this.apiSecret,
        },
        body: JSON.stringify(preferenceData),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`ONE API error: ${response.status} ${errorText}`);
        throw new Error(`ONE API error: ${response.status}`);
      }

      const preference: OneCheckoutPreference = await response.json();

      // Create payment order
      const orderResponse = await fetch(`${this.apiBaseUrl}/v1/payment_orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'x-api-secret': this.apiSecret,
        },
        body: JSON.stringify({
          checkout_preference_id: preference.id,
          external_id: input.orderId,
        }),
      });

      if (!orderResponse.ok) {
        const errorText = await orderResponse.text();
        this.logger.error(`ONE API error creating order: ${orderResponse.status} ${errorText}`);
        throw new Error(`ONE API error: ${orderResponse.status}`);
      }

      const order: OnePaymentOrder = await orderResponse.json();

      return {
        providerIntentId: order.id,
        providerCheckoutId: preference.id,
        checkoutUrl: preference.checkout_url || order.checkout_url,
        expiresAt: preference.expires_at
          ? new Date(preference.expires_at)
          : undefined,
        metadata: {
          preference_id: preference.id,
          order_id: order.id,
        },
      };
    } catch (error) {
      this.logger.error(`Error creating ONE payment intent: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getIntentStatus(providerIntentId: string): Promise<IntentStatusResult> {
    try {
      const response = await fetch(
        `${this.apiBaseUrl}/v1/payment_orders/${providerIntentId}`,
        {
          method: 'GET',
          headers: {
            'x-api-key': this.apiKey,
            'x-api-secret': this.apiSecret,
          },
        },
      );

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Payment order not found: ${providerIntentId}`);
        }
        const errorText = await response.text();
        this.logger.error(`ONE API error: ${response.status} ${errorText}`);
        throw new Error(`ONE API error: ${response.status}`);
      }

      const order: OnePaymentOrder = await response.json();

      // Map ONE statuses to unified statuses
      const statusMap: Record<string, 'created' | 'opened' | 'paid' | 'failed' | 'expired' | 'refunded'> = {
        OPENED: 'opened',
        CLOSED: 'paid',
        EXPIRED: 'expired',
        REJECTED: 'failed',
        REFUNDED: 'refunded',
      };

      const unifiedStatus = statusMap[order.status] || 'created';

      return {
        status: unifiedStatus,
        metadata: {
          one_status: order.status,
          external_id: order.external_id,
        },
        providerData: order as any,
      };
    } catch (error) {
      this.logger.error(`Error fetching ONE payment status: ${error.message}`, error.stack);
      throw error;
    }
  }

  async handleWebhook(rawPayload: any): Promise<WebhookParseResult> {
    // ONE webhook format: { id: string, event_type: string, entity_id: string, ... }
    const eventType = rawPayload.event_type || rawPayload.type;
    const entityId = rawPayload.entity_id || rawPayload.id;

    if (!eventType || !entityId) {
      throw new Error('Invalid ONE webhook payload: missing event_type or entity_id');
    }

    return {
      eventType,
      entityId,
      payload: rawPayload,
    };
  }
}

