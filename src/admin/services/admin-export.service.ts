import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';
import { toCsv } from '../../common/helpers/csv';
import { resolveOrderBy } from '../../common/helpers/sort';
import { buildOrderWhere, ORDER_SORT, SUBSCRIPTION_SORT } from './admin-orders.service';
import { AFFILIATE_SORT, PAYOUT_SORT } from './admin-affiliates.service';
import { AdminUsersService } from './admin-users.service';

/**
 * Above this the export is refused rather than truncated. A CSV that silently
 * stops at row N looks complete to whoever opens it, and a reconciliation run
 * off a short file is worse than one that never started.
 */
export const EXPORT_MAX_ROWS = 20_000;

const CHUNK = 1_000;

export const EXPORT_RESOURCES = [
  'orders',
  'subscriptions',
  'payouts',
  'affiliates',
  'customers',
] as const;

export type ExportResource = (typeof EXPORT_RESOURCES)[number];

export interface ExportParams {
  status?: string;
  userId?: string;
  serviceId?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: string;
}

interface ResourceExport {
  headers: string[];
  count: (p: ExportParams) => Promise<number>;
  slice: (p: ExportParams, skip: number, take: number) => Promise<any[]>;
  row: (item: any) => unknown[];
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : '');

/**
 * CSV exports of the admin lists.
 *
 * Each resource reuses the list endpoint's own filter and sort, so the file is
 * the set of records the operator was looking at when they pressed the button —
 * an export that quietly ignored the active filter would send someone off to
 * reconcile the wrong rows.
 */
@Injectable()
export class AdminExportService {
  private readonly resources: Record<ExportResource, ResourceExport>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: AdminUsersService,
  ) {
    this.resources = {
      orders: {
        headers: [
          'id',
          'created_at',
          'user_id',
          'product',
          'amount',
          'currency',
          'mode',
          'status',
          'external_id',
        ],
        count: (p) => this.prisma.order.count({ where: buildOrderWhere(p) }),
        slice: (p, skip, take) =>
          this.prisma.order.findMany({
            where: buildOrderWhere(p),
            orderBy: resolveOrderBy(ORDER_SORT, { createdAt: 'desc' }, p.sortBy, p.sortOrder),
            include: { price: { include: { product: true } } },
            skip,
            take,
          }),
        row: (o) => [
          o.id,
          iso(o.createdAt),
          o.userId,
          o.price?.product?.name ?? '',
          o.amount?.toString() ?? '',
          o.currency,
          o.mode,
          o.status,
          o.externalId ?? '',
        ],
      },

      subscriptions: {
        headers: [
          'id',
          'created_at',
          'user_id',
          'product',
          'status',
          'current_period_start',
          'current_period_end',
          'cancel_at_period_end',
          'rail',
          'provider_subscription_id',
        ],
        count: (p) => this.prisma.subscription.count({ where: subscriptionWhere(p) }),
        slice: (p, skip, take) =>
          this.prisma.subscription.findMany({
            where: subscriptionWhere(p),
            orderBy: resolveOrderBy(
              SUBSCRIPTION_SORT,
              { createdAt: 'desc' },
              p.sortBy,
              p.sortOrder,
            ),
            include: { price: { include: { product: true } } },
            skip,
            take,
          }),
        row: (s) => [
          s.id,
          iso(s.createdAt),
          s.userId,
          s.price?.product?.name ?? '',
          s.status,
          iso(s.currentPeriodStart),
          iso(s.currentPeriodEnd),
          s.cancelAtPeriodEnd,
          s.rail ?? '',
          s.providerSubscriptionId ?? '',
        ],
      },

      payouts: {
        headers: [
          'id',
          'created_at',
          'affiliate_code',
          'affiliate_user_id',
          'period_start',
          'period_end',
          'total_amount',
          'fee_amount',
          'net_amount',
          'currency',
          'status',
          'processed_at',
          'external_id',
          'failure_reason',
        ],
        count: (p) => this.prisma.affiliatePayout.count({ where: payoutWhere(p) }),
        slice: (p, skip, take) =>
          this.prisma.affiliatePayout.findMany({
            where: payoutWhere(p),
            orderBy: resolveOrderBy(PAYOUT_SORT, { createdAt: 'desc' }, p.sortBy, p.sortOrder),
            include: { affiliate: true },
            skip,
            take,
          }),
        row: (p) => [
          p.id,
          iso(p.createdAt),
          p.affiliate?.referralCode ?? '',
          p.affiliate?.userId ?? '',
          iso(p.periodStart),
          iso(p.periodEnd),
          p.totalAmount?.toString() ?? '',
          p.feeAmount?.toString() ?? '',
          p.netAmount?.toString() ?? '',
          p.currency,
          p.status,
          iso(p.processedAt),
          p.externalId ?? '',
          p.failureReason ?? '',
        ],
      },

      affiliates: {
        headers: [
          'id',
          'created_at',
          'user_id',
          'referral_code',
          'status',
          'commission_rate',
          'total_earned',
          'total_paid',
          'referrals',
        ],
        count: (p) => this.prisma.affiliate.count({ where: affiliateWhere(p) }),
        slice: (p, skip, take) =>
          this.prisma.affiliate.findMany({
            where: affiliateWhere(p),
            orderBy: resolveOrderBy(AFFILIATE_SORT, { createdAt: 'desc' }, p.sortBy, p.sortOrder),
            include: { _count: { select: { referrals: true, commissions: true } } },
            skip,
            take,
          }),
        row: (a) => [
          a.id,
          iso(a.createdAt),
          a.userId,
          a.referralCode,
          a.status,
          a.commissionRate?.toString() ?? '',
          a.totalEarned?.toString() ?? '',
          a.totalPaid?.toString() ?? '',
          a._count?.referrals ?? 0,
        ],
      },

      customers: {
        headers: [
          'user_id',
          'total_orders',
          'total_spent',
          'last_order_at',
          'active_subscriptions',
          'active_entitlements',
          'credit_balance',
          'affiliate_code',
        ],
        count: (p) => this.usersService.countCustomers({ search: p.search }),
        slice: async (p, skip, take) => {
          const res = await this.usersService.getCustomers({
            search: p.search,
            sortBy: p.sortBy,
            sortOrder: p.sortOrder,
            page: Math.floor(skip / take) + 1,
            limit: take,
          });
          return res.items;
        },
        row: (c) => [
          c.userId,
          c.totalOrders,
          c.totalSpent,
          iso(c.lastOrderAt),
          c.activeSubscriptions,
          c.activeEntitlements,
          c.creditBalance,
          c.affiliate?.referralCode ?? '',
        ],
      },
    };
  }

  /**
   * Build the whole file in memory before anything is written to the response:
   * the row cap is enforced first, so a refusal is an ordinary 400 the UI can
   * show rather than an error arriving halfway through a download the browser
   * has already started saving.
   */
  async toCsvFile(
    resource: ExportResource,
    params: ExportParams,
  ): Promise<{ filename: string; csv: string; rows: number }> {
    const def = this.resources[resource];
    if (!def) throw new BadRequestException(`Unknown export resource: ${resource}`);

    const total = await def.count(params);
    if (total > EXPORT_MAX_ROWS) {
      throw new BadRequestException(
        `Export matches ${total} rows; the limit is ${EXPORT_MAX_ROWS}. Narrow the filter and try again.`,
      );
    }

    const rows: unknown[][] = [];
    for (let skip = 0; skip < total; skip += CHUNK) {
      const batch = await def.slice(params, skip, Math.min(CHUNK, total - skip));
      if (batch.length === 0) break;
      for (const item of batch) rows.push(def.row(item));
    }

    const stamp = new Date().toISOString().slice(0, 10);
    return {
      filename: `${resource}-${stamp}.csv`,
      csv: toCsv(def.headers, rows),
      rows: rows.length,
    };
  }
}

function payoutWhere(p: ExportParams) {
  const where: any = {};
  if (p.status) where.status = p.status;
  return where;
}

function subscriptionWhere(p: ExportParams) {
  const where: any = {};
  if (p.status) where.status = p.status;
  if (p.userId) where.userId = p.userId;
  return where;
}

function affiliateWhere(p: ExportParams) {
  const where: any = {};
  if (p.status) where.status = p.status;
  if (p.serviceId) where.serviceId = p.serviceId;
  return where;
}
