import {
  Controller,
  Post,
  Body,
  Headers,
  Param,
  Req,
  RawBodyRequest,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { WebhooksService } from './webhooks.service';
import { PaymentOrchestratorService } from '../payment-orchestrator/payment-orchestrator.service';
import { Connector } from '../common/connectors/connector.interface';
import { RAILS } from '../common/connectors/rail';

/**
 * A single dynamic inbound endpoint for every payment rail. The URL path maps
 * to a canonical rail; the rail's connector owns verification (fail-closed) and
 * parsing. The six original paths (/webhooks/one, /stripe, /apple, …) still work
 * as-is — providers keep pointing at them — but adding a rail no longer means
 * editing this controller.
 */
@ApiTags('Webhooks')
@SkipThrottle()
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  /** URL segment (as configured on each provider) → canonical rail id. */
  private static readonly RAIL_BY_PATH: Record<string, string> = {
    one: RAILS.ONE,
    lava: RAILS.LAVA,
    stripe: RAILS.STRIPE,
    apple: RAILS.APPLE_IAP,
    google: RAILS.GOOGLE_PLAY,
    crypto: RAILS.CRYPTO,
  };

  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly orchestrator: PaymentOrchestratorService,
  ) {}

  @Post(':railPath')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Inbound payment webhook (per-rail)' })
  @ApiParam({ name: 'railPath', enum: ['one', 'lava', 'stripe', 'apple', 'google', 'crypto'] })
  @ApiResponse({ status: 200 })
  async handleWebhook(
    @Param('railPath') railPath: string,
    @Body() payload: any,
    @Req() req: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<{ received: boolean }> {
    const rail = WebhooksController.RAIL_BY_PATH[(railPath || '').toLowerCase()];
    if (!rail) {
      throw new NotFoundException(`Unknown webhook rail: ${railPath}`);
    }

    let connector: Connector;
    try {
      connector = this.orchestrator.getAdapter(rail) as Connector;
    } catch {
      throw new NotFoundException(`No connector registered for rail ${rail}`);
    }
    if (!connector.verifyWebhook || !connector.handleWebhook) {
      throw new NotFoundException(`Rail ${rail} does not accept webhooks`);
    }

    // Provider config drives secret-based verification. Best-effort: an absent
    // or inactive provider yields {}, which makes fail-closed rails reject (403)
    // and leaves signature-in-payload rails (Apple) unaffected.
    let config: Record<string, any> = {};
    try {
      config = await this.webhooksService.getProviderConfig(rail);
    } catch {
      config = {};
    }

    // Exact request bytes for signature verification (raw capture from
    // `rawBody: true` in main.ts; falls back to a re-serialized body).
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(payload));

    const verified = await connector.verifyWebhook({ rawBody, headers, config, payload });
    if (!verified) {
      this.logger.warn(`${rail} webhook verification failed`);
      throw new ForbiddenException('Invalid webhook');
    }

    const parsed = await connector.handleWebhook(payload);
    const storagePayload = connector.webhookStoragePayload
      ? connector.webhookStoragePayload(payload)
      : payload;

    await this.webhooksService.storeWebhookEvent(
      rail,
      parsed.webhookId ?? payload.id ?? parsed.entityId,
      parsed.eventType,
      parsed.entityId,
      storagePayload,
    );

    return { received: true };
  }
}
