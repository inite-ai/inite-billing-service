import { Injectable, Logger } from '@nestjs/common';
import {
  PaymentRailAdapter,
  CreateIntentInput,
  CreateIntentResult,
  IntentStatusResult,
  PaymentMethod,
  WebhookParseResult,
} from '../../common/interfaces/payment-rail-adapter.interface';
import { PrismaService } from '../../common/services/prisma.service';
import { createHmac } from 'crypto';

interface StripeProviderConfig {
  secretKey: string;
  webhookSecret: string;
  apiVersion: string;
}

/**
 * Stripe payment adapter
 *
 * API: https://docs.stripe.com/api
 * Auth: Bearer token (Secret Key)
 * Checkout: Stripe Checkout Sessions
 * Currencies: 135+ currencies
 * Methods: Cards, wallets (Apple Pay, Google Pay), bank transfers, SEPA, etc.
 *
 * Webhook events: checkout.session.completed, payment_intent.succeeded,
 *   payment_intent.payment_failed, charge.refunded,
 *   customer.subscription.created, customer.subscription.updated,
 *   customer.subscription.deleted
 */
@Injectable()
export class StripeAdapter implements PaymentRailAdapter {
  private readonly logger = new Logger(StripeAdapter.name);
  private readonly API_BASE = 'https://api.stripe.com';

  constructor(private readonly prisma: PrismaService) {}

  private async getConfig(): Promise<StripeProviderConfig> {
    const provider = await this.prisma.paymentProvider.findUnique({
      where: { code: 'STRIPE' },
    });

    if (!provider || !provider.isActive) {
      throw new Error('STRIPE payment provider is not configured or inactive');
    }

    const config = (provider.config as Record<string, any>) || {};

    return {
      secretKey: config.secretKey || '',
      webhookSecret: config.webhookSecret || '',
      apiVersion: config.apiVersion || '2024-12-18.acacia',
    };
  }

  rail(): string {
    return 'STRIPE';
  }

  private async stripeRequest(
    method: string,
    path: string,
    body?: Record<string, any>,
  ): Promise<any> {
    const { secretKey, apiVersion } = await this.getConfig();

    const headers: Record<string, string> = {
      Authorization: `Bearer ${secretKey}`,
      'Stripe-Version': apiVersion,
    };

    const options: RequestInit = { method, headers };

    if (body) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      options.body = this.encodeFormData(body);
    }

    const response = await fetch(`${this.API_BASE}${path}`, options);

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      const errorMsg = errorBody?.error?.message || response.statusText;
      this.logger.error(`Stripe API error: ${response.status} ${errorMsg}`);
      throw new Error(`Stripe API error: ${response.status} — ${errorMsg}`);
    }

    return response.json();
  }

  /**
   * Encode nested object to Stripe's form-data format
   * e.g. { line_items: [{ price_data: { unit_amount: 100 } }] }
   * becomes "line_items[0][price_data][unit_amount]=100"
   */
  private encodeFormData(obj: Record<string, any>, prefix = ''): string {
    const pairs: string[] = [];

    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}[${key}]` : key;

      if (value === null || value === undefined) continue;

      if (Array.isArray(value)) {
        value.forEach((item, i) => {
          if (typeof item === 'object' && item !== null) {
            pairs.push(this.encodeFormData(item, `${fullKey}[${i}]`));
          } else {
            pairs.push(
              `${encodeURIComponent(`${fullKey}[${i}]`)}=${encodeURIComponent(String(item))}`,
            );
          }
        });
      } else if (typeof value === 'object') {
        pairs.push(this.encodeFormData(value, fullKey));
      } else {
        pairs.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(String(value))}`);
      }
    }

    return pairs.filter(Boolean).join('&');
  }

  async createPaymentIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    try {
      if (input.mode === 'SUBSCRIPTION') {
        return this.createSubscriptionCheckout(input);
      }
      return this.createPaymentCheckout(input);
    } catch (error: any) {
      this.logger.error(`Error creating Stripe payment intent: ${error.message}`, error.stack);
      throw error;
    }
  }

  private async createPaymentCheckout(input: CreateIntentInput): Promise<CreateIntentResult> {
    // Amount in smallest currency unit (cents for USD)
    const amountInCents = Math.round(input.amount * 100);

    const sessionData: Record<string, any> = {
      mode: 'payment',
      'line_items[0][price_data][currency]': input.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': amountInCents,
      'line_items[0][price_data][product_data][name]': input.metadata?.productName || 'Order',
      'line_items[0][quantity]': 1,
      'metadata[order_id]': input.orderId,
      payment_intent_data: {
        metadata: { order_id: input.orderId },
      },
    };

    if (input.successUrl) sessionData.success_url = input.successUrl;
    if (input.errorUrl) sessionData.cancel_url = input.errorUrl;
    if (input.metadata?.customerEmail) {
      sessionData.customer_email = input.metadata.customerEmail;
    }

    const session = await this.stripeRequest('POST', '/v1/checkout/sessions', {
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: input.currency.toLowerCase(),
            unit_amount: amountInCents,
            product_data: {
              name: input.metadata?.productName || 'Order',
            },
          },
          quantity: 1,
        },
      ],
      metadata: { order_id: input.orderId },
      success_url: input.successUrl || undefined,
      cancel_url: input.errorUrl || undefined,
      customer_email: input.metadata?.customerEmail || undefined,
    });

    return {
      providerIntentId: session.payment_intent || session.id,
      providerCheckoutId: session.id,
      checkoutUrl: session.url,
      expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : undefined,
      metadata: {
        stripe_session_id: session.id,
        stripe_payment_intent: session.payment_intent,
        order_id: input.orderId,
      },
    };
  }

  private async createSubscriptionCheckout(input: CreateIntentInput): Promise<CreateIntentResult> {
    const amountInCents = Math.round(input.amount * 100);
    const interval = input.metadata?.interval || 'month';

    const session = await this.stripeRequest('POST', '/v1/checkout/sessions', {
      mode: 'subscription',
      line_items: [
        {
          price_data: {
            currency: input.currency.toLowerCase(),
            unit_amount: amountInCents,
            recurring: { interval },
            product_data: {
              name: input.metadata?.productName || 'Subscription',
            },
          },
          quantity: 1,
        },
      ],
      metadata: { order_id: input.orderId },
      success_url: input.successUrl || undefined,
      cancel_url: input.errorUrl || undefined,
      customer_email: input.metadata?.customerEmail || undefined,
      subscription_data: {
        metadata: { order_id: input.orderId },
      },
    });

    return {
      providerIntentId: session.subscription || session.id,
      providerCheckoutId: session.id,
      checkoutUrl: session.url,
      expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : undefined,
      metadata: {
        stripe_session_id: session.id,
        stripe_subscription: session.subscription,
        order_id: input.orderId,
      },
    };
  }

  async getIntentStatus(providerIntentId: string): Promise<IntentStatusResult> {
    try {
      // Try as payment intent first
      if (providerIntentId.startsWith('pi_')) {
        const pi = await this.stripeRequest('GET', `/v1/payment_intents/${providerIntentId}`);

        const statusMap: Record<string, IntentStatusResult['status']> = {
          requires_payment_method: 'created',
          requires_confirmation: 'created',
          requires_action: 'opened',
          processing: 'opened',
          succeeded: 'paid',
          canceled: 'failed',
          requires_capture: 'opened',
        };

        return {
          status: statusMap[pi.status] || 'created',
          metadata: { stripe_status: pi.status },
          providerData: {
            id: pi.id,
            amount: pi.amount,
            currency: pi.currency,
            status: pi.status,
          },
        };
      }

      // Try as checkout session
      if (providerIntentId.startsWith('cs_')) {
        const session = await this.stripeRequest(
          'GET',
          `/v1/checkout/sessions/${providerIntentId}`,
        );

        const statusMap: Record<string, IntentStatusResult['status']> = {
          open: 'opened',
          complete: 'paid',
          expired: 'expired',
        };

        return {
          status: statusMap[session.status] || 'created',
          metadata: { stripe_status: session.status },
          providerData: session,
        };
      }

      // Try as subscription
      if (providerIntentId.startsWith('sub_')) {
        const sub = await this.stripeRequest('GET', `/v1/subscriptions/${providerIntentId}`);

        const statusMap: Record<string, IntentStatusResult['status']> = {
          active: 'paid',
          trialing: 'paid',
          past_due: 'opened',
          canceled: 'failed',
          unpaid: 'failed',
          incomplete: 'opened',
          incomplete_expired: 'expired',
        };

        return {
          status: statusMap[sub.status] || 'created',
          metadata: { stripe_status: sub.status },
          providerData: sub,
        };
      }

      throw new Error(`Unknown Stripe ID format: ${providerIntentId}`);
    } catch (error: any) {
      this.logger.error(`Error fetching Stripe status: ${error.message}`);
      throw error;
    }
  }

  async listMethods(): Promise<PaymentMethod[]> {
    return [
      { id: 'card', type: 'card', name: 'Credit/Debit Card' },
      { id: 'apple_pay', type: 'wallet', name: 'Apple Pay' },
      { id: 'google_pay', type: 'wallet', name: 'Google Pay' },
      { id: 'sepa_debit', type: 'bank_transfer', name: 'SEPA Direct Debit' },
      { id: 'ideal', type: 'bank_transfer', name: 'iDEAL' },
    ];
  }

  /**
   * Handle Stripe webhook
   *
   * Stripe signs webhooks with HMAC-SHA256.
   * rawPayload should contain { body, signature } where signature is the
   * Stripe-Signature header value.
   */
  async handleWebhook(rawPayload: any): Promise<WebhookParseResult> {
    const event = rawPayload.body || rawPayload;
    const eventType = event.type;
    const obj = event.data?.object;

    if (!eventType || !obj) {
      throw new Error('Invalid Stripe webhook: missing type or data.object');
    }

    // Map Stripe event types to billing events
    const eventMap: Record<string, string> = {
      'checkout.session.completed': 'payment.paid',
      'payment_intent.succeeded': 'payment.paid',
      'payment_intent.payment_failed': 'payment.failed',
      'charge.refunded': 'payment.refunded',
      'customer.subscription.created': 'subscription.created',
      'customer.subscription.updated': 'subscription.updated',
      'customer.subscription.deleted': 'subscription.cancelled',
      'invoice.payment_succeeded': 'subscription.renewed',
      'invoice.payment_failed': 'subscription.renewal_failed',
    };

    // Extract entity ID per event type. For payment events the entity is the
    // PaymentIntent (looked up in our PaymentIntent table). For subscription
    // lifecycle events the entity is the Stripe subscription (sub_xxx), which
    // we anchor to via Subscription.providerSubscriptionId — Stripe creates a
    // new payment_intent per renewal invoice, so picking obj.payment_intent
    // here would always fail the lookup.
    const subEventTypes = new Set([
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
      'invoice.payment_succeeded',
      'invoice.payment_failed',
    ]);
    let entityId = '';
    if (subEventTypes.has(eventType)) {
      // For invoice.* obj is the invoice with obj.subscription = sub_xxx.
      // For customer.subscription.* obj IS the subscription itself.
      entityId =
        obj.subscription ||
        (typeof obj.id === 'string' && obj.id.startsWith('sub_') ? obj.id : '') ||
        '';
    } else {
      entityId = obj.payment_intent || obj.id || '';
    }

    return {
      webhookId: event.id,
      eventType: eventMap[eventType] || eventType,
      entityId,
      rail: 'STRIPE',
      payload: event,
    };
  }

  /**
   * Verify Stripe webhook signature
   */
  async verifyWebhookSignature(payload: string | Buffer, signature: string): Promise<boolean> {
    const { webhookSecret } = await this.getConfig();
    if (!webhookSecret) return false;

    const parts = signature.split(',');
    const timestamp = parts.find((p) => p.startsWith('t='))?.split('=')[1];
    const v1Signature = parts.find((p) => p.startsWith('v1='))?.split('=')[1];

    if (!timestamp || !v1Signature) return false;

    // Tolerance: 5 minutes
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp, 10)) > 300) return false;

    const signedPayload = `${timestamp}.${typeof payload === 'string' ? payload : payload.toString('utf8')}`;
    const expected = createHmac('sha256', webhookSecret).update(signedPayload).digest('hex');

    return expected === v1Signature;
  }
}
