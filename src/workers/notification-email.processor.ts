import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../common/services/prisma.service';
import { EmailService } from '../notifications/email.service';
import { wrapLlmBody, TemplateLocale } from '../notifications/templates';

@Processor('notifications', {
  concurrency: 5,
})
export class NotificationEmailProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationEmailProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {
    super();
  }

  async process(job: Job<{ notificationId: string }>): Promise<void> {
    const notification = await this.prisma.notification.findUnique({
      where: { id: job.data.notificationId },
    });
    if (!notification) return;
    // Retries re-enter with status 'failed'; anything else is a no-op
    if (!['pending', 'failed'].includes(notification.status)) return;
    if (notification.channel !== 'email' || !notification.emailTo) return;

    const metadata = (notification.metadata ?? {}) as Record<string, any>;
    const locale: TemplateLocale = metadata.locale === 'ru' ? 'ru' : 'en';
    const rendered = wrapLlmBody(notification.title, notification.body, locale, {
      ctaUrl: metadata.ctaUrl,
      ctaLabel: metadata.ctaLabel,
      unsubscribeUrl: metadata.unsubscribeUrl,
    });

    try {
      const result = await this.emailService.send({
        to: notification.emailTo,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        idempotencyKey: notification.id,
        headers: metadata.unsubscribeUrl
          ? { 'List-Unsubscribe': `<${metadata.unsubscribeUrl}>` }
          : undefined,
      });

      await this.prisma.notification.update({
        where: { id: notification.id },
        data: {
          status: result.skipped ? 'skipped' : 'sent',
          lastError: result.skipped ? 'email_disabled' : null,
          providerMessageId: result.id ?? null,
          sentAt: result.skipped ? null : new Date(),
          attempts: { increment: 1 },
        },
      });
    } catch (error: any) {
      await this.prisma.notification.update({
        where: { id: notification.id },
        data: {
          status: 'failed',
          lastError: String(error.message).slice(0, 1000),
          attempts: { increment: 1 },
        },
      });
      this.logger.error(
        `Email send failed for notification ${notification.id}: ${error.message}`,
      );
      if (error instanceof UnrecoverableError) throw error;
      throw error; // rethrow so BullMQ retries with backoff
    }
  }
}
