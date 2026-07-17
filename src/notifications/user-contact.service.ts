import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../common/services/prisma.service';

const TOUCH_CACHE_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class UserContactService {
  private readonly logger = new Logger(UserContactService.name);
  // In-process dedupe only; the DB unique key is authoritative across instances
  private readonly touchCache = new Map<string, { hash: string; ts: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async touch(userId: string, email?: string, locale?: string): Promise<void> {
    try {
      const normalizedLocale = locale === 'ru' ? 'ru' : locale === 'en' ? 'en' : undefined;
      const hash = createHash('sha1')
        .update(`${email ?? ''}|${normalizedLocale ?? ''}`)
        .digest('hex');
      const cached = this.touchCache.get(userId);
      const now = Date.now();
      if (cached && cached.hash === hash && now - cached.ts < TOUCH_CACHE_TTL_MS) {
        return;
      }

      await this.prisma.userContact.upsert({
        where: { userId },
        create: {
          userId,
          email: email || null,
          locale: normalizedLocale ?? 'en',
        },
        update: {
          ...(email ? { email } : {}),
          ...(normalizedLocale ? { locale: normalizedLocale } : {}),
          lastSeenAt: new Date(),
        },
      });
      this.touchCache.set(userId, { hash, ts: now });
    } catch (error: any) {
      this.logger.warn(`Contact touch failed for ${userId}: ${error.message}`);
    }
  }

  async getContact(userId: string) {
    return this.prisma.userContact.findUnique({ where: { userId } });
  }

  async suppress(userId: string): Promise<void> {
    await this.prisma.userContact.updateMany({
      where: { userId },
      data: { emailSuppressed: true },
    });
  }

  async resolveUnsubscribeToken(token: string) {
    return this.prisma.userContact.findUnique({
      where: { unsubscribeToken: token },
    });
  }
}
