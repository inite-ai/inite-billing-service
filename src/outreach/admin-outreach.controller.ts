import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { IsIn, IsOptional, IsString, IsEmail } from 'class-validator';
import { PrismaService } from '../common/services/prisma.service';
import { EmailService } from '../notifications/email.service';
import { renderTemplate, isKnownTemplate } from '../notifications/templates';

class TestEmailDto {
  @IsEmail()
  to: string;

  @IsIn(['en', 'ru'])
  locale: 'en' | 'ru';

  @IsString()
  trigger: string;

  @IsOptional()
  @IsString()
  productName?: string;
}

@ApiTags('Admin')
@Controller('v1/admin/outreach')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminOutreachController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List outreach messages' })
  async list(
    @Query('trigger') trigger?: string,
    @Query('status') status?: string,
    @Query('outcome') outcome?: string,
    @Query('userId') userId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = Math.max(parseInt(page || '1', 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit || '20', 10) || 20, 1), 100);
    const where = {
      ...(trigger ? { trigger } : {}),
      ...(status ? { status: status as any } : {}),
      ...(outcome ? { outcome } : {}),
      ...(userId ? { userId } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.outreachMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limitNum,
        skip: (pageNum - 1) * limitNum,
      }),
      this.prisma.outreachMessage.count({ where }),
    ]);
    return {
      items,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    };
  }

  @Get('stats')
  @ApiOperation({ summary: 'Outreach stats: conversion by trigger, fallback rate' })
  async stats() {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const rows = await this.prisma.outreachMessage.groupBy({
      by: ['trigger', 'status'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    });
    const outcomes = await this.prisma.outreachMessage.groupBy({
      by: ['trigger', 'outcome'],
      where: { createdAt: { gte: since }, status: 'sent' },
      _count: { _all: true },
    });
    const sources = await this.prisma.outreachMessage.groupBy({
      by: ['source'],
      where: { createdAt: { gte: since }, status: 'sent' },
      _count: { _all: true },
    });

    const triggers = new Map<
      string,
      { trigger: string; sent: number; skipped: number; converted: number }
    >();
    const ensure = (t: string) => {
      if (!triggers.has(t)) {
        triggers.set(t, { trigger: t, sent: 0, skipped: 0, converted: 0 });
      }
      return triggers.get(t)!;
    };
    for (const row of rows) {
      const entry = ensure(row.trigger);
      if (row.status === 'sent') entry.sent += row._count._all;
      if (row.status === 'skipped') entry.skipped += row._count._all;
    }
    for (const row of outcomes) {
      if (row.outcome === 'converted' || row.outcome === 'resolved') {
        ensure(row.trigger).converted += row._count._all;
      }
    }

    const totalSent = sources.reduce((sum, s) => sum + s._count._all, 0);
    const templateSent =
      sources.find((s) => s.source === 'template')?._count._all ?? 0;

    return {
      byTrigger: [...triggers.values()].map((t) => ({
        ...t,
        conversionRate: t.sent > 0 ? +(t.converted / t.sent).toFixed(3) : 0,
      })),
      llmFallbackRate: totalSent > 0 ? +(templateSent / totalSent).toFixed(3) : 0,
      windowDays: 30,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one outreach message with linked notifications' })
  async getOne(@Param('id') id: string) {
    const outreach = await this.prisma.outreachMessage.findUnique({
      where: { id },
    });
    if (!outreach) return null;
    const notificationIds = [
      outreach.inAppNotificationId,
      outreach.emailNotificationId,
    ].filter(Boolean) as string[];
    const notifications = notificationIds.length
      ? await this.prisma.notification.findMany({
          where: { id: { in: notificationIds } },
        })
      : [];
    return { ...outreach, notifications };
  }

  @Post('test-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a template-rendered test email (ops smoke test)' })
  async testEmail(@Body() body: TestEmailDto) {
    const trigger = isKnownTemplate(body.trigger)
      ? body.trigger
      : 'abandoned_checkout';
    const rendered = renderTemplate(trigger, body.locale, {
      productName: body.productName || 'Test Product',
      ctaUrl: 'https://billing.inite.ai/dashboard',
    });
    const result = await this.emailService.send({
      to: body.to,
      subject: `[TEST] ${rendered.subject}`,
      html: rendered.html,
      text: rendered.text,
    });
    return { sent: !result.skipped, providerMessageId: result.id ?? null };
  }
}
