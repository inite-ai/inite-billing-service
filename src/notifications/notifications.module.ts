import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';
import { NotificationsController } from './notifications.controller';
import { ResendWebhookController } from './resend-webhook.controller';
import { NotificationsService } from './notifications.service';
import { EmailService } from './email.service';
import { UserContactService } from './user-contact.service';
import { ContactCaptureInterceptor } from './contact-capture.interceptor';
import { PrismaService } from '../common/services/prisma.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'notifications',
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 30000,
        },
      },
    }),
  ],
  controllers: [NotificationsController, ResendWebhookController],
  providers: [
    NotificationsService,
    EmailService,
    UserContactService,
    PrismaService,
    {
      provide: APP_INTERCEPTOR,
      useClass: ContactCaptureInterceptor,
    },
  ],
  exports: [NotificationsService, EmailService, UserContactService, BullModule],
})
export class NotificationsModule {}
