import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  RawBodyRequest,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { PrismaService } from '../common/services/prisma.service';
import { Connector } from '../common/connectors/connector.interface';
import { WebhooksService } from '../webhooks/webhooks.service';
import { MerchantRailsService } from './merchant-rails.service';
import { merchantWebhookRail } from './merchant-credentials';

/**
 * A merchant's provider account notifying billing, one URL per connection.
 * Verified with that connection's own secret (Stripe, lava.top) or by reading
 * the payment back from the provider with the connection's own credentials
 * (YooKassa). Stored under the connection, never under the rail, so the
 * processor reads it with the merchant's credentials and matches it only to
 * the merchant's own orders.
 */
@ApiTags('Webhooks')
@SkipThrottle()
@Controller('v1/webhooks/merchant')
export class MerchantWebhooksController {
  private readonly logger = new Logger(MerchantWebhooksController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rails: MerchantRailsService,
    private readonly webhooks: WebhooksService,
  ) {}

  @Post(':connectionId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Inbound webhook from a merchant's own provider account" })
  async handle(
    @Param('connectionId', new ParseUUIDPipe()) connectionId: string,
    @Body() payload: any,
    @Req() req: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<{ received: boolean }> {
    const connection = await this.prisma.merchantConnection.findUnique({
      where: { id: connectionId },
    });
    // Unknown, never verified, or disconnected (its secret is gone): nothing
    // here can check a signature, so nothing is taken.
    if (!connection || connection.status !== 'verified') {
      throw new NotFoundException('Unknown webhook');
    }
    let connector: Connector;
    try {
      connector = this.rails.bind(connection);
    } catch {
      throw new NotFoundException('Unknown webhook');
    }
    if (!connector.verifyWebhook || !connector.handleWebhook) {
      throw new NotFoundException('This account does not send webhooks');
    }

    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(payload));
    // `config` is empty on purpose: a bound connector checks with its own secret.
    const verified = await connector.verifyWebhook({ rawBody, headers, config: {}, payload });
    if (!verified) {
      this.logger.warn(`Merchant webhook for connection ${connectionId} failed verification`);
      throw new ForbiddenException('Invalid webhook');
    }

    const parsed = await connector.handleWebhook(payload);
    const stored = connector.webhookStoragePayload
      ? connector.webhookStoragePayload(payload)
      : payload;
    await this.webhooks.storeWebhookEvent(
      merchantWebhookRail(connectionId),
      String(parsed.webhookId ?? payload?.id ?? parsed.entityId),
      parsed.eventType,
      parsed.entityId,
      stored,
    );
    return { received: true };
  }
}
