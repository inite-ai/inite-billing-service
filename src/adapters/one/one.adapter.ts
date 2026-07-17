import { Injectable, Logger } from '@nestjs/common';
import {
  PaymentRailAdapter,
  CreateIntentInput,
  CreateIntentResult,
  IntentStatusResult,
  WebhookParseResult,
} from '../../common/interfaces/payment-rail-adapter.interface';
import { PrismaService } from '../../common/services/prisma.service';

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

interface OneProviderConfig {
  apiBaseUrl: string;
  apiKey: string;
  apiSecret: string;
}

@Injectable()
export class OneAdapter implements PaymentRailAdapter {
  private readonly logger = new Logger(OneAdapter.name);

  constructor(private readonly prisma: PrismaService) {}

  private async getConfig(): Promise<OneProviderConfig> {
    const provider = await this.prisma.paymentProvider.findUnique({
      where: { code: 'ONE' },
    });

    if (!provider || !provider.isActive) {
      throw new Error('ONE payment provider is not configured or inactive');
    }

    const config = (provider.config as Record<string, any>) || {};
    const apiBaseUrl = config.apiBaseUrl || 'https://api.one.lat';

    // SSRF protection: only allow known ONE provider hosts
    const allowedHosts = ['api.one.lat', 'sandbox.one.lat'];
    const url = new URL(apiBaseUrl);
    if (!allowedHosts.includes(url.hostname)) {
      throw new Error(`ONE adapter: untrusted API host: ${url.hostname}`);
    }

    return {
      apiBaseUrl,
      apiKey: config.apiKey || '',
      apiSecret: config.apiSecret || '',
    };
  }

  rail(): string {
    return 'ONE';
  }

  async createPaymentIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    const { apiBaseUrl, apiKey, apiSecret } = await this.getConfig();

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
      const response = await fetch(`${apiBaseUrl}/v1/checkout_preferences`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-api-secret': apiSecret,
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
      const orderResponse = await fetch(`${apiBaseUrl}/v1/payment_orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-api-secret': apiSecret,
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
        expiresAt: preference.expires_at ? new Date(preference.expires_at) : undefined,
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
    const { apiBaseUrl, apiKey, apiSecret } = await this.getConfig();

    try {
      const response = await fetch(`${apiBaseUrl}/v1/payment_orders/${providerIntentId}`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-api-secret': apiSecret,
        },
      });

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
