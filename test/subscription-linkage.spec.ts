import { PaymentOrchestratorService } from '../src/payment-orchestrator/payment-orchestrator.service';
import { AppleIAPAdapter } from '../src/adapters/apple-iap/apple-iap.adapter';
import { GooglePlayAdapter } from '../src/adapters/google-play/google-play.adapter';

/**
 * Provider subscription linkage must be consistent end-to-end:
 *
 *   at purchase  -> extractProviderSubscriptionLinkage() stores Subscription.providerSubscriptionId
 *   at renewal   -> the webhook's entityId is what handleSubscriptionEvent() looks up by
 *                   (rail, providerSubscriptionId)
 *
 * Previously the orchestrator switched on 'APPLE'/'GOOGLE' (rails are
 * 'APPLE_IAP'/'GOOGLE_PLAY'), so providerSubscriptionId was saved null and the
 * Apple adapter anchored the webhook on the per-renewal transactionId — so no
 * renewal, cancel, or refund ever resolved the subscription. These tests pin the
 * two anchors to the same value.
 */
describe('Provider subscription linkage (Apple / Google)', () => {
  // extractProviderSubscriptionLinkage is pure (no DB) — null deps are fine.
  const orchestrator = new PaymentOrchestratorService(
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
  );
  const linkage = (intent: any) => (orchestrator as any).extractProviderSubscriptionLinkage(intent);

  // Build a fake JWS whose payload segment decodes to `obj` (Apple encodes
  // signedTransactionInfo as base64url JSON in the 2nd segment).
  const jws = (obj: any) => `hdr.${Buffer.from(JSON.stringify(obj)).toString('base64url')}.sig`;

  const apple = new AppleIAPAdapter({} as any);
  const google = new GooglePlayAdapter({} as any);

  describe('Apple IAP', () => {
    const ORIGINAL_TX = '2000000111111111';
    const RENEWAL_TX = '2000000222222222';

    it('links a subscription by originalTransactionId (raw StoreKit snapshot)', () => {
      const intent = {
        rail: 'APPLE_IAP',
        providerIntentId: ORIGINAL_TX,
        snapshot: { originalTransactionId: ORIGINAL_TX, transactionId: ORIGINAL_TX },
      };
      expect(linkage(intent)).toEqual({
        providerSubscriptionId: ORIGINAL_TX,
        rail: 'APPLE_IAP',
      });
    });

    it('falls back to providerIntentId when the snapshot lacks the original id', () => {
      const intent = {
        rail: 'APPLE_IAP',
        providerIntentId: ORIGINAL_TX,
        snapshot: { apple_transaction_id: ORIGINAL_TX }, // createPaymentIntent metadata only
      };
      expect(linkage(intent).providerSubscriptionId).toBe(ORIGINAL_TX);
    });

    it('anchors a renewal webhook on originalTransactionId, not the per-renewal tx', async () => {
      const parsed = await apple.handleWebhook({
        signedPayload: {
          notificationType: 'DID_RENEW',
          notificationUUID: 'uuid-renew-1',
          data: {
            signedTransactionInfo: jws({
              transactionId: RENEWAL_TX,
              originalTransactionId: ORIGINAL_TX,
            }),
          },
        },
      });
      expect(parsed.eventType).toBe('subscription.renewed');
      // The value handleSubscriptionEvent looks up by == the value we stored.
      expect(parsed.entityId).toBe(ORIGINAL_TX);
    });

    it('gives each renewal a distinct dedup key so renewals are not dropped', async () => {
      const mk = (txId: string, uuid: string) =>
        apple.handleWebhook({
          signedPayload: {
            notificationType: 'DID_RENEW',
            notificationUUID: uuid,
            data: {
              signedTransactionInfo: jws({
                transactionId: txId,
                originalTransactionId: ORIGINAL_TX,
              }),
            },
          },
        });
      const first = await mk(RENEWAL_TX, 'uuid-1');
      const second = await mk('2000000333333333', 'uuid-2');
      expect(first.webhookId).not.toBe(second.webhookId);
      // ...but both still resolve to the same subscription anchor.
      expect(first.entityId).toBe(second.entityId);
      expect(first.entityId).toBe(ORIGINAL_TX);
    });
  });

  describe('Google Play', () => {
    const PURCHASE_TOKEN = 'gpt_abc123';

    it('links a subscription by the purchase token (providerIntentId)', () => {
      const intent = {
        rail: 'GOOGLE_PLAY',
        providerIntentId: PURCHASE_TOKEN,
        // paid transition overwrites snapshot with the V2 object (no token echoed)
        snapshot: { subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE' },
      };
      expect(linkage(intent)).toEqual({
        providerSubscriptionId: PURCHASE_TOKEN,
        rail: 'GOOGLE_PLAY',
      });
    });

    it('a renewal RTDN carries the same purchaseToken the subscription is linked by', async () => {
      const parsed = await google.handleWebhook({
        message: {
          data: Buffer.from(
            JSON.stringify({
              eventTimeMillis: '1700000000000',
              packageName: 'ai.inite.app',
              subscriptionNotification: {
                notificationType: 2, // RENEWED
                purchaseToken: PURCHASE_TOKEN,
                subscriptionId: 'sub_monthly',
              },
            }),
          ).toString('base64'),
        },
      });
      expect(parsed.eventType).toBe('subscription.renewed');
      expect(parsed.entityId).toBe(PURCHASE_TOKEN);
    });

    it('gives each renewal cycle a distinct dedup key (eventTimeMillis)', async () => {
      const mk = (eventTimeMillis: string) =>
        google.handleWebhook({
          message: {
            data: Buffer.from(
              JSON.stringify({
                eventTimeMillis,
                subscriptionNotification: {
                  notificationType: 2,
                  purchaseToken: PURCHASE_TOKEN,
                },
              }),
            ).toString('base64'),
          },
        });
      const first = await mk('1700000000000');
      const second = await mk('1702592000000');
      expect(first.webhookId).not.toBe(second.webhookId);
      expect(first.entityId).toBe(second.entityId);
    });
  });

  it('non-subscription rails still yield no provider linkage', () => {
    for (const rail of ['ONE', 'CRYPTO', 'PROMO']) {
      expect(linkage({ rail, providerIntentId: 'x', snapshot: {} })).toEqual({
        providerSubscriptionId: null,
        rail,
      });
    }
  });
});
