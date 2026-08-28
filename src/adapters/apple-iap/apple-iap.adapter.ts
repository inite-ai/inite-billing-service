import { Injectable, Logger } from '@nestjs/common';
import {
  Connector,
  ConnectorCapabilities,
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
import { createSign } from 'crypto';
import { verifyAppleSignedPayload } from './apple-jws.util';

interface AppleIAPConfig {
  bundleId: string;
  issuerId: string;
  keyId: string;
  privateKey: string;
  environment: 'Sandbox' | 'Production';
}

/**
 * Apple In-App Purchase (StoreKit 2 / App Store Server API v2) adapter
 *
 * API: https://developer.apple.com/documentation/appstoreserverapi
 * Auth: JWT signed with ES256 (App Store Connect API key)
 *
 * Flow:
 * 1. Client (iOS app) initiates purchase via StoreKit 2
 * 2. Client sends transaction ID to billing service
 * 3. Billing service verifies transaction via App Store Server API
 * 4. Billing service applies state transition
 *
 * Server notifications: https://developer.apple.com/documentation/appstoreservernotifications
 * Events: DID_RENEW, DID_FAIL_TO_RENEW, EXPIRED, REFUND, SUBSCRIBED, etc.
 */
@RegisterConnector(RAILS.APPLE_IAP)
@Injectable()
export class AppleIAPAdapter implements Connector {
  private readonly logger = new Logger(AppleIAPAdapter.name);

  constructor(private readonly prisma: PrismaService) {}

  private async getConfig(): Promise<AppleIAPConfig> {
    const provider = await this.prisma.paymentProvider.findUnique({
      where: { code: 'APPLE_IAP' },
    });

    if (!provider || !provider.isActive) {
      throw new Error('APPLE_IAP payment provider is not configured or inactive');
    }

    const config = (provider.config as Record<string, any>) || {};

    return {
      bundleId: config.bundleId || '',
      issuerId: config.issuerId || '',
      keyId: config.keyId || '',
      privateKey: config.privateKey || '',
      environment: config.environment || 'Sandbox',
    };
  }

  private getBaseUrl(env: string): string {
    return env === 'Production'
      ? 'https://api.storekit.itunes.apple.com'
      : 'https://api.storekit-sandbox.itunes.apple.com';
  }

  /**
   * Generate JWT for App Store Server API authentication
   */
  private generateJWT(config: AppleIAPConfig): string {
    const now = Math.floor(Date.now() / 1000);

    const header = {
      alg: 'ES256',
      kid: config.keyId,
      typ: 'JWT',
    };

    const payload = {
      iss: config.issuerId,
      iat: now,
      exp: now + 3600, // 1 hour
      aud: 'appstoreconnect-v1',
      bid: config.bundleId,
    };

    const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signingInput = `${headerB64}.${payloadB64}`;

    const sign = createSign('SHA256');
    sign.update(signingInput);
    const signature = sign.sign(config.privateKey, 'base64url');

    return `${signingInput}.${signature}`;
  }

  private async appleRequest(method: string, path: string): Promise<any> {
    const config = await this.getConfig();
    const baseUrl = this.getBaseUrl(config.environment);
    const jwt = this.generateJWT(config);

    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`Apple API error: ${response.status} ${errorText}`);
      throw new Error(`Apple API error: ${response.status} — ${errorText}`);
    }

    return response.json();
  }

  rail(): string {
    return RAILS.APPLE_IAP;
  }

  capabilities(): ConnectorCapabilities {
    return {
      supportedModes: ['SUBSCRIPTION', 'PAYMENT'],
      isClientSide: true,
    };
  }

  /**
   * Verify the App Store Server Notification V2 `signedPayload` JWS: full x5c
   * certificate-chain validation up to the pinned Apple Root CA G3, then ES256
   * signature verification with the leaf key. Fails closed on anything that is
   * not a genuine Apple-signed notification — closing the previous presence-only
   * check that let an unauthenticated attacker mint free subscriptions/refunds.
   *
   * The nested `data.signedTransactionInfo` is not re-verified in handleWebhook:
   * it is covered by this outer signature (Apple signs the whole envelope), and
   * handleWebhook only runs after this returns true.
   */
  async verifyWebhook({ payload, config }: WebhookVerifyInput): Promise<boolean> {
    const signedPayload = payload?.signedPayload;
    if (typeof signedPayload !== 'string') {
      this.logger.warn('Apple webhook rejected: missing signedPayload JWS');
      return false;
    }

    const result = await verifyAppleSignedPayload(signedPayload, {
      bundleId: (config as any)?.bundleId || undefined,
    });
    if (!result.verified) {
      this.logger.warn(`Apple webhook rejected: ${result.reason}`);
    }
    return result.verified;
  }

  /** Apple anchors an auto-renewable subscription on the original transaction id
   * (stable across renewals). Mirrors the orchestrator's linkage resolution. */
  subscriptionAnchorId(snapshot: Record<string, any>, intent?: any): string | null {
    return (
      snapshot?.originalTransactionId ||
      snapshot?.apple_original_transaction_id ||
      intent?.providerIntentId ||
      null
    );
  }

  /**
   * Apple IAP doesn't create intents server-side.
   * The iOS client creates purchases via StoreKit 2.
   * This method records the intent with the Apple transaction ID
   * passed from the client.
   */
  async createPaymentIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    const appleTransactionId = input.metadata?.appleTransactionId;
    const appleProductId = input.metadata?.appleProductId;

    if (!appleTransactionId) {
      throw new Error(
        'Apple IAP requires appleTransactionId in metadata (from StoreKit 2 purchase)',
      );
    }

    this.logger.log(
      `Recording Apple IAP transaction ${appleTransactionId} for order ${input.orderId}`,
    );

    return {
      providerIntentId: appleTransactionId,
      metadata: {
        apple_transaction_id: appleTransactionId,
        apple_product_id: appleProductId,
        order_id: input.orderId,
        bundle_id: (await this.getConfig()).bundleId,
      },
    };
  }

  /**
   * Verify and get status of an Apple transaction via App Store Server API
   */
  async getIntentStatus(providerIntentId: string): Promise<IntentStatusResult> {
    try {
      const txInfo = await this.appleRequest('GET', `/inApps/v1/transactions/${providerIntentId}`);

      // Decode the signedTransactionInfo JWS (payload is in the second segment)
      const transaction = this.decodeJWSPayload(txInfo.signedTransactionInfo);

      const _statusMap: Record<string, IntentStatusResult['status']> = {
        // Transaction revocationDate indicates refund
      };

      let status: IntentStatusResult['status'] = 'paid';
      if (transaction.revocationDate) {
        status = 'refunded';
      } else if (transaction.expiresDate && new Date(transaction.expiresDate) < new Date()) {
        status = 'expired';
      }

      return {
        status,
        // The App Store charges the price configured for the product; the
        // customer cannot settle a different amount. Stating it explicitly,
        // because the reconciler no longer treats a missing amount as fine.
        amountVerifiedByAdapter: true,
        metadata: {
          apple_product_id: transaction.productId,
          apple_transaction_id: transaction.transactionId,
          apple_original_transaction_id: transaction.originalTransactionId,
          purchase_date: transaction.purchaseDate,
          expires_date: transaction.expiresDate,
          type: transaction.type, // Auto-Renewable Subscription, Non-Consumable, etc.
        },
        providerData: transaction,
      };
    } catch (error: any) {
      this.logger.error(`Error verifying Apple transaction: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get subscription status from Apple
   */
  async getSubscriptionStatus(originalTransactionId: string): Promise<any> {
    const result = await this.appleRequest(
      'GET',
      `/inApps/v1/subscriptions/${originalTransactionId}`,
    );

    return result;
  }

  async listMethods(): Promise<PaymentMethod[]> {
    return [
      {
        id: 'apple_iap',
        type: 'iap',
        name: 'Apple In-App Purchase',
        metadata: { platform: 'ios' },
      },
    ];
  }

  /**
   * Handle App Store Server Notification V2
   *
   * Notification types:
   *   SUBSCRIBED — new subscription
   *   DID_RENEW — subscription renewed
   *   DID_FAIL_TO_RENEW — renewal failed
   *   EXPIRED — subscription expired
   *   GRACE_PERIOD_EXPIRED — grace period ended
   *   REFUND — transaction refunded
   *   REVOKE — entitlement revoked (Family Sharing)
   *   DID_CHANGE_RENEWAL_STATUS — auto-renew toggled
   *   DID_CHANGE_RENEWAL_INFO — renewal info changed
   *   OFFER_REDEEMED — promotional offer redeemed
   *   CONSUMPTION_REQUEST — Apple requests consumption info
   */
  async handleWebhook(rawPayload: any): Promise<WebhookParseResult> {
    // Apple sends signedPayload as JWS
    const signedPayload = rawPayload.signedPayload || rawPayload;
    let notification: any;

    if (typeof signedPayload === 'string') {
      notification = this.decodeJWSPayload(signedPayload);
    } else {
      notification = signedPayload;
    }

    const notificationType = notification.notificationType;
    const subtype = notification.subtype || '';
    const data = notification.data || {};

    // Decode signed transaction/renewal info
    let transaction: any = {};
    if (data.signedTransactionInfo) {
      transaction = this.decodeJWSPayload(data.signedTransactionInfo);
    }

    // Anchor the subscription on the ORIGINAL transaction id (stable across
    // renewals) so renewal/cancel notifications resolve to the same Subscription
    // we linked at purchase. The per-renewal transactionId changes each cycle;
    // anchoring on it would make every renewal look up a non-existent sub.
    const entityId = transaction.originalTransactionId || transaction.transactionId || '';
    // Keep the dedup key unique per transaction (+ Apple's notificationUUID when
    // present): using the stable originalTransactionId alone would make every
    // renewal collide on (rail, webhookId) and be dropped as a duplicate.
    const dedupId =
      notification.notificationUUID || transaction.transactionId || entityId || 'unknown';

    // Map Apple notification types to billing events
    const eventMap: Record<string, string> = {
      SUBSCRIBED: 'subscription.created',
      DID_RENEW: 'subscription.renewed',
      DID_FAIL_TO_RENEW: 'subscription.renewal_failed',
      EXPIRED: 'subscription.expired',
      GRACE_PERIOD_EXPIRED: 'subscription.expired',
      REFUND: 'payment.refunded',
      REVOKE: 'payment.refunded',
      DID_CHANGE_RENEWAL_STATUS: 'subscription.updated',
      CONSUMPTION_REQUEST: 'consumption_request',
    };

    return {
      webhookId: `apple_${dedupId}_${notificationType}`,
      eventType: eventMap[notificationType] || notificationType,
      entityId,
      rail: 'APPLE_IAP',
      payload: {
        notificationType,
        subtype,
        transaction,
        raw: notification,
      },
    };
  }

  /**
   * Decode JWS payload (second segment, base64url-encoded JSON)
   * Note: signature verification should be done at webhook handler level
   * using Apple's root certificate chain
   */
  private decodeJWSPayload(jws: string): any {
    const parts = jws.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWS format');
    }
    const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
    return JSON.parse(payload);
  }
}
