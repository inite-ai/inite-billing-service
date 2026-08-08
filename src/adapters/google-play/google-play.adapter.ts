import { Injectable, Logger } from '@nestjs/common';
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
import { createSign } from 'crypto';

interface GooglePlayConfig {
  packageName: string;
  serviceAccountEmail: string;
  privateKey: string;
}

/**
 * Google Play Billing adapter (Android Publisher API v3)
 *
 * API: https://developers.google.com/android-publisher/api-ref/rest
 * Auth: OAuth 2.0 Service Account (JWT → access token)
 *
 * Flow:
 * 1. Client (Android app) initiates purchase via Google Play Billing Library
 * 2. Client sends purchaseToken to billing service
 * 3. Billing service verifies purchase via Android Publisher API
 * 4. Billing service acknowledges and applies state transition
 *
 * Real-Time Developer Notifications (RTDN):
 * https://developer.android.com/google/play/billing/rtdn-reference
 * Pub/Sub topic for subscription state changes
 */
@RegisterConnector(RAILS.GOOGLE_PLAY)
@Injectable()
export class GooglePlayAdapter implements Connector {
  private readonly logger = new Logger(GooglePlayAdapter.name);
  private readonly PLAY_API_BASE = 'https://androidpublisher.googleapis.com/androidpublisher/v3';
  private readonly TOKEN_URL = 'https://oauth2.googleapis.com/token';

  private cachedToken: { token: string; expiresAt: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private async getConfig(): Promise<GooglePlayConfig> {
    const provider = await this.prisma.paymentProvider.findUnique({
      where: { code: 'GOOGLE_PLAY' },
    });

    if (!provider || !provider.isActive) {
      throw new Error('GOOGLE_PLAY payment provider is not configured or inactive');
    }

    const config = (provider.config as Record<string, any>) || {};

    return {
      packageName: config.packageName || '',
      serviceAccountEmail: config.serviceAccountEmail || '',
      privateKey: config.privateKey || '',
    };
  }

  /**
   * Generate a Google Service Account JWT and exchange for access token
   */
  private async getAccessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);

    // Return cached token if still valid (with 60s buffer)
    if (this.cachedToken && this.cachedToken.expiresAt > now + 60) {
      return this.cachedToken.token;
    }

    const config = await this.getConfig();

    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
      iss: config.serviceAccountEmail,
      scope: 'https://www.googleapis.com/auth/androidpublisher',
      aud: this.TOKEN_URL,
      iat: now,
      exp: now + 3600,
    };

    const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signingInput = `${headerB64}.${payloadB64}`;

    const sign = createSign('RSA-SHA256');
    sign.update(signingInput);
    const signature = sign.sign(config.privateKey, 'base64url');

    const jwt = `${signingInput}.${signature}`;

    // Exchange JWT for access token
    const response = await fetch(this.TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`Google OAuth error: ${response.status} ${errorText}`);
      throw new Error(`Google OAuth error: ${response.status}`);
    }

    const tokenData = await response.json();

    this.cachedToken = {
      token: tokenData.access_token,
      expiresAt: now + (tokenData.expires_in || 3600),
    };

    return this.cachedToken.token;
  }

  private async googleRequest(method: string, path: string): Promise<any> {
    const token = await this.getAccessToken();

    const response = await fetch(`${this.PLAY_API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`Google Play API error: ${response.status} ${errorText}`);
      throw new Error(`Google Play API error: ${response.status} — ${errorText}`);
    }

    return response.json();
  }

  rail(): string {
    return RAILS.GOOGLE_PLAY;
  }

  capabilities(): ConnectorCapabilities {
    return {
      supportedModes: ['SUBSCRIPTION', 'PAYMENT'],
      isClientSide: true,
    };
  }

  /** Google Pub/Sub push authenticates with an OAuth Bearer token we compare to
   * the configured pubsubToken. Fails closed when the token is unset. */
  verifyWebhook({ headers, config }: WebhookVerifyInput): boolean {
    const expectedToken = (config as any).pubsubToken;
    if (!expectedToken) return false;
    const token = headers['authorization']?.replace('Bearer ', '');
    return !!token && safeTimingSafeEqual(expectedToken, token);
  }

  /** RTDN wraps the notification as a base64 Pub/Sub envelope — persist the
   * decoded JSON, not the envelope, matching the prior controller behaviour. */
  webhookStoragePayload(rawPayload: any): any {
    return typeof rawPayload.message?.data === 'string'
      ? JSON.parse(Buffer.from(rawPayload.message.data, 'base64').toString())
      : rawPayload;
  }

  /** Google anchors a subscription on the purchase token, which we persist as
   * the PaymentIntent providerIntentId. Mirrors the orchestrator's linkage. */
  subscriptionAnchorId(snapshot: Record<string, any>, intent?: any): string | null {
    return (
      intent?.providerIntentId || snapshot?.google_purchase_token || snapshot?.purchaseToken || null
    );
  }

  /**
   * Google Play doesn't create intents server-side.
   * The Android client creates purchases via Play Billing Library.
   * This method records the intent with the purchase token from the client.
   */
  async createPaymentIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    const purchaseToken = input.metadata?.purchaseToken;
    const googleProductId = input.metadata?.googleProductId;

    if (!purchaseToken) {
      throw new Error(
        'Google Play requires purchaseToken in metadata (from Play Billing Library purchase)',
      );
    }

    this.logger.log(`Recording Google Play purchase for order ${input.orderId}`);

    // Verify the purchase immediately
    const config = await this.getConfig();
    let verified = false;

    try {
      if (input.mode === 'SUBSCRIPTION') {
        await this.googleRequest(
          'GET',
          `/applications/${config.packageName}/purchases/subscriptionsv2/tokens/${purchaseToken}`,
        );
      } else {
        await this.googleRequest(
          'GET',
          `/applications/${config.packageName}/purchases/products/${googleProductId}/tokens/${purchaseToken}`,
        );
      }
      verified = true;
    } catch (error: any) {
      this.logger.warn(`Could not verify Google Play purchase immediately: ${error.message}`);
    }

    return {
      providerIntentId: purchaseToken,
      metadata: {
        google_purchase_token: purchaseToken,
        google_product_id: googleProductId,
        order_id: input.orderId,
        package_name: config.packageName,
        verified,
      },
    };
  }

  /**
   * Get purchase status from Google Play
   * providerIntentId is the purchaseToken
   */
  async getIntentStatus(providerIntentId: string): Promise<IntentStatusResult> {
    const config = await this.getConfig();

    try {
      // Try subscription first (v2 API)
      const sub = await this.googleRequest(
        'GET',
        `/applications/${config.packageName}/purchases/subscriptionsv2/tokens/${providerIntentId}`,
      );

      // SubscriptionPurchaseV2 statuses
      const statusMap: Record<string, IntentStatusResult['status']> = {
        SUBSCRIPTION_STATE_ACTIVE: 'paid',
        SUBSCRIPTION_STATE_CANCELED: 'failed',
        SUBSCRIPTION_STATE_IN_GRACE_PERIOD: 'opened',
        SUBSCRIPTION_STATE_ON_HOLD: 'opened',
        SUBSCRIPTION_STATE_PAUSED: 'opened',
        SUBSCRIPTION_STATE_EXPIRED: 'expired',
        SUBSCRIPTION_STATE_PENDING: 'created',
      };

      return {
        status: statusMap[sub.subscriptionState] || 'created',
        metadata: {
          google_state: sub.subscriptionState,
          expiry_time: sub.lineItems?.[0]?.expiryTime,
          auto_renewing: sub.lineItems?.[0]?.autoRenewingPlan?.autoRenewEnabled,
        },
        providerData: sub,
      };
    } catch {
      // Not a subscription, try one-time product
      // For one-time products, we need the productId which is in the metadata
      // stored when creating the intent. Fall back to basic status.
      this.logger.warn(`Could not fetch subscription status for token, may be a one-time product`);

      return {
        status: 'paid', // If token exists and was valid at creation, assume paid
        metadata: {
          google_purchase_token: providerIntentId,
          note: 'one-time product — verified at creation',
        },
      };
    }
  }

  /**
   * Acknowledge a purchase (required by Google within 3 days)
   */
  async acknowledgePurchase(
    productId: string,
    purchaseToken: string,
    isSubscription: boolean,
  ): Promise<void> {
    const config = await this.getConfig();
    const token = await this.getAccessToken();

    const path = isSubscription
      ? `/applications/${config.packageName}/purchases/subscriptions/${productId}/tokens/${purchaseToken}:acknowledge`
      : `/applications/${config.packageName}/purchases/products/${productId}/tokens/${purchaseToken}:acknowledge`;

    const response = await fetch(`${this.PLAY_API_BASE}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`Google Play acknowledge error: ${response.status} ${errorText}`);
      throw new Error(`Google Play acknowledge error: ${response.status}`);
    }

    this.logger.log(`Acknowledged Google Play purchase: ${productId}`);
  }

  async listMethods(): Promise<PaymentMethod[]> {
    return [
      {
        id: 'google_play',
        type: 'iap',
        name: 'Google Play',
        metadata: { platform: 'android' },
      },
    ];
  }

  /**
   * Handle Google Play Real-Time Developer Notification (RTDN)
   *
   * Google sends Pub/Sub messages with base64-encoded JSON:
   * {
   *   version: "1.0",
   *   packageName: "com.example.app",
   *   eventTimeMillis: "1234567890123",
   *   subscriptionNotification?: { ... },
   *   oneTimeProductNotification?: { ... },
   *   voidedPurchaseNotification?: { ... },
   *   testNotification?: { ... }
   * }
   *
   * Subscription notification types:
   *   1: RECOVERED, 2: RENEWED, 3: CANCELED, 4: PURCHASED,
   *   5: ON_HOLD, 6: IN_GRACE_PERIOD, 7: RESTARTED,
   *   8: PRICE_CHANGE_CONFIRMED, 9: DEFERRED, 10: PAUSED,
   *   11: PAUSE_SCHEDULE_CHANGED, 12: REVOKED, 13: EXPIRED,
   *   20: PENDING_PURCHASE_CANCELED
   */
  async handleWebhook(rawPayload: any): Promise<WebhookParseResult> {
    // Decode Pub/Sub message
    let notification: any;

    if (rawPayload.message?.data) {
      // Pub/Sub format
      const decoded = Buffer.from(rawPayload.message.data, 'base64').toString('utf-8');
      notification = JSON.parse(decoded);
    } else {
      notification = rawPayload;
    }

    const subNotif = notification.subscriptionNotification;
    const otpNotif = notification.oneTimeProductNotification;
    const voidNotif = notification.voidedPurchaseNotification;

    if (subNotif) {
      const typeMap: Record<number, string> = {
        1: 'subscription.recovered',
        2: 'subscription.renewed',
        3: 'subscription.cancelled',
        4: 'subscription.created',
        5: 'subscription.on_hold',
        6: 'subscription.grace_period',
        7: 'subscription.restarted',
        12: 'payment.refunded',
        13: 'subscription.expired',
      };

      return {
        // Google keeps the same purchaseToken across renewals and reuses
        // notificationType 2 (RENEWED) each cycle, so the token+type pair alone
        // collides on (rail, webhookId) and every renewal after the first would
        // be dropped as a duplicate. eventTimeMillis distinguishes cycles while
        // still deduping genuine RTDN re-deliveries (Pub/Sub is at-least-once).
        webhookId: `gplay_sub_${subNotif.purchaseToken}_${subNotif.notificationType}_${notification.eventTimeMillis || ''}`,
        eventType:
          typeMap[subNotif.notificationType] || `subscription.type_${subNotif.notificationType}`,
        entityId: subNotif.purchaseToken,
        rail: 'GOOGLE_PLAY',
        payload: {
          subscriptionId: subNotif.subscriptionId,
          purchaseToken: subNotif.purchaseToken,
          notificationType: subNotif.notificationType,
          packageName: notification.packageName,
        },
      };
    }

    if (otpNotif) {
      const typeMap: Record<number, string> = {
        1: 'payment.paid', // ONE_TIME_PRODUCT_PURCHASED
        2: 'payment.failed', // ONE_TIME_PRODUCT_CANCELED
      };

      return {
        webhookId: `gplay_otp_${otpNotif.purchaseToken}_${otpNotif.notificationType}`,
        eventType: typeMap[otpNotif.notificationType] || `otp.type_${otpNotif.notificationType}`,
        entityId: otpNotif.purchaseToken,
        rail: 'GOOGLE_PLAY',
        payload: {
          sku: otpNotif.sku,
          purchaseToken: otpNotif.purchaseToken,
          notificationType: otpNotif.notificationType,
          packageName: notification.packageName,
        },
      };
    }

    if (voidNotif) {
      return {
        webhookId: `gplay_void_${voidNotif.purchaseToken}`,
        eventType: 'payment.refunded',
        entityId: voidNotif.purchaseToken,
        rail: 'GOOGLE_PLAY',
        payload: {
          purchaseToken: voidNotif.purchaseToken,
          orderId: voidNotif.orderId,
          productType: voidNotif.productType,
          refundType: voidNotif.refundType,
          packageName: notification.packageName,
        },
      };
    }

    // Test notification or unknown
    return {
      webhookId: `gplay_unknown_${Date.now()}`,
      eventType: 'test',
      entityId: '',
      rail: 'GOOGLE_PLAY',
      payload: notification,
    };
  }
}
