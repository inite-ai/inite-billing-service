import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  bindConnector,
  Connector,
  ConnectorCapabilities,
  MerchantScope,
  RegisterConnector,
  WebhookVerifyInput,
} from '../../common/connectors/connector.interface';
import { RAILS } from '../../common/connectors/rail';
import {
  CreateIntentInput,
  CreateIntentResult,
  IntentStatusResult,
  PaymentMethod,
  WebhookParseResult,
} from '../../common/interfaces/payment-rail-adapter.interface';
import { PrismaService } from '../../common/services/prisma.service';
import { toMoney } from '../../common/money';

interface YooKassaConfig {
  shopId: string;
  secretKey: string;
}

/** The only host this adapter calls. */
const API_BASE = 'https://api.yookassa.ru/v3';
const FETCH_TIMEOUT_MS = 20_000;
export const YOOKASSA_CURRENCIES = ['RUB'];

const STATUS: Record<string, IntentStatusResult['status']> = {
  pending: 'opened',
  waiting_for_capture: 'opened',
  succeeded: 'paid',
  canceled: 'failed',
};

const EVENTS: Record<string, string> = {
  'payment.succeeded': 'payment.paid',
  'payment.waiting_for_capture': 'payment.opened',
  'payment.canceled': 'payment.failed',
  'refund.succeeded': 'payment.refunded',
};

/**
 * YooKassa (yookassa.ru): cards, SBP and wallets in roubles, paid on
 * YooKassa's own page. API: https://yookassa.ru/developers/api.
 *
 * Built for a merchant's own shop (withCredentials): a payment is created
 * with `capture: true` and checked by reading it back. YooKassa does not sign
 * its notifications, so a notification is only a pointer: it is accepted when
 * the payment it names is found in this shop through the API, and the status
 * applied is the one read from the API, never the notification's.
 */
@RegisterConnector(RAILS.YOOKASSA)
@Injectable()
export class YooKassaAdapter implements Connector {
  private readonly logger = new Logger(YooKassaAdapter.name);

  /** Set only on a copy bound to a merchant's own shop. */
  private readonly merchantScope?: MerchantScope;

  constructor(private readonly prisma: PrismaService) {}

  /** INITE's own shop, if one is ever configured as a provider. */
  private async getConfig(): Promise<YooKassaConfig> {
    const provider = await this.prisma.paymentProvider.findUnique({
      where: { code: RAILS.YOOKASSA },
    });
    if (!provider || !provider.isActive) {
      throw new Error('YOOKASSA payment provider is not configured or inactive');
    }
    const config = (provider.config as Record<string, any>) || {};
    return { shopId: String(config.shopId ?? ''), secretKey: String(config.secretKey ?? '') };
  }

  withCredentials(credentials: Record<string, any>, scope: MerchantScope): Connector {
    const config: YooKassaConfig = {
      shopId: String(credentials.shopId ?? ''),
      secretKey: String(credentials.secretKey ?? ''),
    };
    return bindConnector<YooKassaAdapter>(this, {
      getConfig: async () => config,
      merchantScope: scope,
    });
  }

  rail(): string {
    return RAILS.YOOKASSA;
  }

  capabilities(): ConnectorCapabilities {
    return {
      supportedModes: ['PAYMENT'],
      requiresRedirect: true,
      supportsRefund: true,
      // Notifications are unsigned and may not be set up: payments are read back.
      statusPolling: true,
      currencies: YOOKASSA_CURRENCIES,
    };
  }

  async listMethods(): Promise<PaymentMethod[]> {
    return [{ id: 'yookassa', type: 'card', name: 'YooKassa' }];
  }

  private async call(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<any> {
    const { shopId, secretKey } = await this.getConfig();
    if (!shopId || !secretKey) throw new Error('YooKassa: no shop credentials');
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`${shopId}:${secretKey}`).toString('base64')}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(idempotencyKey ? { 'Idempotence-Key': idempotencyKey } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      // YooKassa's error body names the problem (`description`), never the key.
      const error = await response.json().catch(() => ({}));
      throw new Error(
        `YooKassa ${response.status}: ${String(error?.description ?? error?.code ?? response.statusText).slice(0, 300)}`,
      );
    }
    return response.json();
  }

  /** The shop the credentials open: `GET /me` names it, and it must be this shop id. */
  async verifyAccount(): Promise<{ hints: Record<string, unknown> }> {
    if (!this.merchantScope) throw new Error('Only a merchant connection is verified');
    const { shopId } = await this.getConfig();
    const me = await this.call('GET', '/me');
    if (String(me?.account_id ?? '') !== shopId) {
      throw new Error('These credentials open a different YooKassa shop');
    }
    if (me?.status && me.status !== 'enabled') {
      throw new Error(`The YooKassa shop is ${String(me.status).slice(0, 40)}`);
    }
    return { hints: { test: me?.test === true } };
  }

  async createPaymentIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    if (input.mode !== 'PAYMENT') throw new Error('YooKassa takes one-time payments only');
    const currency = String(input.currency).toUpperCase();
    if (!YOOKASSA_CURRENCIES.includes(currency)) {
      throw new Error(`YooKassa does not take ${currency}`);
    }
    const orderId = String(input.metadata?.order_id ?? input.orderId);
    const payment = await this.call(
      'POST',
      '/payments',
      {
        amount: { value: toMoney(input.amount).toFixed(2), currency },
        capture: true,
        confirmation: {
          type: 'redirect',
          return_url: input.successUrl || input.metadata?.checkoutReturnUrl,
        },
        description: String(input.metadata?.productName ?? `Order ${orderId}`).slice(0, 128),
        metadata: { order_id: orderId },
      },
      randomUUID(),
    );
    if (!payment?.id || !payment?.confirmation?.confirmation_url) {
      throw new Error('YooKassa did not return a payment page');
    }
    return {
      providerIntentId: payment.id,
      checkoutUrl: payment.confirmation.confirmation_url,
      expiresAt: payment.expires_at ? new Date(payment.expires_at) : undefined,
      metadata: { yookassa_payment_id: payment.id, order_id: orderId },
    };
  }

  async getIntentStatus(providerIntentId: string): Promise<IntentStatusResult> {
    const payment = await this.call('GET', `/payments/${encodeURIComponent(providerIntentId)}`);
    let status = STATUS[String(payment?.status)] ?? 'created';
    const amount = payment?.amount?.value;
    const refunded = payment?.refunded_amount?.value;
    // A partial refund leaves the sale standing; the whole amount back ends it.
    if (status === 'paid' && refunded && amount && toMoney(refunded).gte(toMoney(amount))) {
      status = 'refunded';
    }
    return {
      status,
      ...(status === 'paid' && amount
        ? { amount: Number(toMoney(amount).toFixed(4)), currency: payment.amount.currency }
        : {}),
      metadata: { yookassa_status: payment?.status ?? null },
      providerData: {
        id: payment?.id,
        status: payment?.status,
        paid: payment?.paid ?? null,
        amount: payment?.amount ?? null,
        refunded_amount: payment?.refunded_amount ?? null,
      },
    };
  }

  async refund(input: {
    providerIntentId: string;
    amount?: number;
    currency?: string;
    idempotencyKey?: string;
  }): Promise<{ refunded: boolean; providerRefundId?: string }> {
    let amount: { value: string; currency: string };
    if (input.amount != null && input.currency) {
      amount = { value: toMoney(input.amount).toFixed(2), currency: input.currency.toUpperCase() };
    } else {
      // YooKassa needs the amount: the whole payment, as it reads.
      const payment = await this.call(
        'GET',
        `/payments/${encodeURIComponent(input.providerIntentId)}`,
      );
      amount = payment.amount;
    }
    const refund = await this.call(
      'POST',
      '/refunds',
      { payment_id: input.providerIntentId, amount },
      input.idempotencyKey ?? randomUUID(),
    );
    return {
      refunded: refund?.status === 'succeeded' || refund?.status === 'pending',
      providerRefundId: refund?.id,
    };
  }

  /** The payment a notification names: its own id, or the refunded payment's. */
  private paymentIdOf(payload: any): string {
    const object = payload?.object ?? {};
    const id = String(payload?.event ?? '').startsWith('refund.') ? object.payment_id : object.id;
    return typeof id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(id) ? id : '';
  }

  /**
   * Unsigned notifications are proven by the API: the payment must exist in
   * the bound shop. A forged notification can at most make billing read a
   * payment it already had the right to read; it never sets a status.
   */
  async verifyWebhook({ payload }: WebhookVerifyInput): Promise<boolean> {
    if (payload?.type !== 'notification' || !EVENTS[payload?.event]) return false;
    const id = this.paymentIdOf(payload);
    if (!id) return false;
    try {
      const payment = await this.call('GET', `/payments/${encodeURIComponent(id)}`);
      return payment?.id === id;
    } catch (error: any) {
      this.logger.warn(`YooKassa notification for ${id} not confirmed: ${error.message}`);
      return false;
    }
  }

  async handleWebhook(rawPayload: any): Promise<WebhookParseResult> {
    const entityId = this.paymentIdOf(rawPayload);
    const event = String(rawPayload?.event ?? '');
    if (!entityId || !EVENTS[event]) throw new Error('Invalid YooKassa notification');
    return {
      webhookId: `yookassa_${String(rawPayload.object?.id ?? entityId)}_${event}`,
      eventType: EVENTS[event],
      entityId,
      rail: RAILS.YOOKASSA,
      payload: this.webhookStoragePayload(rawPayload),
    };
  }

  /** Kept: what names the payment. The card and buyer details in the body are not. */
  webhookStoragePayload(rawPayload: any): Record<string, unknown> {
    const object = rawPayload?.object ?? {};
    return {
      event: rawPayload?.event ?? null,
      object: {
        id: object.id ?? null,
        status: object.status ?? null,
        ...(object.payment_id ? { payment_id: object.payment_id } : {}),
      },
    };
  }
}
