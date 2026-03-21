import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import * as crypto from 'crypto';
import { WebhooksService } from './webhooks.service';
import { PrismaService } from '../common/services/prisma.service';
import { OneAdapter } from '../adapters/one/one.adapter';
import { LavaAdapter } from '../adapters/lava/lava.adapter';

function safeTimingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    const padded = Buffer.alloc(bufA.length);
    bufB.copy(padded);
    crypto.timingSafeEqual(bufA, padded);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

@ApiTags('Webhooks')
@SkipThrottle()
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly prisma: PrismaService,
    private readonly oneAdapter: OneAdapter,
    private readonly lavaAdapter: LavaAdapter,
  ) {}

  @Post('one')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ONE payment webhook endpoint' })
  @ApiResponse({ status: 200 })
  async handleOneWebhook(
    @Body() payload: any,
    @Headers('x-signature') signature: string,
  ): Promise<{ received: boolean }> {
    const provider = await this.prisma.paymentProvider.findUnique({
      where: { code: 'ONE' },
    });
    if (!provider) {
      throw new ForbiddenException('ONE provider not configured');
    }
    const config = (provider.config as Record<string, any>) || {};
    const apiSecret = config.apiSecret || '';

    const rawBody = JSON.stringify(payload);
    const expected = crypto
      .createHmac('sha256', apiSecret)
      .update(rawBody)
      .digest('hex');

    if (!signature || !safeTimingSafeEqual(expected, signature)) {
      this.logger.warn('ONE webhook signature verification failed');
      throw new ForbiddenException('Invalid webhook signature');
    }

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

    await this.webhooksService.storeWebhookEvent(
      'ONE',
      payload.id || parsed.entityId,
      parsed.eventType,
      parsed.entityId,
      payload,
    );

    return { received: true };
  }

  @Post('lava')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lava.top payment webhook endpoint' })
  @ApiResponse({ status: 200 })
  async handleLavaWebhook(
    @Body() payload: any,
    @Headers('x-api-key') apiKeyHeader: string,
  ): Promise<{ received: boolean }> {
    const provider = await this.prisma.paymentProvider.findUnique({
      where: { code: 'LAVA' },
    });
    if (!provider) {
      throw new ForbiddenException('LAVA provider not configured');
    }
    const config = (provider.config as Record<string, any>) || {};
    const apiKey = config.apiKey || '';

    if (!apiKeyHeader || !safeTimingSafeEqual(apiKey, apiKeyHeader)) {
      this.logger.warn('LAVA webhook API key verification failed');
      throw new ForbiddenException('Invalid webhook API key');
    }

    const parsed = await this.lavaAdapter.handleWebhook(payload);

    await this.webhooksService.storeWebhookEvent(
      'LAVA',
      parsed.webhookId || parsed.entityId,
      parsed.eventType,
      parsed.entityId,
      payload,
    );

    return { received: true };
  }

  @Post('crypto')
  @HttpCode(HttpStatus.NOT_FOUND)
  @ApiOperation({ summary: 'Crypto payment webhook endpoint (disabled)' })
  @ApiResponse({ status: 404 })
  async handleCryptoWebhook(): Promise<{ message: string }> {
    throw new NotFoundException('Crypto webhooks not implemented');
  }
}

