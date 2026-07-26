import { Injectable, Logger } from '@nestjs/common';
import {
  Connector,
  ConnectorCapabilities,
  RegisterConnector,
} from '../../common/connectors/connector.interface';
import { RAILS } from '../../common/connectors/rail';
import {
  CreateIntentInput,
  CreateIntentResult,
  IntentStatusResult,
  WebhookParseResult,
} from '../../common/interfaces/payment-rail-adapter.interface';
import { PrismaService } from '../../common/services/prisma.service';

interface LavaProviderConfig {
  apiBaseUrl: string;
  apiKey: string;
}

/**
 * Lava.top (gate.lava.top) payment adapter
 *
 * API: https://gate.lava.top/docs
 * Auth: X-Api-Key header
 * Endpoint: POST /api/v3/invoice
 * Currencies: RUB, USD, EUR
 * Providers: SMART_GLOCAL, UNLIMINT, PAYPAL, STRIPE, PAY2ME
 * Methods: CARD, SBP, PIX
 * Periodicity: ONE_TIME, MONTHLY, PERIOD_90_DAYS, PERIOD_180_DAYS, PERIOD_YEAR
 *
 * Webhook events: payment.success, payment.failed,
 *   subscription.recurring.payment.success, subscription.recurring.payment.failed,
 *   subscription.cancelled
 *
 * Contract statuses: new, in-progress, completed, failed, cancelled,
 *   subscription-active, subscription-expired, subscription-cancelled, subscription-failed
 */
@RegisterConnector(RAILS.LAVA)
@Injectable()
export class LavaAdapter implements Connector {
  private readonly logger = new Logger(LavaAdapter.name);

  constructor(private readonly prisma: PrismaService) {}

  private async getConfig(): Promise<LavaProviderConfig> {
    const provider = await this.prisma.paymentProvider.findUnique({
      where: { code: 'LAVA' },
    });

    if (!provider || !provider.isActive) {
      throw new Error('LAVA payment provider is not configured or inactive');
    }

    const config = (provider.config as Record<string, any>) || {};
    const apiBaseUrl = config.apiBaseUrl || 'https://gate.lava.top';

    // SSRF protection: only allow known Lava provider hosts
    const allowedHosts = ['gate.lava.top', 'sandbox.lava.top'];
    const url = new URL(apiBaseUrl);
    if (!allowedHosts.includes(url.hostname)) {
      throw new Error(`LAVA adapter: untrusted API host: ${url.hostname}`);
    }

    return {
      apiBaseUrl,
      apiKey: config.apiKey || '',
    };
  }

  rail(): string {
    return RAILS.LAVA;
  }

  capabilities(): ConnectorCapabilities {
    return {
      supportedModes: ['PAYMENT', 'SUBSCRIPTION'],
      requiresRedirect: true,
    };
  }

  /**
   * Maps our subscription interval to Lava periodicity
   */
  private mapPeriodicity(mode: string, metadata?: Record<string, any>): string {
    if (mode !== 'SUBSCRIPTION') return 'ONE_TIME';
    const interval = metadata?.interval || 'month';
    const map: Record<string, string> = {
      month: 'MONTHLY',
      '3months': 'PERIOD_90_DAYS',
      '6months': 'PERIOD_180_DAYS',
      year: 'PERIOD_YEAR',
    };
    return map[interval] || 'MONTHLY';
  }

  async createPaymentIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    const { apiBaseUrl, apiKey } = await this.getConfig();

    try {
      // Lava.top requires an offerId (product must be pre-created on their side)
      // If offerId is in metadata, use it; otherwise fall back to amount-based approach
      const offerId = input.metadata?.lavaOfferId;
      const buyerEmail = input.metadata?.email || input.metadata?.buyerEmail;

      if (!offerId) {
        throw new Error(
          'Lava.top requires offerId in metadata. Create product/offer on lava.top dashboard first.',
        );
      }

      if (!buyerEmail) {
        throw new Error('Lava.top requires buyer email');
      }

      const body: Record<string, any> = {
        email: buyerEmail,
        offerId,
        currency: input.currency,
        periodicity: this.mapPeriodicity(input.mode, input.metadata),
      };

      // Optional fields
      if (input.metadata?.paymentMethod) {
        body.paymentMethod = input.metadata.paymentMethod; // CARD, SBP, PIX
      }
      if (input.metadata?.buyerLanguage) {
        body.buyerLanguage = input.metadata.buyerLanguage;
      }
      if (input.metadata?.clientUtm) {
        body.clientUtm = input.metadata.clientUtm;
      }

      const response = await fetch(`${apiBaseUrl}/api/v3/invoice`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': apiKey,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Lava.top API error: ${response.status} ${errorText}`);
        throw new Error(`Lava.top API error: ${response.status} — ${errorText}`);
      }

      const invoice = await response.json();

      // Response: { id, status, amountTotal: {amount, currency}, paymentUrl }
      return {
        providerIntentId: invoice.id,
        checkoutUrl: invoice.paymentUrl,
        metadata: {
          lava_contract_id: invoice.id,
          lava_status: invoice.status,
          order_id: input.orderId,
        },
      };
    } catch (error: any) {
      this.logger.error(`Error creating Lava.top invoice: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getIntentStatus(providerIntentId: string): Promise<IntentStatusResult> {
    const { apiBaseUrl, apiKey } = await this.getConfig();

    try {
      const response = await fetch(`${apiBaseUrl}/api/v2/invoices/${providerIntentId}`, {
        headers: { 'X-Api-Key': apiKey },
      });

      if (!response.ok) {
        throw new Error(`Lava.top API error: ${response.status}`);
      }

      const invoice = await response.json();

      // Map Lava contract statuses to unified
      const statusMap: Record<string, IntentStatusResult['status']> = {
        new: 'created',
        'in-progress': 'opened',
        completed: 'paid',
        failed: 'failed',
        cancelled: 'failed',
        'subscription-active': 'paid',
        'subscription-expired': 'expired',
        'subscription-cancelled': 'failed',
        'subscription-failed': 'failed',
      };

      return {
        status: statusMap[invoice.status] || 'created',
        metadata: {
          lava_status: invoice.status,
          lava_type: invoice.type,
        },
        providerData: invoice,
      };
    } catch (error: any) {
      this.logger.error(`Error fetching Lava.top status: ${error.message}`);
      throw error;
    }
  }

  /**
   * Handle Lava.top webhook
   *
   * Event types:
   *   payment.success — successful purchase
   *   payment.failed — failed payment
   *   subscription.recurring.payment.success — renewal success
   *   subscription.recurring.payment.failed — renewal failure
   *   subscription.cancelled — subscription cancelled
   *
   * Payload: { eventType, contractId, parentContractId, product: {id, title},
   *   buyer: {email}, amount, currency, status, timestamp, errorMessage }
   *
   * Retry: 19 retries (1s, 5s, 15s, 9×1m, 4×1h)
   * Auth: X-Api-Key header or Basic auth
   */
  async handleWebhook(rawPayload: any): Promise<WebhookParseResult> {
    const eventType = rawPayload.eventType;
    const contractId = rawPayload.contractId;

    if (!eventType || !contractId) {
      throw new Error('Invalid Lava.top webhook: missing eventType or contractId');
    }

    // Map Lava event types to billing event types
    const eventMap: Record<string, string> = {
      'payment.success': 'payment.paid',
      'payment.failed': 'payment.failed',
      'subscription.recurring.payment.success': 'subscription.renewed',
      'subscription.recurring.payment.failed': 'subscription.renewal_failed',
      'subscription.cancelled': 'subscription.cancelled',
    };

    // For recurring events Lava issues a NEW contractId per renewal and
    // references the original contract via parentContractId. Our
    // Subscription.providerSubscriptionId stores the original contract ID,
    // so route the lookup to parentContractId for renewals/cancellations.
    const subEventTypes = new Set([
      'subscription.recurring.payment.success',
      'subscription.recurring.payment.failed',
      'subscription.cancelled',
    ]);
    const entityId = subEventTypes.has(eventType)
      ? rawPayload.parentContractId || contractId
      : contractId;

    return {
      webhookId: `lava_${contractId}_${eventMap[eventType] || eventType}`,
      eventType: eventMap[eventType] || eventType,
      entityId,
      rail: 'LAVA',
      payload: rawPayload,
    };
  }
}
