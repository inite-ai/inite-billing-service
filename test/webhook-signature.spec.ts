import { createHmac } from 'crypto';
import { ForbiddenException, RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { StripeAdapter } from '../src/adapters/stripe/stripe.adapter';
import { WebhooksController } from '../src/webhooks/webhooks.controller';

/**
 * Webhook signatures MUST be verified over the exact raw request bytes, not a
 * re-serialized `JSON.stringify(req.body)` (which reorders keys / drops the
 * original whitespace and never matches — this is why Stripe webhooks were
 * 403ing). These tests pin that: the raw body deliberately differs from
 * `JSON.stringify(payload)`, and verification must still succeed.
 */
describe('Webhook signature verification (raw body)', () => {
  const rawReq = (raw: string): RawBodyRequest<Request> =>
    ({ rawBody: Buffer.from(raw, 'utf8') }) as RawBodyRequest<Request>;

  describe('Stripe adapter', () => {
    const WEBHOOK_SECRET = 'whsec_test_secret';
    let adapter: StripeAdapter;

    const stripeSig = (rawBody: string, secret = WEBHOOK_SECRET, ts?: number) => {
      const t = ts ?? Math.floor(Date.now() / 1000);
      const v1 = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
      return `t=${t},v1=${v1}`;
    };

    beforeEach(() => {
      const prisma: any = {
        paymentProvider: {
          findUnique: jest.fn().mockResolvedValue({
            isActive: true,
            config: { webhookSecret: WEBHOOK_SECRET, secretKey: 'sk_test' },
          }),
        },
      };
      adapter = new StripeAdapter(prisma);
    });

    it('verifies a signature computed over the raw body string', async () => {
      const raw = '{ "id": "evt_1", "type": "payment_intent.succeeded" }'; // note spacing
      expect(await adapter.verifyWebhookSignature(raw, stripeSig(raw))).toBe(true);
    });

    it('verifies when given the raw body as a Buffer (as the controller passes it)', async () => {
      const raw = '{"id":"evt_2"}';
      expect(await adapter.verifyWebhookSignature(Buffer.from(raw), stripeSig(raw))).toBe(true);
    });

    it('rejects a tampered body (proves exact-byte verification)', async () => {
      const raw = '{"id":"evt_3","amount":100}';
      const sig = stripeSig(raw);
      expect(await adapter.verifyWebhookSignature(raw + ' ', sig)).toBe(false);
    });

    it('rejects a stale timestamp (replay protection)', async () => {
      const raw = '{"id":"evt_4"}';
      const stale = Math.floor(Date.now() / 1000) - 10_000;
      expect(await adapter.verifyWebhookSignature(raw, stripeSig(raw, WEBHOOK_SECRET, stale))).toBe(
        false,
      );
    });

    it('rejects a signature made with the wrong secret', async () => {
      const raw = '{"id":"evt_5"}';
      expect(await adapter.verifyWebhookSignature(raw, stripeSig(raw, 'whsec_wrong'))).toBe(false);
    });
  });

  describe('ONE controller', () => {
    let controller: WebhooksController;
    let webhooksService: any;
    const API_SECRET = 'one_api_secret';

    beforeEach(() => {
      webhooksService = {
        getProviderConfig: jest.fn().mockResolvedValue({ apiSecret: API_SECRET }),
        storeWebhookEvent: jest.fn().mockResolvedValue(undefined),
      };
      const oneAdapter: any = {}; // no handleWebhook -> controller uses its fallback parse
      const noop: any = {};
      controller = new WebhooksController(
        webhooksService,
        oneAdapter,
        noop,
        noop,
        noop,
        noop,
        noop,
      );
    });

    it('accepts a signature over the raw body even when it differs from JSON.stringify(payload)', async () => {
      const payload = { id: 'wh1', event_type: 'payment.order.updated', entity_id: 'pi_1' };
      // Raw bytes the client actually sent — different key order + whitespace than
      // JSON.stringify(payload). The old code signed JSON.stringify(payload) and
      // would reject this; the fix verifies over rawBody and accepts it.
      const raw = '{ "entity_id": "pi_1", "event_type": "payment.order.updated", "id": "wh1" }';
      const sig = createHmac('sha256', API_SECRET).update(raw).digest('hex');

      const res = await controller.handleOneWebhook(payload, rawReq(raw), sig);

      expect(res).toEqual({ received: true });
      expect(webhooksService.storeWebhookEvent).toHaveBeenCalledWith(
        'ONE',
        'wh1',
        'payment.order.updated',
        'pi_1',
        payload,
      );
    });

    it('rejects an invalid signature', async () => {
      const payload = { id: 'wh2', entity_id: 'pi_2' };
      const raw = JSON.stringify(payload);
      await expect(
        controller.handleOneWebhook(payload, rawReq(raw), 'deadbeef'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(webhooksService.storeWebhookEvent).not.toHaveBeenCalled();
    });
  });
});
