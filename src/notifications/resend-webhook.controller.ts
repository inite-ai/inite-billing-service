import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { PrismaService } from '../common/services/prisma.service';
import { UserContactService } from './user-contact.service';

/**
 * Resend delivery webhooks (svix format).
 * Signature: HMAC-SHA256 base64 of `${id}.${timestamp}.${payload}` with the
 * base64-decoded secret (after the `whsec_` prefix). Implemented manually —
 * no extra dependency.
 */
@ApiTags('Notifications')
@Controller('v1/notifications/webhooks')
export class ResendWebhookController {
  private readonly logger = new Logger(ResendWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly userContactService: UserContactService,
  ) {}

  @Post('resend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend delivery status webhook' })
  async handle(
    @Req() req: Request,
    @Body() body: any,
    @Headers('svix-id') svixId?: string,
    @Headers('svix-timestamp') svixTimestamp?: string,
    @Headers('svix-signature') svixSignature?: string,
  ) {
    const secret = this.config.get<string>('RESEND_WEBHOOK_SECRET');
    if (!secret) {
      throw new UnauthorizedException('Webhook secret not configured');
    }
    if (!svixId || !svixTimestamp || !svixSignature) {
      throw new UnauthorizedException('Missing signature headers');
    }

    // Reject stale timestamps (replay protection, 5 min tolerance)
    const ts = Number(svixTimestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
      throw new UnauthorizedException('Stale webhook timestamp');
    }

    const rawBody =
      (req as any).rawBody?.toString?.('utf8') ?? JSON.stringify(body);
    this.verifySignature(secret, svixId, svixTimestamp, rawBody, svixSignature);

    const type = body?.type as string | undefined;
    const providerMessageId = body?.data?.email_id as string | undefined;
    if (!type || !providerMessageId) {
      throw new BadRequestException('Malformed webhook payload');
    }

    const notification = await this.prisma.notification.findFirst({
      where: { providerMessageId },
    });
    if (!notification) {
      return { received: true };
    }

    if (type === 'email.delivered') {
      await this.prisma.notification.update({
        where: { id: notification.id },
        data: { status: 'delivered' },
      });
    } else if (type === 'email.bounced' || type === 'email.complained') {
      await this.prisma.notification.update({
        where: { id: notification.id },
        data: { status: 'bounced', lastError: type },
      });
      await this.userContactService.suppress(notification.userId);
      this.logger.warn(
        `Email ${type} for user ${notification.userId} — contact suppressed`,
      );
    }

    return { received: true };
  }

  private verifySignature(
    secret: string,
    id: string,
    timestamp: string,
    payload: string,
    signatureHeader: string,
  ): void {
    const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
    const expected = createHmac('sha256', key)
      .update(`${id}.${timestamp}.${payload}`)
      .digest('base64');

    // Header may contain multiple space-separated signatures like "v1,<sig>"
    const candidates = signatureHeader
      .split(' ')
      .map((part) => part.split(',')[1] ?? part);

    const expectedBuf = Buffer.from(expected);
    const valid = candidates.some((candidate) => {
      const candidateBuf = Buffer.from(candidate ?? '');
      return (
        candidateBuf.length === expectedBuf.length &&
        timingSafeEqual(candidateBuf, expectedBuf)
      );
    });
    if (!valid) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
  }
}
