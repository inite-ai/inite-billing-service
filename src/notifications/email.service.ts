import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UnrecoverableError } from 'bullmq';

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  idempotencyKey?: string;
  headers?: Record<string, string>;
}

export interface SendEmailResult {
  id?: string;
  skipped?: boolean;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly config: ConfigService) {}

  get enabled(): boolean {
    return this.config.get('NOTIFICATIONS_EMAIL_ENABLED') === 'true';
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    if (!this.enabled) {
      this.logger.log(`Email disabled (NOTIFICATIONS_EMAIL_ENABLED) — skipping "${input.subject}"`);
      return { skipped: true };
    }

    const apiKey = this.config.get<string>('RESEND_API_KEY');
    if (!apiKey) {
      throw new UnrecoverableError('RESEND_API_KEY is not configured');
    }
    // No default sender: it used to fall back to the INITE address, so a
    // deployment that enabled email without configuring EMAIL_FROM tried to
    // send from a domain it does not control — rejected downstream for a
    // reason that points nowhere near the actual misconfiguration.
    const from = this.config.get<string>('EMAIL_FROM');
    if (!from) {
      throw new UnrecoverableError(
        'EMAIL_FROM is not configured (e.g. "Acme Billing <billing@acme.com>")',
      );
    }
    const replyTo = this.config.get<string>('EMAIL_REPLY_TO');

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(input.idempotencyKey ? { 'Idempotency-Key': input.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        ...(input.text ? { text: input.text } : {}),
        ...(replyTo ? { reply_to: replyTo } : {}),
        ...(input.headers ? { headers: input.headers } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (res.ok) {
      const data = (await res.json()) as { id?: string };
      return { id: data.id };
    }

    const bodyText = await res.text().catch(() => '');
    const message = `Resend API ${res.status}: ${bodyText.slice(0, 300)}`;
    // 4xx (except 429) means the request itself is invalid — retrying won't help
    if (res.status >= 400 && res.status < 500 && res.status !== 429) {
      throw new UnrecoverableError(message);
    }
    throw new Error(message);
  }
}
