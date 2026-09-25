import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  Connector,
  ConnectorCapabilities,
  RegisterConnector,
  WebhookVerifyInput,
} from '../../common/connectors/connector.interface';
import { safeTimingSafeEqual } from '../../common/connectors/webhook-verify.util';
import { RAILS } from '../../common/connectors/rail';
import {
  CreateIntentInput,
  CreateIntentResult,
  IntentStatusResult,
  PaymentMethod,
  WebhookParseResult,
} from '../../common/interfaces/payment-rail-adapter.interface';
import { PrismaService } from '../../common/services/prisma.service';

interface LavaProviderConfig {
  apiBaseUrl: string;
  apiKey: string;
  /**
   * An offer on lava.top with a dynamic price, used for any price that has no
   * offer of its own: the amount is sent with each invoice.
   */
  defaultOfferId?: string;
}

/** The currencies lava.top invoices in. */
export const LAVA_CURRENCIES = ['RUB', 'USD', 'EUR'];

/** Events that are recorded, not processed as a payment — nothing here to settle. */
export const LAVA_UNMATCHED_EVENT = 'lava.event.unmatched';

const ALLOWED_HOSTS = ['gate.lava.top', 'sandbox.lava.top'];
const FETCH_TIMEOUT_MS = 20_000;

/**
 * Payment methods per currency, and the lava.top provider that carries each.
 * Per the API: roubles go through SMART_GLOCAL (card) or PAY2ME (card, СБП);
 * dollars and euros through UNLIMINT (card) or PAYPAL.
 */
const METHODS: Record<string, Array<{ id: string; provider: string; method?: string }>> = {
  RUB: [
    { id: 'CARD', provider: 'SMART_GLOCAL', method: 'CARD' },
    { id: 'SBP', provider: 'PAY2ME', method: 'SBP' },
  ],
  USD: [
    { id: 'CARD', provider: 'UNLIMINT', method: 'CARD' },
    { id: 'PAYPAL', provider: 'PAYPAL' },
  ],
  EUR: [
    { id: 'CARD', provider: 'UNLIMINT', method: 'CARD' },
    { id: 'PAYPAL', provider: 'PAYPAL' },
  ],
};

/** Our price interval → lava.top periodicity. */
const PERIODICITY: Record<string, string> = {
  month: 'MONTHLY',
  quarter: 'PERIOD_90_DAYS',
  '3months': 'PERIOD_90_DAYS',
  half_year: 'PERIOD_180_DAYS',
  '6months': 'PERIOD_180_DAYS',
  year: 'PERIOD_YEAR',
};

/**
 * lava.top contract state → our intent status.
 *
 * The invoice endpoint reports `NEW / IN_PROGRESS / COMPLETED / FAILED`; the
 * webhooks and older endpoints use `completed`, `subscription-active` and so
 * on. Both spellings are normalised to one — the adapter used to map only the
 * lower-case ones, so the status it actually fetched, `COMPLETED`, matched
 * nothing and every paid order stayed unpaid.
 */
const STATUS: Record<string, IntentStatusResult['status']> = {
  new: 'created',
  'in-progress': 'opened',
  completed: 'paid',
  failed: 'failed',
  cancelled: 'failed',
  'subscription-active': 'paid',
  'subscription-expired': 'expired',
  'subscription-cancelled': 'paid',
  'subscription-failed': 'failed',
};

function normaliseStatus(raw: unknown): string {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/_/g, '-');
}

/**
 * lava.top (gate.lava.top) — cards and СБП in roubles, cards and PayPal in
 * dollars and euros. API reference: https://gate.lava.top/docs.
 *
 * Every sale on lava.top is of an *offer* — a price of a product created in
 * the lava.top dashboard. An invoice here uses, in order: the price's own
 * offer (`Price.metadata.lavaOfferId`), the product's
 * (`Product.metadata.lavaOfferId`), or the default dynamic-price offer from
 * the provider settings, with the amount sent explicitly. Subscriptions need
 * an offer of their own with the matching period.
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
    const url = new URL(apiBaseUrl);
    if (!ALLOWED_HOSTS.includes(url.hostname)) {
      throw new Error(`LAVA adapter: untrusted API host: ${url.hostname}`);
    }

    return {
      apiBaseUrl: url.origin,
      apiKey: config.apiKey || '',
      defaultOfferId:
        typeof config.defaultOfferId === 'string' ? config.defaultOfferId.trim() : undefined,
    };
  }

  private async call(
    config: LavaProviderConfig,
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<any> {
    if (!config.apiKey) throw new Error('LAVA adapter: no API key configured');
    const response = await fetch(`${config.apiBaseUrl}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        'X-Api-Key': config.apiKey,
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      let message = text;
      try {
        message = JSON.parse(text).error || text;
      } catch {
        // not JSON; keep the text
      }
      const error = new Error(`lava.top ${response.status}: ${message}`) as Error & {
        status?: number;
      };
      error.status = response.status;
      throw error;
    }
    return response.status === 204 ? null : response.json();
  }

  rail(): string {
    return RAILS.LAVA;
  }

  capabilities(): ConnectorCapabilities {
    return {
      supportedModes: ['PAYMENT', 'SUBSCRIPTION'],
      requiresRedirect: true,
      supportsCancel: true,
      selectableMethods: true,
      statusPolling: true,
      currencies: LAVA_CURRENCIES,
    };
  }

  /** Card, СБП or PayPal — whatever lava.top carries for this currency. */
  async listMethods(context: { currency?: string } = {}): Promise<PaymentMethod[]> {
    const currency = String(context.currency ?? 'RUB').toUpperCase();
    return (METHODS[currency] ?? []).map((m) => ({
      id: m.id,
      type: m.id === 'SBP' ? 'sbp' : m.id === 'PAYPAL' ? 'paypal' : 'card',
      name: m.id,
      metadata: { method: m.id },
    }));
  }

  /**
   * lava.top signs its webhooks with the key set in its webhook settings, in
   * `X-Api-Key`, or with Basic auth — whichever the author chose there. That
   * key is not the API key used to call lava.top; comparing against the API
   * key, as this used to, only worked if the two were set to the same value.
   * The API key is still accepted when no webhook key is configured, so an
   * existing setup keeps working. Fails closed when nothing is configured.
   */
  verifyWebhook({ headers, config }: WebhookVerifyInput): boolean {
    const webhookKey = config.webhookKey || config.apiKey || '';
    const header = headers['x-api-key'];
    if (webhookKey && header && safeTimingSafeEqual(webhookKey, header)) return true;

    const user = config.webhookUsername || '';
    const password = config.webhookPassword || '';
    const auth = headers['authorization'];
    if (user && password && auth?.startsWith('Basic ')) {
      const expected = Buffer.from(`${user}:${password}`).toString('base64');
      return safeTimingSafeEqual(expected, auth.slice(6).trim());
    }
    return false;
  }

  /**
   * Which lava.top offer sells this price, and whether its amount has to be
   * sent. Refuses rather than overcharge: a fixed-price offer charges its own
   * price, so an order discounted below it can only go through the dynamic
   * default offer.
   */
  private async resolveOffer(
    input: CreateIntentInput,
    config: LavaProviderConfig,
  ): Promise<{ offerId: string; amount?: number; interval: string | null }> {
    const priceCode = input.metadata?.price_code as string | undefined;
    const price = priceCode
      ? await this.prisma.price.findUnique({
          where: { code: priceCode },
          include: { product: true },
        })
      : null;
    const priceMeta = (price?.metadata as Record<string, any>) || {};
    const productMeta = (price?.product?.metadata as Record<string, any>) || {};
    const own =
      input.metadata?.lavaOfferId || priceMeta.lavaOfferId || productMeta.lavaOfferId || null;
    const interval = price?.interval && price.interval !== 'none' ? price.interval : null;
    const discounted = !!price && Number(input.amount) < Number(price.amount) - 0.005;

    if (own && !discounted) return { offerId: String(own), interval };

    if (input.mode === 'SUBSCRIPTION') {
      throw new BadRequestException(
        own
          ? 'A discounted lava.top subscription needs its own discounted offer; lava.top charges the offer price'
          : 'This subscription has no lava.top offer: set Price.metadata.lavaOfferId to a lava.top subscription offer',
      );
    }
    if (!config.defaultOfferId) {
      throw new BadRequestException(
        own
          ? 'This order is discounted below the lava.top offer price; configure a dynamic-price default offer to sell it'
          : 'No lava.top offer for this price: set Price.metadata.lavaOfferId, or a dynamic-price default offer in the LAVA provider settings',
      );
    }
    return { offerId: config.defaultOfferId, amount: Number(input.amount), interval };
  }

  async createPaymentIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    const config = await this.getConfig();
    const currency = String(input.currency).toUpperCase();
    if (!LAVA_CURRENCIES.includes(currency)) {
      throw new BadRequestException(
        `lava.top takes ${LAVA_CURRENCIES.join(', ')}; this price is in ${input.currency}`,
      );
    }

    const email = input.metadata?.buyerEmail || input.metadata?.email;
    if (!email) {
      throw new BadRequestException('lava.top needs the buyer’s email, and this account has none');
    }

    const { offerId, amount, interval } = await this.resolveOffer(input, config);

    let periodicity = 'ONE_TIME';
    if (input.mode === 'SUBSCRIPTION') {
      periodicity = PERIODICITY[interval ?? 'month'] ?? '';
      if (!periodicity) {
        throw new BadRequestException(`lava.top has no subscription period for "${interval}"`);
      }
    }

    const methodId = String(input.method || input.metadata?.paymentMethod || '').toUpperCase();
    const method = (METHODS[currency] ?? []).find((m) => m.id === methodId);

    const body: Record<string, any> = {
      email,
      offerId,
      currency,
      periodicity,
      ...(amount !== undefined ? { amount } : {}),
      ...(method ? { paymentProvider: method.provider } : {}),
      ...(method?.method ? { paymentMethod: method.method } : {}),
      ...(input.metadata?.buyerLanguage ? { buyerLanguage: input.metadata.buyerLanguage } : {}),
      ...(input.metadata?.clientUtm ? { clientUtm: input.metadata.clientUtm } : {}),
    };
    // The customer comes back to our checkout page whatever happened — it
    // checks the payment with lava.top itself and then goes on to the shop's
    // success page, so a missing or late webhook costs nothing. Without these
    // the customer finished on lava.top's page with no way back.
    const back = input.metadata?.checkoutReturnUrl
      ? `${input.metadata.checkoutReturnUrl}?returned=1`
      : input.successUrl || input.metadata?.returnUrl;
    if (back) {
      body.successful_return_url = back;
      body.failure_return_url = back;
      body.cancel_return_url = back;
    }

    let invoice: any;
    try {
      invoice = await this.call(config, '/api/v3/invoice', { method: 'POST', body });
    } catch (error: any) {
      // lava.top refusing the invoice — an amount outside its limits, an offer
      // it does not have — is something the customer or admin can act on, not
      // a server fault. It used to surface as a bare "Internal server error".
      if (error.status && error.status >= 400 && error.status < 500 && error.status !== 401) {
        throw new BadRequestException(
          `lava.top could not open this payment: ${String(error.message).replace(/^lava\.top \d+: /, '')}`,
        );
      }
      throw error;
    }
    if (!invoice?.id || !invoice?.paymentUrl) {
      throw new Error('lava.top created no payment link for this offer');
    }

    return {
      providerIntentId: invoice.id,
      checkoutUrl: invoice.paymentUrl,
      metadata: {
        lava_contract_id: invoice.id,
        lava_status: invoice.status,
        lava_offer_id: offerId,
        lava_amount_total: invoice.amountTotal ?? null,
        buyerEmail: email,
        periodicity,
        order_id: input.orderId,
      },
    };
  }

  /**
   * Where a lava.top contract stands, with the amount it settled — the
   * processor refuses to mark anything paid without one, and the adapter
   * used to report none, so even a correctly read payment would have been
   * failed.
   *
   * A refund or chargeback lava.top told us about (recorded on the intent by
   * {@link handleWebhook}) is reported as refunded: lava.top's contract
   * status does not change for one.
   */
  async getIntentStatus(providerIntentId: string): Promise<IntentStatusResult> {
    const config = await this.getConfig();

    const intent = await this.prisma.paymentIntent.findFirst({
      where: { providerIntentId, rail: RAILS.LAVA },
    });
    const snapshot = (intent?.snapshot as Record<string, any>) || {};
    if (snapshot.lavaRefund && snapshot.lavaRefund.full !== false) {
      return {
        status: 'refunded',
        metadata: { lava_event: snapshot.lavaRefund.eventType },
        providerData: snapshot,
      };
    }

    const invoice = await this.call(
      config,
      `/api/v2/invoices/${encodeURIComponent(providerIntentId)}`,
    );
    const raw = normaliseStatus(invoice?.status);
    const status = STATUS[raw] ?? 'created';

    const receipt = invoice?.receipt ?? {};
    const settled = typeof receipt.amount === 'number' ? receipt.amount : undefined;
    return {
      status,
      ...(status === 'paid' && settled !== undefined
        ? { amount: settled, currency: receipt.currency }
        : {}),
      metadata: {
        lava_status: invoice?.status,
        lava_type: invoice?.type,
        lava_subscription_status: invoice?.subscriptionStatus ?? null,
      },
      providerData: { ...snapshot, lavaInvoice: invoice },
    };
  }

  /**
   * A subscription's state, read from lava.top instead of waiting for a
   * webhook. The first contract of a subscription reports whether it is
   * active and until when it is paid; a paid-until date past our period end
   * is a renewal, a cancelled or failed status the matching event.
   */
  async syncSubscription(subscription: {
    providerSubscriptionId: string;
    currentPeriodEnd: Date;
    status: string;
  }): Promise<
    'subscription.renewed' | 'subscription.renewal_failed' | 'subscription.cancelled' | null
  > {
    const config = await this.getConfig();
    const invoice = await this.call(
      config,
      `/api/v2/invoices/${encodeURIComponent(subscription.providerSubscriptionId)}`,
    );
    const state = String(invoice?.subscriptionStatus ?? '').toUpperCase();
    if (state === 'CANCELLED') return 'subscription.cancelled';
    if (state === 'FAILED')
      return subscription.status === 'past_due' ? null : 'subscription.renewal_failed';
    if (state !== 'ACTIVE') return null;

    const paidUntil = invoice?.subscriptionDetails?.expiredAt
      ? new Date(invoice.subscriptionDetails.expiredAt)
      : null;
    // An hour of slack: lava.top's date and ours are computed separately and
    // the same period should not read as a renewal.
    if (
      paidUntil &&
      paidUntil.getTime() > subscription.currentPeriodEnd.getTime() + 60 * 60 * 1000
    ) {
      return 'subscription.renewed';
    }
    return null;
  }

  /**
   * Cancel a lava.top subscription, so it stops charging — cancelling only
   * our record left the customer paying for access they no longer had.
   * lava.top identifies it by the first contract and the buyer's email.
   */
  async cancelSubscription(input: {
    providerSubscriptionId: string;
    atPeriodEnd?: boolean;
  }): Promise<{ cancelled: boolean }> {
    const config = await this.getConfig();
    const intent = await this.prisma.paymentIntent.findFirst({
      where: { providerIntentId: input.providerSubscriptionId, rail: RAILS.LAVA },
    });
    const snapshot = (intent?.snapshot as Record<string, any>) || {};
    const email = snapshot.buyerEmail || snapshot.lavaInvoice?.buyer?.email;
    if (!email) {
      this.logger.warn(`No buyer email for lava.top subscription ${input.providerSubscriptionId}`);
      return { cancelled: false };
    }
    const query = new URLSearchParams({ contractId: input.providerSubscriptionId, email });
    try {
      await this.call(config, `/api/v1/subscriptions?${query}`, { method: 'DELETE' });
      return { cancelled: true };
    } catch (error: any) {
      // Already cancelled on lava.top's side is the outcome we wanted.
      if (error.status === 404) return { cancelled: true };
      throw error;
    }
  }

  /**
   * A lava.top webhook.
   *
   * Purchase and subscription events carry `eventType` and `contractId`.
   * Refund and chargeback events are a different shape — `event_type` and a
   * `data` object with no contract id at all — and used to be thrown out as
   * invalid, which lava.top answers by retrying nineteen times. They are
   * matched to the sale by product offer, buyer email and amount.
   */
  async handleWebhook(rawPayload: any): Promise<WebhookParseResult> {
    const refundType = rawPayload?.event_type;
    if (refundType === 'refund.success' || refundType === 'chargeback.initiated') {
      return this.handleRefund(rawPayload);
    }

    const eventType = rawPayload?.eventType;
    const contractId = rawPayload?.contractId;
    if (!eventType || !contractId) {
      throw new BadRequestException('Invalid lava.top webhook: missing eventType or contractId');
    }

    const eventMap: Record<string, string> = {
      'payment.success': 'payment.paid',
      'payment.failed': 'payment.failed',
      'subscription.recurring.payment.success': 'subscription.renewed',
      'subscription.recurring.payment.failed': 'subscription.renewal_failed',
      'subscription.cancelled': 'subscription.cancelled',
    };
    const mapped = eventMap[eventType] || eventType;

    // Our subscription is anchored to the contract that started it. Renewals
    // name it in parentContractId; a cancellation carries only the latest
    // contract, so its parent is looked up.
    let entityId = contractId;
    if (eventType.startsWith('subscription.')) {
      entityId = rawPayload.parentContractId || (await this.parentOf(contractId)) || contractId;
    }

    return {
      webhookId: `lava_${contractId}_${mapped}`,
      eventType: mapped,
      entityId,
      rail: RAILS.LAVA,
      payload: rawPayload,
    };
  }

  private async parentOf(contractId: string): Promise<string | null> {
    // Already the first contract of a subscription we know.
    const known = await this.prisma.subscription.findFirst({
      where: { rail: RAILS.LAVA, providerSubscriptionId: contractId },
      select: { id: true },
    });
    if (known) return contractId;
    try {
      const invoice = await this.call(
        await this.getConfig(),
        `/api/v2/invoices/${encodeURIComponent(contractId)}`,
      );
      return invoice?.parentInvoice?.id ?? null;
    } catch (error: any) {
      this.logger.warn(
        `Could not resolve parent of lava.top contract ${contractId}: ${error.message}`,
      );
      return null;
    }
  }

  private async handleRefund(rawPayload: any): Promise<WebhookParseResult> {
    const data = rawPayload.data ?? {};
    const eventId = rawPayload.event_id || data.refund_id || data.chargeback_id;
    const email = data.customer_email;
    const offerId = data.product?.tier_id;
    const amount = Number(data.amount);

    const candidates = email
      ? await this.prisma.paymentIntent.findMany({
          where: { rail: RAILS.LAVA, status: 'paid' },
          orderBy: { createdAt: 'desc' },
          take: 200,
        })
      : [];
    const intent = candidates.find((candidate) => {
      const s = (candidate.snapshot as Record<string, any>) || {};
      const sameBuyer = String(s.buyerEmail ?? '').toLowerCase() === String(email).toLowerCase();
      const sameOffer = !offerId || !s.lava_offer_id || s.lava_offer_id === offerId;
      const sameAmount =
        !Number.isFinite(amount) || Math.abs(Number(candidate.amount) - amount) < 0.01;
      return sameBuyer && sameOffer && sameAmount;
    });

    if (!intent?.providerIntentId) {
      this.logger.warn(
        `lava.top ${rawPayload.event_type} ${eventId} matches no paid order (${email}, ${amount})`,
      );
      return {
        webhookId: `lava_${eventId}_${rawPayload.event_type}`,
        eventType: LAVA_UNMATCHED_EVENT,
        entityId: String(eventId),
        rail: RAILS.LAVA,
        payload: rawPayload,
      };
    }

    // A partial refund leaves the sale standing; a full refund or a chargeback
    // takes the money back, and the access it paid for goes with it.
    const full = rawPayload.event_type === 'chargeback.initiated' || data.refund_type !== 'partial';
    const snapshot = (intent.snapshot as Record<string, any>) || {};
    await this.prisma.paymentIntent.update({
      where: { id: intent.id },
      data: {
        snapshot: {
          ...snapshot,
          lavaRefund: { eventType: rawPayload.event_type, eventId, full, data },
        },
      },
    });

    return {
      webhookId: `lava_${eventId}_${rawPayload.event_type}`,
      eventType: full ? 'payment.refunded' : LAVA_UNMATCHED_EVENT,
      entityId: intent.providerIntentId,
      rail: RAILS.LAVA,
      payload: rawPayload,
    };
  }
}
