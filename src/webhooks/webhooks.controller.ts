import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';
import { OneAdapter } from '../adapters/one/one.adapter';
import { CryptoAdapter } from '../adapters/crypto/crypto.adapter';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly oneAdapter: OneAdapter,
    private readonly cryptoAdapter: CryptoAdapter,
  ) {}

  @Post('one')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ONE payment webhook endpoint' })
  @ApiResponse({ status: 200 })
  async handleOneWebhook(@Body() payload: any): Promise<{ received: boolean }> {
    // Parse webhook (handleWebhook is optional, so check if exists)
    let parsed;
    if (this.oneAdapter.handleWebhook) {
      parsed = await this.oneAdapter.handleWebhook(payload);
    } else {
      parsed = {
        eventType: payload.event_type || payload.eventType || 'payment.order.updated',
        entityId: payload.entity_id || payload.entityId || payload.id,
        payload,
      };
    }

    // Store idempotently
    await this.webhooksService.storeWebhookEvent(
      'ONE',
      payload.id || parsed.entityId,
      parsed.eventType,
      parsed.entityId,
      payload,
    );

    return { received: true };
  }

  @Post('crypto')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Crypto payment webhook endpoint (stub)' })
  @ApiResponse({ status: 200 })
  async handleCryptoWebhook(@Body() payload: any): Promise<{ received: boolean }> {
    // Store webhook (crypto adapter doesn't have handleWebhook in stub)
    const webhookId = payload.id || payload.tx_hash || `crypto_${Date.now()}`;
    const entityId = payload.tx_hash || payload.invoice_id || webhookId;
    const eventType = payload.event_type || payload.type || 'transaction.confirmed';

    await this.webhooksService.storeWebhookEvent(
      'CRYPTO',
      webhookId,
      eventType,
      entityId,
      payload,
    );

    return { received: true };
  }
}

