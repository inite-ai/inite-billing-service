import { createHmac } from 'crypto';
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

interface HodleProviderConfig {
  apiBaseUrl: string;
  apiKey: string;
  /** The asset a paid PIX is converted into: BRS (Hodle's digital real, kept on the account) by default. */
  asset: string;
  network?: string;
  /** Destination for assets that need one (USDT/USDC); omitted for BRS. */
  address?: string;
}

/** The only currency a PIX is in. */
export const HODLE_CURRENCIES = ['BRL'];

/** Events that are recorded, not processed as a payment — nothing here to settle. */
export const HODLE_UNMATCHED_EVENT = 'hodle.event.unmatched';

const ALLOWED_HOSTS = ['api.hodle.com.br', 'sandbox-api.hodle.com.br'];
const FETCH_TIMEOUT_MS = 20_000;
/** Hodle's own guidance: refuse deliveries signed more than five minutes away from now. */
const WEBHOOK_TOLERANCE_SECONDS = 300;

/**
 * Deposit status → our intent status. The money is ours once the PIX settles
 * (`FIAT_PAID`); converting it into the asset is Hodle's step after that.
 */
const STATUS: Record<string, IntentStatusResult['status']> = {
  PENDING: 'opened',
  FIAT_PAID: 'paid',
  PROCESSING: 'paid',
  COMPLETED: 'paid',
  EXPIRED: 'expired',
  REFUNDED: 'refunded',
};

/**
 * Hodle (hodle.com.br) — PIX in reais. API reference: https://docs.hodle.com.br,
 * spec at https://hodle.com.br/openapi.json.
 *
 * A sale is a deposit (`POST /api/deposit/asset`): Hodle returns a PIX QR code
 * for the exact amount, the customer pays it from any bank app, and the reais
 * land on our Hodle account as the configured asset — BRS, Hodle's digital
 * real, unless the provider settings say otherwise. There is no page to
 * redirect to: the checkout shows the QR code and its copy-and-paste string
 * ({@link describeIntent}) and waits.
 *
 * Settlement arrives as a `DEPOSIT_PIX_CONFIRMED` webhook, signed with the
 * webhook's own secret; open deposits are also polled, since the sandbox sends
 * no webhooks at all.
 */
@RegisterConnector(RAILS.HODLE)
@Injectable()
export class HodleAdapter implements Connector {
  private readonly logger = new Logger(HodleAdapter.name);

  constructor(private readonly prisma: PrismaService) {}

  private async getConfig(): Promise<HodleProviderConfig> {
    const provider = await this.prisma.paymentProvider.findUnique({
      where: { code: RAILS.HODLE },
    });
    if (!provider || !provider.isActive) {
      throw new Error('HODLE payment provider is not configured or inactive');
    }
    const config = (provider.config as Record<string, any>) || {};
    const url = new URL(config.apiBaseUrl || 'https://api.hodle.com.br');
    // SSRF protection: only Hodle's own hosts.
    if (!ALLOWED_HOSTS.includes(url.hostname)) {
      throw new Error(`HODLE adapter: untrusted API host: ${url.hostname}`);
    }
    return {
      apiBaseUrl: url.origin,
      apiKey: config.apiKey || '',
      asset: String(config.asset || 'BRS').toUpperCase(),
      network: config.network ? String(config.network) : undefined,
      address: config.address ? String(config.address) : undefined,
    };
  }

  private async call(
    config: HodleProviderConfig,
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<any> {
    if (!config.apiKey) throw new Error('HODLE adapter: no API key configured');
    const response = await fetch(`${config.apiBaseUrl}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      let message = text;
      try {
        const parsed = JSON.parse(text);
        message = [parsed.errorCode, parsed.error].filter(Boolean).join(': ') || text;
      } catch {
        // not JSON; keep the text
      }
      const error = new Error(`Hodle ${response.status}: ${message}`) as Error & {
        status?: number;
      };
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  rail(): string {
    return RAILS.HODLE;
  }

  capabilities(): ConnectorCapabilities {
    return {
      supportedModes: ['PAYMENT'],
      requiresRedirect: false,
      statusPolling: true,
      currencies: HODLE_CURRENCIES,
      countries: ['BR'],
    };
  }

  async listMethods(): Promise<PaymentMethod[]> {
    return [{ id: 'PIX', type: 'pix', name: 'PIX', metadata: { method: 'PIX' } }];
  }

  /**
   * `X-Hodle-Signature` is hex(HMAC-SHA256(secret, "<X-Hodle-Timestamp>.<raw body>")),
   * the timestamp in Unix seconds. Fails closed without a secret, and refuses
   * a delivery signed outside the five-minute window, so a captured one cannot
   * be replayed later.
   */
  verifyWebhook({ rawBody, headers, config, payload }: WebhookVerifyInput): boolean {
    // Hodle saves a webhook only after its signed WEBHOOK_TEST gets a 2xx, and
    // shows the secret only once the webhook exists. The test settles nothing
    // (handleWebhook records it and stops), so it is let through unsigned.
    if (payload?.event === 'WEBHOOK_TEST') return true;
    const secret = config.webhookSecret || '';
    const signature = headers['x-hodle-signature'];
    const timestamp = headers['x-hodle-timestamp'];
    if (!secret || !signature || !timestamp || !/^\d+$/.test(timestamp)) return false;
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > WEBHOOK_TOLERANCE_SECONDS) return false;
    const expected = createHmac('sha256', secret)
      .update(`${timestamp}.`)
      .update(rawBody)
      .digest('hex');
    return safeTimingSafeEqual(expected, signature.trim().toLowerCase());
  }

  async createPaymentIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    if (input.mode !== 'PAYMENT') {
      throw new BadRequestException('PIX through Hodle takes one-time payments only');
    }
    const currency = String(input.currency).toUpperCase();
    if (!HODLE_CURRENCIES.includes(currency)) {
      throw new BadRequestException(`PIX takes reais; this price is in ${input.currency}`);
    }
    const value = Math.round(Number(input.amount) * 100);
    if (!Number.isFinite(value) || value < 100) {
      throw new BadRequestException('PIX through Hodle needs at least R$1.00');
    }

    const config = await this.getConfig();
    // Each attempt is its own deposit: an expired QR code is replaced, never revived.
    const externalId = `${input.orderId}-${Date.now().toString(36)}`;
    const body: Record<string, any> = {
      value,
      asset: config.asset,
      externalId,
      ...(config.network ? { network: config.network } : {}),
      ...(config.address ? { address: config.address } : {}),
    };

    let deposit: any;
    try {
      deposit = await this.call(config, '/api/deposit/asset', { method: 'POST', body });
    } catch (error: any) {
      if (error.status && error.status >= 400 && error.status < 500 && error.status !== 401) {
        throw new BadRequestException(
          `Hodle could not open this PIX: ${String(error.message).replace(/^Hodle \d+: /, '')}`,
        );
      }
      throw error;
    }
    if (!deposit?.qrCode) {
      throw new Error('Hodle created no PIX code for this deposit');
    }

    return {
      providerIntentId: deposit.externalId || externalId,
      providerCheckoutId: deposit.walletCharge ?? undefined,
      metadata: {
        hodle_external_id: deposit.externalId || externalId,
        hodle_wallet_charge: deposit.walletCharge ?? null,
        hodle_status: 'PENDING',
        qrCode: deposit.qrCode,
        value,
        fee: deposit.fee ?? null,
        asset: config.asset,
        order_id: input.orderId,
      },
    };
  }

  /**
   * Where a deposit stands, with the reais it settled. The QR code is for a
   * fixed amount, so a settled deposit's `value` is what the customer paid.
   * A delivery that failed after the PIX settled still counts as paid: the
   * money arrived, and Hodle refunds it with a refund event if it gives up.
   */
  async getIntentStatus(providerIntentId: string): Promise<IntentStatusResult> {
    const config = await this.getConfig();
    const res = await this.call(
      config,
      `/api/deposit/asset/${encodeURIComponent(providerIntentId)}`,
    );
    const data = res?.data ?? {};
    const raw = String(data.status ?? '').toUpperCase();
    let status: IntentStatusResult['status'] = STATUS[raw] ?? 'created';
    if (raw === 'FAILED') status = data.paidAt ? 'paid' : 'failed';

    const value = Number(data.value);
    return {
      status,
      ...(status === 'paid' && Number.isFinite(value)
        ? { amount: value / 100, currency: 'BRL' }
        : {}),
      metadata: {
        hodle_status: data.status ?? null,
        hodle_end_to_end_id: data.endToEndId ?? null,
        hodle_paid_at: data.paidAt ?? null,
      },
      providerData: { hodleDeposit: data },
    };
  }

  /**
   * A PIX code that expired or failed cannot be paid any more: the customer
   * asking again gets a new one instead of the dead code back.
   */
  async replaceLiveIntent(intent: { providerIntentId: string | null }): Promise<boolean> {
    if (!intent.providerIntentId) return true;
    try {
      const { status } = await this.getIntentStatus(intent.providerIntentId);
      return status === 'expired' || status === 'failed';
    } catch (error: any) {
      this.logger.warn(
        `Could not check Hodle deposit ${intent.providerIntentId}: ${error.message}`,
      );
      return false;
    }
  }

  /** The PIX to pay: its QR code and copy-and-paste string, and how it stands. */
  async describeIntent(intent: {
    providerIntentId: string | null;
    status: string;
    snapshot: unknown;
  }): Promise<Record<string, any> | null> {
    if (!intent.providerIntentId) return null;
    const snapshot = (intent.snapshot as Record<string, any>) || {};
    const qrCode = snapshot.qrCode ?? snapshot.hodleDeposit?.qrCode;
    if (!qrCode) return null;
    const value = Number(snapshot.value ?? snapshot.hodleDeposit?.value);
    return {
      type: 'pix',
      qrCode,
      amount: Number.isFinite(value) ? (value / 100).toFixed(2) : null,
      currency: 'BRL',
      depositStatus: snapshot.hodleDeposit?.status ?? snapshot.hodle_status ?? 'PENDING',
    };
  }

  /**
   * A Hodle webhook: `{ event, data }`, with our deposit id in `data.externalId`.
   * The PIX settling is the sale; a full refund takes it back. A failed delivery
   * or a partial refund changes nothing on our side and is only recorded.
   */
  async handleWebhook(rawPayload: any): Promise<WebhookParseResult> {
    const event = rawPayload?.event;
    const data = rawPayload?.data ?? {};
    if (event === 'WEBHOOK_TEST') {
      return {
        webhookId: `hodle_test_${data.eventId ?? Date.now()}`,
        eventType: HODLE_UNMATCHED_EVENT,
        entityId: 'test',
        rail: RAILS.HODLE,
        payload: rawPayload,
      };
    }
    const externalId = data.externalId;
    if (!event || !externalId) {
      throw new BadRequestException('Invalid Hodle webhook: missing event or data.externalId');
    }

    let eventType = HODLE_UNMATCHED_EVENT;
    if (event === 'DEPOSIT_PIX_CONFIRMED' || event === 'DEPOSIT_ASSET_SUCCESS') {
      eventType = 'payment.paid';
    } else if (event === 'DEPOSIT_ASSET_REFUNDED' && data.status === 'REFUNDED') {
      eventType = 'payment.refunded';
    } else if (event.startsWith('DEPOSIT_')) {
      this.logger.warn(`Hodle ${event} for deposit ${externalId}: ${data.errorCode ?? ''}`);
    }

    return {
      webhookId: `hodle_${data.eventId ?? `${externalId}_${event}`}`,
      eventType,
      entityId: String(externalId),
      rail: RAILS.HODLE,
      payload: rawPayload,
    };
  }
}
