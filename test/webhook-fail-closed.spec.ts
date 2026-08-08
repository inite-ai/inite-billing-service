import { ForbiddenException, RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { WebhooksController } from '../src/webhooks/webhooks.controller';
import { OneAdapter } from '../src/adapters/one/one.adapter';
import { LavaAdapter } from '../src/adapters/lava/lava.adapter';
import { GooglePlayAdapter } from '../src/adapters/google-play/google-play.adapter';
import { CryptoAdapter } from '../src/adapters/crypto/crypto.adapter';

/**
 * Webhook verification must fail CLOSED when the required secret is missing or
 * empty — an empty-key HMAC / absent token is attacker-forgeable and would let a
 * forged "paid"/"confirmed" webhook trigger free fulfilment. Verification now
 * lives in each connector's verifyWebhook(); these tests drive the real
 * connectors through the single dynamic controller route.
 */
describe('Webhook verification fails closed when secret is unconfigured', () => {
  const rawReq = (raw: string): RawBodyRequest<Request> =>
    ({ rawBody: Buffer.from(raw, 'utf8') }) as RawBodyRequest<Request>;

  const build = (adapter: any, config: any) => {
    const webhooksService = {
      getProviderConfig: jest.fn().mockResolvedValue(config),
      storeWebhookEvent: jest.fn().mockResolvedValue(undefined),
    };
    const orchestrator = { getAdapter: jest.fn().mockReturnValue(adapter) };
    const controller = new WebhooksController(webhooksService as any, orchestrator as any);
    return { controller, webhooksService };
  };

  it('ONE rejects when apiSecret is empty', async () => {
    const { controller, webhooksService } = build(new OneAdapter({} as any), { apiSecret: '' });
    await expect(
      controller.handleWebhook('one', { id: 'w' }, rawReq('{"id":"w"}'), { 'x-signature': 'sig' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(webhooksService.storeWebhookEvent).not.toHaveBeenCalled();
  });

  it('LAVA rejects when apiKey is empty', async () => {
    const { controller, webhooksService } = build(new LavaAdapter({} as any), { apiKey: '' });
    await expect(
      controller.handleWebhook('lava', { id: 'w' }, rawReq('{}'), { 'x-api-key': 'header-key' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(webhooksService.storeWebhookEvent).not.toHaveBeenCalled();
  });

  it('Google Play rejects when pubsubToken is unconfigured', async () => {
    const { controller, webhooksService } = build(new GooglePlayAdapter({} as any), {});
    await expect(
      controller.handleWebhook('google', { message: {} }, rawReq('{}'), {
        authorization: 'Bearer whatever',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(webhooksService.storeWebhookEvent).not.toHaveBeenCalled();
  });

  it('Crypto rejects when webhookSecret is unconfigured', async () => {
    const { controller, webhooksService } = build(new CryptoAdapter({} as any), {});
    await expect(
      controller.handleWebhook('crypto', { id: 'w' }, rawReq('{}'), {
        'x-webhook-secret': 'whatever',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(webhooksService.storeWebhookEvent).not.toHaveBeenCalled();
  });

  it('rejects an unknown rail path with 404 (not silently accepted)', async () => {
    const { controller } = build(new OneAdapter({} as any), { apiSecret: 'x' });
    await expect(controller.handleWebhook('paypal', {}, rawReq('{}'), {})).rejects.toThrow(
      /Unknown webhook rail/,
    );
  });
});
