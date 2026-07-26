import {
  Controller,
  Post,
  Body,
  Headers,
  Req,
  RawBodyRequest,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import * as crypto from 'crypto';

/** Exact request bytes for signature verification (falls back to a re-serialized
 * body only if raw capture is unavailable — see `rawBody: true` in main.ts). */
function rawBytes(req: RawBodyRequest<Request>, payload: unknown): Buffer {
  return req.rawBody ?? Buffer.from(JSON.stringify(payload));
}
import { WebhooksService } from './webhooks.service';
import { OneAdapter } from '../adapters/one/one.adapter';
import { LavaAdapter } from '../adapters/lava/lava.adapter';
import { StripeAdapter } from '../adapters/stripe/stripe.adapter';
import { AppleIAPAdapter } from '../adapters/apple-iap/apple-iap.adapter';
import { GooglePlayAdapter } from '../adapters/google-play/google-play.adapter';
import { CryptoAdapter } from '../adapters/crypto/crypto.adapter';

function safeTimingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Constant-time comparison even when lengths differ:
    // hash both to fixed-length digests to avoid timing leaks
    const hashA = crypto.createHash('sha256').update(bufA).digest();
    const hashB = crypto.createHash('sha256').update(bufB).digest();
    crypto.timingSafeEqual(hashA, hashB);
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
    private readonly oneAdapter: OneAdapter,
    private readonly lavaAdapter: LavaAdapter,
    private readonly stripeAdapter: StripeAdapter,
    private readonly appleIAPAdapter: AppleIAPAdapter,
    private readonly googlePlayAdapter: GooglePlayAdapter,
    private readonly cryptoAdapter: CryptoAdapter,
  ) {}

  @Post('one')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ONE payment webhook endpoint' })
  @ApiResponse({ status: 200 })
  async handleOneWebhook(
    @Body() payload: any,
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-signature') signature: string,
  ): Promise<{ received: boolean }> {
    const config = await this.webhooksService.getProviderConfig('ONE');
    const apiSecret = config.apiSecret || '';

    const expected = crypto
      .createHmac('sha256', apiSecret)
      .update(rawBytes(req, payload))
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
    const config = await this.webhooksService.getProviderConfig('LAVA');
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

  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stripe payment webhook endpoint' })
  @ApiResponse({ status: 200 })
  async handleStripeWebhook(
    @Body() payload: any,
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ): Promise<{ received: boolean }> {
    if (!signature) {
      this.logger.warn('Stripe webhook missing signature');
      throw new ForbiddenException('Missing Stripe-Signature header');
    }

    // Verify over the exact request bytes — Stripe signs the raw body.
    const isValid = await this.stripeAdapter.verifyWebhookSignature(
      rawBytes(req, payload),
      signature,
    );
    if (!isValid) {
      this.logger.warn('Stripe webhook signature verification failed');
      throw new ForbiddenException('Invalid webhook signature');
    }

    const parsed = await this.stripeAdapter.handleWebhook(payload);

    await this.webhooksService.storeWebhookEvent(
      'STRIPE',
      parsed.webhookId || parsed.entityId,
      parsed.eventType,
      parsed.entityId,
      payload,
    );

    return { received: true };
  }

  @Post('apple')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Apple App Store Server Notification V2' })
  @ApiResponse({ status: 200 })
  async handleAppleWebhook(@Body() payload: any): Promise<{ received: boolean }> {
    // Apple sends signedPayload — the adapter decodes and validates the JWS
    if (!payload?.signedPayload && !payload?.notificationType) {
      this.logger.warn('Apple webhook missing signedPayload');
      throw new ForbiddenException('Invalid Apple notification format');
    }

    const parsed = await this.appleIAPAdapter.handleWebhook(payload);

    await this.webhooksService.storeWebhookEvent(
      'APPLE_IAP',
      parsed.webhookId || parsed.entityId,
      parsed.eventType,
      parsed.entityId,
      payload,
    );

    return { received: true };
  }

  @Post('google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Google Play RTDN webhook endpoint' })
  @ApiResponse({ status: 200 })
  async handleGooglePlayWebhook(
    @Body() payload: any,
    @Headers('authorization') authHeader: string,
  ): Promise<{ received: boolean }> {
    // Google Pub/Sub uses OAuth Bearer token for push authentication
    // Verify the token matches our configured secret
    const config = await this.webhooksService.getProviderConfig('GOOGLE_PLAY');
    const expectedToken = (config as any).pubsubToken;

    if (expectedToken) {
      const token = authHeader?.replace('Bearer ', '');
      if (!token || !safeTimingSafeEqual(expectedToken, token)) {
        this.logger.warn('Google Play webhook auth verification failed');
        throw new ForbiddenException('Invalid webhook authorization');
      }
    }

    const parsed = await this.googlePlayAdapter.handleWebhook(payload);

    await this.webhooksService.storeWebhookEvent(
      'GOOGLE_PLAY',
      parsed.webhookId || parsed.entityId,
      parsed.eventType,
      parsed.entityId,
      typeof payload.message?.data === 'string'
        ? JSON.parse(Buffer.from(payload.message.data, 'base64').toString())
        : payload,
    );

    return { received: true };
  }

  @Post('crypto')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Crypto blockchain indexer webhook' })
  @ApiResponse({ status: 200 })
  async handleCryptoWebhook(
    @Body() payload: any,
    @Headers('x-webhook-secret') webhookSecret: string,
  ): Promise<{ received: boolean }> {
    // Verify secret from indexer
    const config = await this.webhooksService.getProviderConfig('CRYPTO');
    const expectedSecret = (config as any).webhookSecret;

    if (expectedSecret) {
      if (!webhookSecret || !safeTimingSafeEqual(expectedSecret, webhookSecret)) {
        this.logger.warn('Crypto webhook secret verification failed');
        throw new ForbiddenException('Invalid webhook secret');
      }
    }

    const parsed = await this.cryptoAdapter.handleWebhook(payload);

    await this.webhooksService.storeWebhookEvent(
      'CRYPTO',
      parsed.webhookId || parsed.entityId,
      parsed.eventType,
      parsed.entityId,
      payload,
    );

    return { received: true };
  }
}
