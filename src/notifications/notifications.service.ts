import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../common/services/prisma.service';
import { UserContactService } from './user-contact.service';

export const NOTIFICATION_CATEGORIES = [
  'dunning',
  'winback',
  'abandoned_checkout',
  'trial_ending',
  'quota_warning',
  'system',
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** Categories whose in-app notifications ignore opt-outs (transactional). */
const TRANSACTIONAL_IN_APP: NotificationCategory[] = ['dunning', 'system'];

export interface NotifyInput {
  userId: string;
  type: NotificationCategory;
  channels: Array<'in_app' | 'email'>;
  title: string;
  body: string;
  metadata?: Record<string, any>; // ctaUrl, ctaLabel, locale, outreachId, triggerKey...
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly userContactService: UserContactService,
    @InjectQueue('notifications') private readonly notificationsQueue: Queue,
  ) {}

  async notify(input: NotifyInput) {
    const created: any[] = [];

    for (const channel of input.channels) {
      if (channel === 'in_app') {
        const exempt = TRANSACTIONAL_IN_APP.includes(input.type);
        if (!exempt && (await this.isOptedOut(input.userId, input.type, 'in_app'))) {
          continue;
        }
        const row = await this.prisma.notification.create({
          data: {
            userId: input.userId,
            type: input.type,
            channel: 'in_app',
            title: input.title,
            body: input.body,
            status: 'sent',
            sentAt: new Date(),
            metadata: input.metadata ?? {},
          },
        });
        created.push(row);
      }

      if (channel === 'email') {
        const contact = await this.userContactService.getContact(input.userId);
        const skipReason = !contact?.email
          ? 'no_email'
          : contact.emailSuppressed
            ? 'suppressed'
            : (await this.isOptedOut(input.userId, input.type, 'email'))
              ? 'opted_out'
              : null;

        const metadata = {
          ...(input.metadata ?? {}),
          locale: input.metadata?.locale ?? contact?.locale ?? 'en',
          ...(contact
            ? {
                unsubscribeUrl: this.buildUnsubscribeUrl(contact.unsubscribeToken, input.type),
              }
            : {}),
        };

        const row = await this.prisma.notification.create({
          data: {
            userId: input.userId,
            type: input.type,
            channel: 'email',
            title: input.title,
            body: input.body,
            status: skipReason ? 'skipped' : 'pending',
            lastError: skipReason,
            emailTo: contact?.email ?? null,
            metadata,
          },
        });
        created.push(row);

        if (!skipReason) {
          await this.notificationsQueue.add(
            'send-email',
            { notificationId: row.id },
            { jobId: row.id },
          );
        }
      }
    }

    return created;
  }

  private buildUnsubscribeUrl(token: string, category: string): string {
    const base = this.config.get<string>('FRONTEND_URL') || 'https://billing.inite.ai';
    return `${base.replace(/\/$/, '')}/unsubscribe?token=${token}&category=${category}`;
  }

  async listForUser(
    userId: string,
    options: { page?: number; limit?: number; unreadOnly?: boolean } = {},
  ) {
    const page = Math.max(options.page ?? 1, 1);
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const where = {
      userId,
      channel: 'in_app' as const,
      status: { not: 'skipped' as const },
      ...(options.unreadOnly ? { readAt: null } : {}),
    };

    const [items, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: (page - 1) * limit,
      }),
      this.prisma.notification.count({ where }),
      this.unreadCount(userId),
    ]);

    return {
      items,
      total,
      unreadCount,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: {
        userId,
        channel: 'in_app',
        status: { not: 'skipped' },
        readAt: null,
      },
    });
  }

  async markRead(
    userId: string,
    options: { ids?: string[]; all?: boolean },
  ): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: {
        userId, // IDOR-safe: scoped to the JWT user
        channel: 'in_app',
        readAt: null,
        ...(options.all ? {} : { id: { in: options.ids ?? [] } }),
      },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  async getPreferences(userId: string) {
    const rows = await this.prisma.notificationPreference.findMany({
      where: { userId },
    });
    return { categories: [...NOTIFICATION_CATEGORIES], preferences: rows };
  }

  async setPreference(
    userId: string,
    input: { category: string; emailEnabled?: boolean; inAppEnabled?: boolean },
  ) {
    return this.prisma.notificationPreference.upsert({
      where: { userId_category: { userId, category: input.category } },
      create: {
        userId,
        category: input.category,
        emailEnabled: input.emailEnabled ?? true,
        inAppEnabled: input.inAppEnabled ?? true,
      },
      update: {
        ...(input.emailEnabled !== undefined ? { emailEnabled: input.emailEnabled } : {}),
        ...(input.inAppEnabled !== undefined ? { inAppEnabled: input.inAppEnabled } : {}),
      },
    });
  }

  /** Absence of a preference row means the channel is enabled. */
  async isOptedOut(
    userId: string,
    category: string,
    channel: 'in_app' | 'email',
  ): Promise<boolean> {
    const rows = await this.prisma.notificationPreference.findMany({
      where: { userId, category: { in: [category, 'all'] } },
    });
    return rows.some((row) => (channel === 'email' ? !row.emailEnabled : !row.inAppEnabled));
  }

  async unsubscribeByToken(token: string, category?: string): Promise<{ ok: boolean }> {
    const contact = await this.userContactService.resolveUnsubscribeToken(token);
    if (!contact) {
      throw new NotFoundException('Invalid unsubscribe token');
    }
    await this.setPreference(contact.userId, {
      category: category || 'all',
      emailEnabled: false,
    });
    this.logger.log(`User ${contact.userId} unsubscribed from ${category || 'all'} emails`);
    return { ok: true };
  }
}
