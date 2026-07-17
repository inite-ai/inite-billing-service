import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { User, RequestUser } from '../auth/decorators/user.decorator';
import { PrismaService } from '../common/services/prisma.service';
import { AdminOrdersService } from '../admin/services/admin-orders.service';

@ApiTags('Admin')
@Controller('v1/admin/risk')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class RiskAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adminOrdersService: AdminOrdersService,
  ) {}

  @Get('flagged')
  @ApiOperation({ summary: 'List risk assessments (flagged by default)' })
  async listFlagged(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = Math.max(parseInt(page || '1', 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit || '20', 10) || 20, 1), 100);
    const where = status ? { status } : { status: { in: ['flagged', 'blocked'] } };

    const [items, total] = await Promise.all([
      this.prisma.riskAssessment.findMany({
        where,
        include: {
          order: { include: { price: { include: { product: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        take: limitNum,
        skip: (pageNum - 1) * limitNum,
      }),
      this.prisma.riskAssessment.count({ where }),
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
  @ApiOperation({ summary: 'Risk stats: counts by level/status, daily flags' })
  async stats() {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [byLevel, byStatus, daily] = await Promise.all([
      this.prisma.riskAssessment.groupBy({
        by: ['level'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.riskAssessment.groupBy({
        by: ['status'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<Array<{ day: Date; flags: bigint }>>`
        SELECT date_trunc('day', created_at) AS day, COUNT(*)::bigint AS flags
        FROM billing.risk_assessments
        WHERE created_at >= ${since} AND status IN ('flagged', 'blocked')
        GROUP BY 1 ORDER BY 1 ASC
      `,
    ]);
    return {
      byLevel: byLevel.map((r) => ({ level: r.level, count: r._count._all })),
      byStatus: byStatus.map((r) => ({ status: r.status, count: r._count._all })),
      dailyFlags: daily.map((r) => ({ day: r.day, flags: Number(r.flags) })),
      windowDays: 30,
    };
  }

  @Post(':id/review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Review a flagged assessment (ok or fraud, optional refund)' })
  async review(
    @User() user: RequestUser,
    @Param('id') id: string,
    @Body() body: { resolution: 'ok' | 'fraud'; note?: string; refund?: boolean },
  ) {
    if (!['ok', 'fraud'].includes(body.resolution)) {
      throw new BadRequestException('resolution must be "ok" or "fraud"');
    }
    const assessment = await this.prisma.riskAssessment.findUnique({
      where: { id },
      include: { order: true },
    });
    if (!assessment) throw new NotFoundException('Assessment not found');

    const updated = await this.prisma.riskAssessment.update({
      where: { id },
      data: {
        status: body.resolution === 'ok' ? 'reviewed_ok' : 'reviewed_fraud',
        reviewedBy: user.userId,
        reviewNote: body.note?.slice(0, 500) ?? null,
        reviewedAt: new Date(),
      },
    });

    let refunded = false;
    if (body.resolution === 'fraud' && body.refund && assessment.order.status === 'paid') {
      await this.adminOrdersService.refundOrder(assessment.orderId);
      refunded = true;
    }

    return { ...updated, refunded };
  }
}
