import { ForbiddenException, RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { WebhooksController } from '../src/webhooks/webhooks.controller';

/**
 * Webhook endpoints must fail CLOSED when their verification secret is missing
 * or empty — an empty-key HMAC / absent token is attacker-forgeable and would
 * let a forged "paid"/"confirmed" webhook trigger free fulfilment.
 */
describe('Webhook verification fails closed when secret is unconfigured', () => {
  const rawReq = (raw: string): RawBodyRequest<Request> =>
    ({ rawBody: Buffer.from(raw, 'utf8') }) as RawBodyRequest<Request>;

  let controller: WebhooksController;
  let webhooksService: any;
  const noop: any = {};

  const withConfig = (config: any) => {
    webhooksService = {
      getProviderConfig: jest.fn().mockResolvedValue(config),
      storeWebhookEvent: jest.fn().mockResolvedValue(undefined),
    };
    controller = new WebhooksController(webhooksService, noop, noop, noop, noop, noop, noop);
  };

  it('ONE rejects when apiSecret is empty', async () => {
    withConfig({ apiSecret: '' });
    await expect(
      controller.handleOneWebhook({ id: 'w' }, rawReq('{"id":"w"}'), 'sig'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(webhooksService.storeWebhookEvent).not.toHaveBeenCalled();
  });

  it('LAVA rejects when apiKey is empty', async () => {
    withConfig({ apiKey: '' });
    await expect(controller.handleLavaWebhook({ id: 'w' }, 'header-key')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(webhooksService.storeWebhookEvent).not.toHaveBeenCalled();
  });

  it('Google Play rejects when pubsubToken is unconfigured', async () => {
    withConfig({});
    await expect(
      controller.handleGooglePlayWebhook({ message: {} }, 'Bearer whatever'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(webhooksService.storeWebhookEvent).not.toHaveBeenCalled();
  });

  it('Crypto rejects when webhookSecret is unconfigured', async () => {
    withConfig({});
    await expect(controller.handleCryptoWebhook({ id: 'w' }, 'whatever')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(webhooksService.storeWebhookEvent).not.toHaveBeenCalled();
  });
});
